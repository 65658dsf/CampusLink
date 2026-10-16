'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinProfile, builtinRuijieProfile, builtinCdutYibinProfile, builtinProfiles, parseProfile, validateProfile, publicProfile, profileParameters, DEFAULT_PORTAL_DISCOVERY_URL } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');

const readExample = name => JSON.parse(fs.readFileSync(path.join(__dirname, `../examples/${name}`), 'utf8'));
const example = readExample('ruijie-campus.example.json');
const scuExample = readExample('ruijie-scu.example.json');

test('Ruijie examples are importable and distinguish SCU settings from the generic placeholder', () => {
  assert.deepEqual(parseProfile(JSON.stringify(example)), example);
  assert.deepEqual(parseProfile(JSON.stringify(scuExample)), scuExample);
  assert.equal(scuExample.ruijie.publicKey.modulus, builtinRuijieProfile.ruijie.publicKey.modulus);
  assert.equal(scuExample.ruijie.serviceEncoding, 'percent');
  assert.equal(new URL(example.homepage).hostname.endsWith('.invalid'), true);
  assert.match(example.description, /必须改为学校实际配置/);
  assert.notEqual(example.ruijie.publicKey.modulus, scuExample.ruijie.publicKey.modulus);
  assert.equal(builtinProfiles.includes(builtinProfile), true);
  assert.equal(builtinProfiles.includes(builtinRuijieProfile), true);
  for (const profile of [...builtinProfiles, example, scuExample]) {
    assert.deepEqual(profile.portalDiscovery, { url: DEFAULT_PORTAL_DISCOVERY_URL });
    assert.deepEqual(publicProfile(profile).portalDiscovery, profile.portalDiscovery);
  }
  assert.deepEqual(profileParameters(builtinRuijieProfile), { service: 'internet' });
  assert.deepEqual(builtinRuijieProfile.fields[0].options.map(x => x.value), ['internet', '电信出口', '移动出口', '联通出口']);
});

test('portal discovery is optional for legacy profiles and validates only explicit HTTP(S) URLs', () => {
  const legacy = structuredClone(example);
  delete legacy.portalDiscovery;
  assert.equal(validateProfile(legacy).portalDiscovery, undefined);
  assert.equal(Object.hasOwn(publicProfile(legacy), 'portalDiscovery'), false);
  const crossOriginProbe = structuredClone(example);
  crossOriginProbe.portalDiscovery = { url: 'https://network-probe.example.invalid/redirect?check=1' };
  assert.equal(validateProfile(crossOriginProbe).portalDiscovery.url, crossOriginProbe.portalDiscovery.url);
  for (const portalDiscovery of [
    null, undefined, [], {}, { url: '/relative' }, { url: 'file:///C:/test' },
    { url: 'https://user:secret@probe.example.invalid/' }, { url: 'https://probe.example.invalid/#secret' },
    { url: 'https://{{host}}/' }, { url: 'https://probe.example.invalid/', script: 'run()' },
    { url: 123 }, { url: ' ' }, { url: 'https://probe.example.invalid/' + 'a'.repeat(2048) },
  ]) {
    const profile = structuredClone(example); profile.portalDiscovery = portalDiscovery;
    assert.throws(() => validateProfile(profile));
  }
  const http = readExample('custom-campus.example.json');
  http.portalDiscovery = { url: DEFAULT_PORTAL_DISCOVERY_URL };
  assert.throws(() => validateProfile(http), /仅支持 drcom \/ ruijie/);
  const drcom = structuredClone(builtinProfile);
  assert.equal(validateProfile(drcom, { builtin: true }).portalDiscovery.url, DEFAULT_PORTAL_DISCOVERY_URL);
  delete drcom.portalDiscovery;
  assert.equal(validateProfile(drcom, { builtin: true }).portalDiscovery, undefined);
});

test('optional Ruijie settings normalize to same-origin discovery and plain service encoding', () => {
  const profile = structuredClone(example);
  delete profile.ruijie.discoveryUrl;
  delete profile.ruijie.redirectOrigins;
  delete profile.ruijie.serviceEncoding;
  const validated = validateProfile(profile);
  assert.equal(validated.ruijie.discoveryUrl, profile.homepage);
  assert.equal(validated.ruijie.serviceEncoding, 'plain');
  assert.deepEqual(validated.ruijie.redirectOrigins, []);
  assert.equal(profile.ruijie.discoveryUrl, undefined, 'validation does not mutate its input');
  delete profile.fields[0].default;
  profile.fields[0].options = [{ label: '校园网', value: 'internet' }];
  assert.deepEqual(profileParameters(validateProfile(profile)), { service: 'internet' });
});

