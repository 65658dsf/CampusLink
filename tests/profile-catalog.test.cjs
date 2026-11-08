'use strict';

// NingMeng123 — shipped profiles remain usable across selection, export and restart.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { builtinProfiles, validateProfile, parseProfile, exportProfileJson, publicProfile, profileParameters } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');
const cqu = builtinProfiles.find(profile => profile.id === 'builtin-cqu');
const swu = builtinProfiles.find(profile => profile.id === 'builtin-swu-ruijie');
const automatic = builtinProfiles.find(profile => profile.id === 'builtin-drcom-auto');

test('new university profiles and examples preserve protocol settings when exported and reimported', () => {
  for (const [profile, filename] of [[cqu, 'cqu-campus.example.json'], [swu, 'ruijie-swu.example.json'], [automatic, 'drcom-auto.example.json']]) {
    assert.ok(profile);
    assert.equal(profile.author, 'NingMeng123');
    const copy = parseProfile(exportProfileJson(profile));
    assert.deepEqual(copy, { ...profile, id: profile.id.slice(8) + '-copy' });
    const example = parseProfile(fs.readFileSync(path.join(__dirname, '../examples', filename), 'utf8'));
    assert.deepEqual({ ...example, id: profile.id }, profile);
    const visible = publicProfile(profile, true);
    assert.equal(visible.builtin, true);
    assert.equal(Object.hasOwn(visible, 'ruijie'), false);
    assert.equal(Object.hasOwn(visible, 'drcomEportal'), false);
  }
  assert.deepEqual(profileParameters(cqu), {});
  assert.deepEqual(profileParameters(swu), { service: '默认' });
  assert.equal(Object.hasOwn(swu.ruijie, 'publicKey'), false);
  assert.deepEqual(profileParameters(automatic), { operator: 'auto', portalUrl: '', apiPort: '', accountPrefix: 'auto' });
  assert.throws(() => profileParameters(automatic, { operator: 'guess-all' }), /可选范围/);
});

test('dynamic public keys are explicit, cannot carry a static fallback, and reject unknown encoding modes', () => {
  const base = parseProfile(exportProfileJson(swu));
  const scu = builtinProfiles.find(profile => profile.id === 'builtin-scu-ruijie');
  for (const change of [
    p => { p.ruijie.publicKeySource = 'remote-url'; },
    p => { p.ruijie.publicKeySource = null; },
    p => { p.ruijie.publicKey = scu.ruijie.publicKey; },
    p => { p.ruijie.passwordEncoding = 'eval'; },
    p => { p.ruijie.passwordEncoding = null; },
    p => { delete p.ruijie.publicKeySource; },
    p => { p.ruijie.publicKeySource = 'static'; },
    p => { p.ruijie.publicKeyUrl = 'https://other.invalid/'; },
  ]) {
    const candidate = structuredClone(base); change(candidate);
    assert.throws(() => validateProfile(candidate), undefined, change.toString());
  }
  const staticCopy = parseProfile(exportProfileJson(scu));
  staticCopy.ruijie.publicKeySource = 'static';
  staticCopy.ruijie.passwordEncoding = 'legacy';
  assert.deepEqual(validateProfile(staticCopy), staticCopy);
});

test('CQU dialect cannot override requests or add an ignored operator selection', () => {
  const base = parseProfile(exportProfileJson(cqu));
  for (const change of [
    p => { p.drcomEportal.dialect = 'arbitrary'; },
    p => { p.drcomEportal.dialect = null; },
    p => { p.drcomEportal.statusUrl = 'https://other.invalid/'; },
    p => { p.fields = [{ key: 'operator', label: '运营商', default: 'raw' }]; },
    p => { p.operations = {}; },
  ]) {
    const candidate = structuredClone(base); change(candidate);
    assert.throws(() => validateProfile(candidate), undefined, change.toString());
  }
});

test('selecting each new university restores its defaults and portable copies after restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-catalog-'));
  const services = [];
  const create = () => {
    const service = new CampusService({ directory, safeStorage: { isEncryptionAvailable: () => false }, operation: async () => { throw new Error('Unexpected authentication request'); } });
    services.push(service); return service;
  };
  t.after(() => {
    for (const service of services) service.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let service = create();
  for (const profile of [cqu, swu, automatic]) {
    service.saveSettings({ profileId: profile.id });
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
    service.dispose(); service = create();
    assert.equal(service.profile().id, profile.id);
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
    assert.throws(() => service.removeProfile(profile.id), /内置/);
    const serialized = exportProfileJson(profile);
    const id = parseProfile(serialized).id;
    service.importProfile(serialized);
    service.saveSettings({ profileId: id });
    service.dispose(); service = create();
    assert.equal(service.profile().id, id);
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
  }
});
