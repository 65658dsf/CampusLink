'use strict';

// NingMeng123 — profile changes commit in memory only after persistence succeeds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinProfiles, parseProfile, exportProfileJson } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-profile-persistence-'));
  const services = [];
  const create = (options = {}) => {
    const service = new CampusService({
      directory,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(`encrypted:${value}`),
        decryptString: value => value.toString().slice('encrypted:'.length),
      },
      operation: async () => { throw new Error('Unexpected authentication request'); },
      ...options,
    });
    services.push(service);
    return service;
  };
  t.after(() => {
    for (const service of services) service.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return create;
}

test('a failed import preserves memory and disk, permits retry and restores the committed profile after restart', t => {
  const create = fixture(t);
  let service = create();
  service.saveSettings({ profileId: builtinProfiles[0].id });
  const profile = parseProfile(exportProfileJson(builtinProfiles[0]));
  const text = JSON.stringify(profile);
  const before = service.snapshot();
  const profilesBefore = service.externalProfiles;
  const diskBefore = fs.readFileSync(service.file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === service.file) throw new Error('Simulated settings replacement failure');
    return rename(source, destination);
  };
  try {
    assert.throws(() => service.importProfile(text), /无法保存本地配置/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.externalProfiles, profilesBefore);
  assert.equal(fs.readFileSync(service.file, 'utf8'), diskBefore);
  const imported = service.importProfile(text);
  assert.equal(imported.settings.profileId, before.settings.profileId);
  assert.equal(imported.profiles.some(item => item.id === profile.id), true);
  service.dispose();
  service = create();
  assert.equal(service.snapshot().settings.profileId, before.settings.profileId);
  assert.deepEqual(service.profile(profile.id), profile);
});

test('failed removal of a selected profile retains credentials, reconnection state and timers until a successful retry', async t => {
  const create = fixture(t);
  const timers = new Set();
  const networkCalls = [];
  let service = create({
    operation: async (_profile, action) => {
      networkCalls.push(action);
      return { online: action === 'login', message: 'fixture status' };
    },
    setTimer: () => {
      const handle = { unref() {} };
      timers.add(handle);
      return handle;
    },
    clearTimer: handle => timers.delete(handle),
  });
  const profile = parseProfile(exportProfileJson(builtinProfiles[0]));
  service.importProfile(JSON.stringify(profile));
  service.saveSettings({ profileId: profile.id });
  const password = 'remove-profile-retry-secret';
  await service.connect({ username: 'student', password, rememberPassword: true });
  await service.checkStatus();
  assert.equal(service.connection.status, 'idle');
  assert.equal(service.session, null);
  assert.equal(service.monitoring(), true);
  assert.equal(timers.size, 1);
  const before = service.snapshot();
  const profilesBefore = service.externalProfiles;
  const settingsBefore = service.settings;
  const credentialBefore = service.credential;
  const reconnectBefore = service.reconnectContext;
  const timerBefore = service.monitorTimer;
  const generationBefore = service.monitorGeneration;
  const diskBefore = fs.readFileSync(service.file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === service.file) throw new Error('Simulated settings replacement failure');
    return rename(source, destination);
  };
  try {
    assert.throws(() => service.removeProfile(profile.id), /无法保存本地配置/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.externalProfiles, profilesBefore);
  assert.equal(service.settings, settingsBefore);
  assert.equal(service.credential, credentialBefore);
  assert.equal(service.decryptPassword(), password);
  assert.equal(service.reconnectContext, reconnectBefore);
  assert.equal(service.monitorTimer, timerBefore);
  assert.equal(service.monitorGeneration, generationBefore);
  assert.equal(timers.has(timerBefore), true);
  assert.equal(timers.size, 1);
  assert.equal(fs.readFileSync(service.file, 'utf8'), diskBefore);
  const removed = service.removeProfile(profile.id);
  assert.equal(removed.settings.profileId, '');
  assert.equal(removed.hasPassword, false);
  assert.equal(removed.connection.monitoring, false);
  assert.equal(removed.profiles.some(item => item.id === profile.id), false);
  assert.equal(service.reconnectContext, null);
  assert.equal(service.monitorTimer, null);
  assert.equal(timers.size, 0);
  service.dispose();
  service = create();
  assert.equal(service.snapshot().settings.profileId, '');
  assert.equal(service.snapshot().hasPassword, false);
  assert.equal(service.snapshot().profiles.some(item => item.id === profile.id), false);
  assert.deepEqual(networkCalls, ['login', 'status']);
});
