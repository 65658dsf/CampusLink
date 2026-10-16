'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNetworkWatcher, interfaceSignature } = require('../electron/network-watch.cjs');
const { CampusService, defaults } = require('../electron/service.cjs');

function fakeClock() {
  let time = 100000, nextId = 0;
  const timers = new Map();
  const clock = {
    now: () => time,
    setTimer: (callback, delay) => {
      const handle = { id: ++nextId, unref: () => {} };
      timers.set(handle, { callback, due: time + delay });
      return handle;
    },
    clearTimer: handle => timers.delete(handle),
    next() {
      return [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
    },
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (clock.next()?.[1].due <= target) await clock.fireNext();
      time = target;
    },
    fireNext() {
      const entry = clock.next();
      if (!entry) return Promise.resolve();
      const [handle, timer] = entry;
      timers.delete(handle); time = timer.due;
      return timer.callback();
    },
    get count() { return timers.size; },
  };
  return clock;
}

function fixture(t, operation, saved) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-network-watch-test-'));
  if (saved) fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(saved));
  const clock = fakeClock();
  const service = new CampusService({ directory, operation, ...clock, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from([...value].reverse().join('')),
    decryptString: value => [...value.toString()].reverse().join(''),
  } });
  t.after(() => { service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, clock };
}

test('interfaceSignature keeps only sorted external IPv4 entries', () => {
  const interfaces = {
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    Ethernet: [{ family: 'IPv4', address: '10.0.0.8', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }, { family: 4, address: '10.0.0.9', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
  };
  assert.equal(interfaceSignature(interfaces), 'Ethernet:10.0.0.8|Ethernet:10.0.0.9|Wi-Fi:192.168.1.5');
  assert.equal(interfaceSignature({ Wi_Fi: [] }), '');
});

test('the watcher reports each observed interface change once and stops cleanly', async t => {
  const clock = fakeClock();
  let current = 'eth:10.0.0.8';
  let changes = 0;
  const watcher = createNetworkWatcher({ onChange: () => { changes++; }, signature: () => current, intervalMs: 3000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  t.after(() => watcher.stop());
  watcher.start();
  assert.equal(watcher.active, true);
  await clock.advance(9000);
  assert.equal(changes, 0);
  current = 'wifi:192.168.1.5';
  await clock.advance(3000);
  assert.equal(changes, 1);
  await clock.advance(9000);
  assert.equal(changes, 1);
  current = 'wifi:10.20.30.40';
  watcher.check();
  assert.equal(changes, 2);
  watcher.stop();
  assert.equal(watcher.active, false);
  assert.equal(clock.count, 0);
  current = 'eth:10.0.0.8';
  await clock.advance(9000);
  assert.equal(changes, 2);
});

test('start resets the baseline so stale differences never fire on launch', async t => {
  const clock = fakeClock();
  let current = 'a:1.1.1.1';
  let changes = 0;
  const watcher = createNetworkWatcher({ onChange: () => { changes++; }, signature: () => current, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  t.after(() => watcher.stop());
  current = 'b:2.2.2.2';
  watcher.start();
  await clock.advance(6000);
  assert.equal(changes, 0);
});

test('an interface change right after startup still performs a fresh silent status read', async t => {
  const calls = [];
  const { service } = fixture(t, async (_profile, action) => { calls.push(action); return { online: false, message: 'offline' }; });
  await service.initialize();
  await service.onNetworkChanged();
  assert.deepEqual(calls, ['status', 'status']);
  assert.equal(service.snapshot().connection.status, 'idle');
});

test('a guard-armed interface change reconnects immediately with the saved password', async t => {
  let online = true;
  const calls = [];
  const password = 'interface-change-password';
  const settings = { ...defaults(), username: 'guard-account', rememberPassword: true };
  const { service, clock } = fixture(t, async (_profile, action, context) => {
    calls.push(action);
    if (action === 'login') { assert.equal(context.password, password); online = true; }
    return { online, message: 'ok' };
  }, { version: 1, settings, profiles: [], credential: { profileId: settings.profileId, username: settings.username, encrypted: Buffer.from([...password].reverse().join('')).toString('base64') } });
  await service.initialize();
  assert.equal(service.snapshot().connection.monitoring, true);
  online = false;
  await service.onNetworkChanged();
  assert.deepEqual(calls, ['status', 'status', 'login']);
  assert.equal(service.connection.status, 'connected');
  assert.equal(clock.count, 1);
});

test('a manual logout pause or disabled guard ignores interface changes', async t => {
  const calls = [];
  const { service } = fixture(t, async (_profile, action) => { calls.push(action); return { online: action !== 'logout', message: 'ok' }; });
  await service.connect({ username: 'local-account', password: 'local-password' });
  await service.disconnect();
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  await service.onNetworkChanged();
  assert.deepEqual(calls, ['login', 'logout']);
  service.saveSettings({ autoReconnect: false });
  service.saveSettings({ autoReconnect: true });
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  await service.onNetworkChanged();
  assert.deepEqual(calls, ['login', 'logout']);
});

test('a disposed service ignores interface changes', async t => {
  const calls = [];
  const { service } = fixture(t, async (_profile, action) => { calls.push(action); return { online: true, message: 'ok' }; });
  service.dispose();
  await service.onNetworkChanged();
  assert.deepEqual(calls, []);
});
