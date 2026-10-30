'use strict';

// NingMeng123 — declarative ePortal profiles never carry runtime credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  builtinJdztcProfile, builtinProfile, builtinProfiles, DEFAULT_PORTAL_DISCOVERY_URL,
  parseProfile, validateProfile, publicProfile, exportProfileJson, profileParameters,
} = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');

test('Jingdezhen Ceramic University exports an importable profile without runtime device or account data', () => {
  assert.equal(builtinProfiles.includes(builtinJdztcProfile), true);
  assert.equal(builtinJdztcProfile.homepage, 'http://172.29.0.2/a79.htm');
  assert.equal(builtinJdztcProfile.protocol, 'drcom-eportal');
  assert.equal(builtinJdztcProfile.author, 'NingMeng123');
  assert.deepEqual(profileParameters(builtinJdztcProfile), {});
  assert.deepEqual(publicProfile(builtinJdztcProfile).portalDiscovery, { url: DEFAULT_PORTAL_DISCOVERY_URL });
  const runtime = {
    ...builtinJdztcProfile,
    discoveredEntry: 'http://172.29.0.2/a79.htm?userip=10.1.2.3',
    username: 'local-student', password: 'local-secret', parameters: { operator: 'unknown' },
  };
  const text = exportProfileJson(runtime);
  const copy = parseProfile(text);
  assert.equal(copy.id, 'jdztc-copy');
  assert.deepEqual(copy, { ...builtinJdztcProfile, id: 'jdztc-copy' });
  for (const value of ['local-student', 'local-secret', '10.1.2.3', 'discoveredEntry', 'unknown']) assert.equal(text.includes(value), false);
});

test('Dr.COM ePortal definitions reject arbitrary requests, protocol mixing and unsafe entry points', () => {
  const base = parseProfile(exportProfileJson(builtinJdztcProfile));
  for (const change of [
    p => { p.operations = {}; },
    p => { p.ruijie = {}; },
    p => { p.script = 'process.exit()'; },
    p => { p.homepage = 'file:///C:/test.htm'; },
    p => { p.homepage = 'http://student:secret@172.29.0.2/a79.htm'; },
    p => { p.portalDiscovery = { url: 'javascript:alert(1)' }; },
    p => { p.portalDiscovery.script = 'run()'; },
  ]) {
    const profile = structuredClone(base); change(profile);
    assert.throws(() => validateProfile(profile), undefined, change.toString());
  }
  assert.throws(() => profileParameters(base, { operator: 'cmcc' }), /未声明/);
  assert.throws(() => parseProfile(JSON.stringify(builtinJdztcProfile)), /builtin-/);
});

test('selecting and restoring the university clears an old operator and retains empty connection parameters', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-jdztc-profile-'));
  const services = [];
  const create = () => {
    const service = new CampusService({ directory, safeStorage: { isEncryptionAvailable: () => false }, operation: async () => { throw new Error('No network expected'); } });
    services.push(service); return service;
  };
  t.after(() => {
    for (const service of services) service.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const service = create();
  service.saveSettings({ profileId: builtinProfile.id });
  assert.deepEqual(service.settings.parameters, { operator: '1' });
  service.saveSettings({ profileId: builtinJdztcProfile.id });
  assert.deepEqual(service.settings.parameters, {});
  const restored = create();
  assert.equal(restored.profile(), builtinJdztcProfile);
  assert.deepEqual(restored.settings.parameters, {});
  assert.equal(restored.snapshot().profiles.find(p => p.id === builtinJdztcProfile.id).builtin, true);
  assert.throws(() => restored.removeProfile(builtinJdztcProfile.id), /内置/);
  const portable = exportProfileJson(builtinJdztcProfile);
  restored.importProfile(portable);
  restored.saveSettings({ profileId: 'jdztc-copy' });
  const imported = create();
  assert.equal(imported.profile().protocol, 'drcom-eportal');
  assert.deepEqual(imported.settings.parameters, {});
  imported.removeProfile('jdztc-copy');
  assert.equal(imported.settings.profileId, '');
});