test('Ruijie schema rejects unsafe discovery origins, redirect origins and protocol mixing', () => {
  const changes = [
    p => { p.operations = {}; },
    p => { p.operations = undefined; },
    p => { delete p.ruijie; },
    p => { p.ruijie.script = 'throw new Error()'; },
    p => { p.ruijie.discoveryUrl = 'https://other.example.invalid/'; },
    p => { p.ruijie.discoveryUrl = 'https://user:password@campus.example.invalid/'; },
    p => { p.ruijie.discoveryUrl = '/relative'; },
    p => { p.ruijie.discoveryUrl = `${p.homepage}#secret`; },
    p => { p.ruijie.redirectOrigins = ['https://portal.example.invalid/path']; },
    p => { p.ruijie.redirectOrigins = ['https://portal.example.invalid/']; },
    p => { p.ruijie.redirectOrigins = ['https://portal.example.invalid?x=1']; },
    p => { p.ruijie.redirectOrigins = ['https://portal.example.invalid#x']; },
    p => { p.ruijie.redirectOrigins = ['https://user:pw@portal.example.invalid']; },
    p => { p.ruijie.redirectOrigins = ['file:///C:/test']; },
    p => { p.ruijie.redirectOrigins = ['https://portal.example.invalid', 'https://portal.example.invalid']; },
    p => { p.ruijie.redirectOrigins = Array.from({ length: 9 }, (_, i) => `https://portal${i}.example.invalid`); },
    p => { p.ruijie.redirectOrigins = 'https://portal.example.invalid'; },
    p => { p.ruijie.serviceEncoding = 'javascript'; },
    p => { p.ruijie.serviceEncoding = null; },
    p => { p.fields = []; },
    p => { p.fields[0].default = ''; },
    p => { p.fields[0].default = 1; },
    p => { delete p.fields[0].default; },
    p => { delete p.fields[0].default; p.fields[0].options = [{ label: '空', value: '' }]; },
    p => { p.fields[0].key = 'operator'; },
    p => { p.id = 'builtin-scu-ruijie'; },
  ];
  for (const change of changes) {
    const profile = structuredClone(example);
    change(profile);
    assert.throws(() => validateProfile(profile), undefined, change.toString());
  }
  const http = readExample('custom-campus.example.json');
  http.ruijie = example.ruijie;
  assert.throws(() => validateProfile(http), /仅锐捷/);
  const drcom = structuredClone(builtinProfile);
  drcom.ruijie = example.ruijie;
  assert.throws(() => validateProfile(drcom, { builtin: true }), /仅锐捷/);
});

test('Ruijie RSA public keys are bounded hex integers with safe modulus and exponent ranges', () => {
  for (const modulus of ['0', 'f'.repeat(127), '8' + '0'.repeat(127), 'f'.repeat(1025), '0x' + 'f'.repeat(256), 'G'.repeat(128), 123, null]) {
    const profile = structuredClone(example); profile.ruijie.publicKey.modulus = modulus;
    assert.throws(() => validateProfile(profile));
  }
  for (const exponent of ['0', '1', '2', '4', '100000001', '0x10001', 'xyz', 65537, null]) {
    const profile = structuredClone(example); profile.ruijie.publicKey.exponent = exponent;
    assert.throws(() => validateProfile(profile));
  }
  for (const modulus of ['8' + '0'.repeat(126) + '1', '8' + '0'.repeat(1022) + '1']) {
    for (const exponent of ['3', '10001', 'ffffffff']) {
      const profile = structuredClone(example); profile.ruijie.publicKey = { modulus, exponent };
      assert.equal(validateProfile(profile).ruijie.publicKey.modulus, modulus);
    }
  }
  const extra = structuredClone(example); extra.ruijie.publicKey.privateKey = 'never';
  assert.throws(() => validateProfile(extra), /不支持/);
});

