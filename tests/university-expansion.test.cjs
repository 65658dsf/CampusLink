'use strict';

// NingMeng123 — the requested twenty schools survive the normal profile lifecycle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sources = require('../docs/university-sources.json');
const { builtinProfiles, validateProfile, parseProfile, exportProfileJson, profileParameters } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');

const additions = sources.schools.map(school => builtinProfiles.find(profile => profile.id === school.id));

test('twenty distinct new schools have pinned source evidence and preserve the existing catalog', () => {
  assert.equal(sources.schools.length, 20);
  assert.equal(new Set(sources.schools.map(school => school.school)).size, 20);
  assert.equal(new Set(sources.schools.map(school => school.id)).size, 20);
  assert.ok(builtinProfiles.length >= 27);
  for (const id of ['builtin-gzqy', 'builtin-scu-ruijie', 'builtin-cdut-yibin-ruijie', 'builtin-jdztc', 'builtin-cqu', 'builtin-swu-ruijie', 'builtin-drcom-auto']) {
    assert.ok(builtinProfiles.some(profile => profile.id === id), id);
  }
  for (const school of sources.schools) {
    const profile = builtinProfiles.find(item => item.id === school.id);
    assert.ok(profile, school.id);
    assert.equal(profile.author, 'NingMeng123');
    assert.ok(profile.name.includes(school.school));
    assert.equal(profile.protocol, school.protocol);
    assert.match(profile.description, /校内/);
    assert.ok(school.sources.length);
    for (const source of school.sources) {
      assert.match(source.commit, /^[a-f0-9]{40}$/);
      assert.ok(source.url.startsWith(`https://github.com/${source.repository}/blob/${source.commit}/`));
    }
    const portable = parseProfile(exportProfileJson(profile));
    assert.deepEqual({ ...portable, id: profile.id }, profile);
  }
});

test('all twenty defaults and imported definitions restore through CampusService', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-twenty-'));
  const services = [];
  const create = () => {
    const service = new CampusService({ directory, operation: async () => { throw new Error('Profile lifecycle must not authenticate'); } });
    services.push(service);
    return service;
  };
  t.after(() => {
    services.forEach(service => service.dispose());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let service = create();
  for (const profile of additions) {
    service.saveSettings({ profileId: profile.id });
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
    const serialized = exportProfileJson(profile);
    const copy = parseProfile(serialized);
    service.importProfile(serialized);
    service.saveSettings({ profileId: copy.id });
    service.dispose();
    service = create();
    assert.deepEqual(service.profile(), copy);
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
  }
  assert.equal(service.externalProfiles.length, 20);
  const saved = fs.readFileSync(path.join(directory, 'settings.json'), 'utf8');
  assert.equal(saved.includes('discoveredEntry'), false);
});

test('new protocol schemas reject mixed configuration, credential-bearing status and unsupported wire changes', () => {
  const base = parseProfile(exportProfileJson(additions.find(profile => profile.protocol === 'drcom-config')));
  for (const change of [
    p => { p.drcomConfig.statusFields = [{ key: 'a', value: 'logout' }]; },
    p => { p.drcomConfig.statusFields = [{ key: 'v', value: '{{ip}}' }]; },
    p => { p.drcomConfig.logoutFields = [{ key: 'user_password', value: '{{password}}' }]; },
    p => { p.drcomConfig.loginFields.push({ key: 'callback', value: '{{password}}' }); },
    p => { p.drcomConfig.apiUrl = 'https://other.invalid/login'; },
    p => { p.drcomConfig.loginFields = []; },
    p => { p.drcomConfig.apiPort = 0; },
    p => { p.drcomConfig.mode = 'execute-script'; },
    p => { p.protocol = 'drcom-auto'; },
    p => { p.srun = { acId: '1', hmacMode: 'password' }; },
  ]) {
    const profile = structuredClone(base);
    change(profile);
    assert.throws(() => validateProfile(profile), undefined, change.toString());
  }
  const deep = parseProfile(exportProfileJson(additions.find(profile => profile.protocol === 'srun')));
  for (const srun of [null, {}, { acId: '1', hmacMode: 'guess' }, { acId: '-1', hmacMode: 'empty' }, { acId: '1', hmacMode: 'empty', usernameSuffix: 'student:password' }]) {
    assert.throws(() => validateProfile({ ...deep, srun }));
  }
  const plain = parseProfile(exportProfileJson(additions.find(profile => profile.protocol === 'ruijie')));
  for (const ruijie of [
    { ...plain.ruijie, passwordMode: 'automatic-guess' },
    { ...plain.ruijie, publicKeySource: 'page-info' },
    { ...plain.ruijie, passwordWithMac: true },
    { ...plain.ruijie, queryEncoding: 'javascript' },
  ]) assert.throws(() => validateProfile({ ...plain, ruijie }));
});
