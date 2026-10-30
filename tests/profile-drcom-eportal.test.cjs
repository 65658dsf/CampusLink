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
  assert.deepEqual(profileParameters(builtinJdztcProfile), { operator: 'telecom' });
  assert.deepEqual(builtinJdztcProfile.drcomEportal, { variant: 'portal-v4', apiPort: 801 });
  for (const operator of ['telecom', 'cmcc', 'unicom', 'xyw', 'raw']) assert.deepEqual(profileParameters(builtinJdztcProfile, { operator }), { operator });
  assert.deepEqual(builtinJdztcProfile.fields[0].options.map(option => option.value), ['telecom', 'cmcc', 'unicom', 'xyw', 'raw']);
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
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/jdztc-campus.example.json'), 'utf8'));
  assert.deepEqual(parseProfile(JSON.stringify(example)), { ...builtinJdztcProfile, id: 'jdztc-campus' });
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
  for (const operator of ['unverified', '-1']) assert.throws(() => profileParameters(base, { operator }), /可选范围/);
  assert.throws(() => parseProfile(JSON.stringify(builtinJdztcProfile)), /builtin-/);
});

test('v4 API settings constrain the port, variant and declared operator values without changing legacy definitions', () => {
  const base = parseProfile(exportProfileJson(builtinJdztcProfile));
  for (const drcomEportal of [
    null, [], {}, { variant: 'portal-v4' }, { apiPort: 801 },
    { variant: 'unknown', apiPort: 801 }, { variant: 'portal-v4', apiPort: '801' },
    { variant: 'portal-v4', apiPort: 0 }, { variant: 'portal-v4', apiPort: 65536 },
    { variant: 'portal-v4', apiPort: 801.5 },
    { variant: 'portal-v4', apiPort: 801, apiUrl: 'https://other.invalid/login' },
  ]) {
    assert.throws(() => validateProfile({ ...base, drcomEportal }), undefined, JSON.stringify(drcomEportal));
  }
  for (const apiPort of [1, 80, 801, 65535]) assert.equal(validateProfile({ ...base, drcomEportal: { variant: 'portal-v4', apiPort } }).drcomEportal.apiPort, apiPort);
  for (const change of [
    p => { p.fields[0].options[0].value = 'unverified'; },
    p => { p.fields[0].default = 'unverified'; delete p.fields[0].options; },
    p => { p.fields[0].default = '-1'; delete p.fields[0].options; },
    p => { delete p.fields[0].default; delete p.fields[0].options; },
  ]) {
    const profile = structuredClone(base); change(profile);
    assert.throws(() => validateProfile(profile));
  }
  const freeInput = structuredClone(base); delete freeInput.fields[0].options;
  assert.throws(() => profileParameters(validateProfile(freeInput), { operator: 'unverified' }), /仅支持/);
  const legacy = structuredClone(base); delete legacy.drcomEportal; delete legacy.fields;
  assert.deepEqual(validateProfile(legacy), legacy);
  assert.deepEqual(profileParameters(legacy), {});
  assert.equal(Object.hasOwn(parseProfile(exportProfileJson(legacy)), 'drcomEportal'), false);
  const noOperator = structuredClone(base); delete noOperator.fields;
  assert.deepEqual(profileParameters(validateProfile(noOperator)), {});
  for (const protocol of ['http', 'ruijie', 'drcom']) assert.throws(() => validateProfile({ ...base, protocol }), /仅 Dr.COM ePortal/);
});

test('selecting and restoring the university uses its telecom default and upgrades saved empty parameters', t => {
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
  assert.deepEqual(service.settings.parameters, { operator: 'telecom' });
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
  saved.settings.parameters = {};
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(saved));
  const restored = create();
  assert.equal(restored.profile(), builtinJdztcProfile);
  assert.deepEqual(restored.settings.parameters, { operator: 'telecom' });
  assert.equal(restored.snapshot().profiles.find(p => p.id === builtinJdztcProfile.id).builtin, true);
  assert.throws(() => restored.removeProfile(builtinJdztcProfile.id), /内置/);
  const portable = exportProfileJson(builtinJdztcProfile);
  restored.importProfile(portable);
  restored.saveSettings({ profileId: 'jdztc-copy' });
  const imported = create();
  assert.equal(imported.profile().protocol, 'drcom-eportal');
  assert.deepEqual(imported.settings.parameters, { operator: 'telecom' });
  imported.removeProfile('jdztc-copy');
  assert.equal(imported.settings.profileId, '');
});