test('Ruijie extension options validate booleans, encodings and optional service fields', () => {
  const extended = structuredClone(example);
  extended.fields = [];
  extended.ruijie.passwordWithMac = false;
  extended.ruijie.serviceOptional = true;
  extended.ruijie.valueEncoding = 'percent';
  const result = validateProfile(extended);
  assert.equal(result.ruijie.passwordWithMac, false);
  assert.equal(result.ruijie.serviceOptional, true);
  assert.equal(result.ruijie.valueEncoding, 'percent');
  for (const change of [
    p => { p.ruijie.passwordWithMac = 'false'; },
    p => { p.ruijie.serviceOptional = 1; },
    p => { p.ruijie.valueEncoding = 'double'; },
  ]) {
    const profile = structuredClone(extended);
    change(profile);
    assert.throws(() => validateProfile(profile), undefined, change.toString());
  }
  const withoutService = structuredClone(example);
  delete withoutService.fields;
  assert.throws(() => validateProfile(withoutService), /service/);
  // Absent extension keys keep their adapter defaults (password>mac input,
  // required service, plain value encoding) without changing the profile
  // shape that callers round-trip.
  const defaults = validateProfile(structuredClone(example));
  assert.equal(Object.hasOwn(defaults.ruijie, 'passwordWithMac'), false);
  assert.equal(Object.hasOwn(defaults.ruijie, 'serviceOptional'), false);
  assert.equal(Object.hasOwn(defaults.ruijie, 'valueEncoding'), false);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-ruijie-profile-'));
  const services = [];
  t.after(() => { for (const service of services) service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return () => {
    const service = new CampusService({ directory, safeStorage: { isEncryptionAvailable: () => false }, operation: async () => { throw new Error('No network expected in profile tests'); } });
    services.push(service);
    return service;
  };
}

test('all built-in profiles are listed and protected, and selecting Ruijie initializes its service', t => {
  const create = fixture(t);
  const service = create();
  const snapshot = service.snapshot();
  assert.equal(snapshot.profiles.length, builtinProfiles.length);
  for (const profile of builtinProfiles) {
    assert.equal(service.profile(profile.id), profile);
    assert.equal(snapshot.profiles.find(item => item.id === profile.id).builtin, true);
    assert.throws(() => service.removeProfile(profile.id), /内置/);
  }
  assert.equal(service.settings.profileId, '');
  assert.deepEqual(service.settings.parameters, {});
  assert.equal(snapshot.profiles.every(profile => !Object.hasOwn(profile, 'archived')), true);
  assert.equal(snapshot.profiles.every(profile => profile.author === 'NingMeng123'), true);
  assert.equal(builtinCdutYibinProfile.homepage, 'http://10.26.30.253/');
  assert.equal(builtinCdutYibinProfile.ruijie.serviceOptional, true);
  assert.equal(builtinCdutYibinProfile.ruijie.valueEncoding, 'percent');
  assert.deepEqual(profileParameters(builtinCdutYibinProfile), {});
  service.saveSettings({ profileId: builtinRuijieProfile.id });
  assert.deepEqual(service.settings.parameters, { service: 'internet' });
  service.saveSettings({ parameters: { service: '移动出口' } });
  const restored = create();
  assert.equal(restored.settings.profileId, builtinRuijieProfile.id);
  assert.deepEqual(restored.settings.parameters, { service: '移动出口' });
  assert.throws(() => restored.saveSettings({ parameters: { service: 'unknown' } }), /可选范围/);
});

test('imported Ruijie profiles persist, restore, enforce IDs and reset correctly on removal', t => {
  const create = fixture(t);
  const service = create();
  service.importProfile(JSON.stringify(scuExample));
  assert.equal(service.snapshot().profiles.length, builtinProfiles.length + 1);
  assert.equal(service.snapshot().profiles.find(p => p.id === scuExample.id).builtin, false);
  assert.throws(() => service.importProfile(JSON.stringify(scuExample)), /已存在/);
  service.saveSettings({ profileId: scuExample.id, parameters: { service: '电信出口' } });
  const restored = create();
  assert.deepEqual(restored.profile(), scuExample);
  assert.deepEqual(restored.settings.parameters, { service: '电信出口' });
  assert.equal(restored.snapshot().profiles.some(p => p.id === builtinRuijieProfile.id), true);
  restored.removeProfile(scuExample.id);
  assert.equal(restored.settings.profileId, '');
  assert.deepEqual(restored.settings.parameters, {});
  const removed = create();
  assert.equal(removed.snapshot().profiles.length, builtinProfiles.length);
  assert.equal(removed.settings.profileId, '');
  assert.deepEqual(removed.settings.parameters, {});
});
