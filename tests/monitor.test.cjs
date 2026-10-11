'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CampusService, defaults } = require('../electron/service.cjs');
const { CampusError } = require('../electron/transport.cjs');
const example = require('../examples/custom-campus.example.json');

function fakeClock() {
  let time = 100000, nextId = 0, peak = 0, unrefs = 0;
  const timers = new Map();
  const clock = {
    now: () => time,
    setTimer: (callback, delay) => {
      const handle = { id: ++nextId, unref: () => { unrefs++; } };
      timers.set(handle, { callback, due: time + delay });
      peak = Math.max(peak, timers.size);
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
    get peak() { return peak; },
    get unrefs() { return unrefs; },
    get delay() { return clock.next() ? clock.next()[1].due - time : null; },
  };
  return clock;
}

function fixture(t, operation, saved) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-monitor-test-'));
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

test('old settings migrate to optional reconnection defaults and interval is validated', t => {
  const settings = defaults();
  delete settings.autoReconnect; delete settings.reconnectIntervalSeconds;
  const { service, clock } = fixture(t, async () => ({ online: false }), { version: 1, settings, profiles: [], credential: null });
  assert.equal(service.settings.autoReconnect, true);
  assert.equal(service.settings.reconnectIntervalSeconds, 30);
  assert.equal(clock.count, 0);
  for (const value of [4, 3601, 2.5, '30', null]) assert.throws(() => service.saveSettings({ reconnectIntervalSeconds: value }), /5 至 3600/);
  assert.throws(() => service.saveSettings({ autoReconnect: 'true' }), /设置值/);
  service.saveSettings({ reconnectIntervalSeconds: 5 });
  service.saveSettings({ reconnectIntervalSeconds: 3600 });
  assert.equal(service.settings.reconnectIntervalSeconds, 3600);
});

test('an offline or unknown startup never starts first login solely because reconnection is enabled', async t => {
  for (const unknown of [false, true]) {
    const calls = [];
    const { service, clock } = fixture(t, async (_profile, action) => { calls.push(action); if (unknown) throw new CampusError('unknown', 'TIMEOUT'); return { online: false, message: 'offline' }; });
    await service.initialize();
    await clock.advance(120000);
    assert.deepEqual(calls, ['status']);
    assert.equal(service.snapshot().connection.monitoring, false);
    assert.equal(clock.count, 0);
  }
});

test('successful login arms a single timer and reuses a session password without persisting it', async t => {
  let online = false;
  const calls = [];
  const password = 'private-memory-monitor-password';
  const { service, clock } = fixture(t, async (_profile, action, context) => {
    calls.push({ action, password: context.password });
    if (action === 'login') { assert.equal(context.password, password); online = true; }
    return { online, message: 'ok' };
  });
  await service.connect({ username: 'local-monitor-account', password, rememberPassword: false });
  assert.equal(service.snapshot().connection.monitoring, true);
  assert.equal(clock.delay, 30000);
  assert.equal(clock.count, 1);
  online = false;
  await clock.advance(29999);
  assert.deepEqual(calls.map(call => call.action), ['login']);
  await clock.advance(1);
  assert.deepEqual(calls.map(call => call.action), ['login', 'status', 'login']);
  assert.equal(service.connection.status, 'connected');
  assert.equal(service.settings.rememberPassword, false);
  assert.equal(service.snapshot().hasPassword, false);
  assert.equal(JSON.stringify(service.snapshot()).includes(password), false);
  assert.equal(fs.readFileSync(service.file, 'utf8').includes(password), false);
  assert.equal(clock.count, 1);
  assert.equal(clock.peak, 1);
  assert.ok(clock.unrefs > 0);
});

test('startup can monitor a browser session and later reconnect with a saved password', async t => {
  const calls = [];
  const password = 'saved-monitor-password';
  let online = true;
  const settings = { ...defaults(), username: 'saved-account', rememberPassword: true };
  const { service, clock } = fixture(t, async (_profile, action, context) => {
    calls.push(action);
    if (action === 'login') { assert.equal(context.password, password); online = true; }
    return { online, message: 'ok' };
  }, { version: 1, settings, profiles: [], credential: { profileId: settings.profileId, username: settings.username, encrypted: Buffer.from([...password].reverse().join('')).toString('base64') } });
  await service.initialize();
  assert.equal(service.settings.autoConnect, false);
  assert.equal(service.snapshot().connection.monitoring, true);
  online = false;
  await clock.advance(30000);
  assert.deepEqual(calls, ['status', 'status', 'login']);
});

test('reconnecting with the in-memory session does not re-encrypt or rewrite saved settings', async t => {
  let online = true;
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => {
    calls.push(action);
    if (action === 'login') online = true;
    return { online, message: 'ok' };
  });
  await service.connect({ username: 'local-account', password: 'local-password', rememberPassword: true });
  const saved = fs.readFileSync(service.file, 'utf8');
  service.safeStorage.isEncryptionAvailable = () => false;
  service.persist = () => { throw new Error('automatic checks must not rewrite settings'); };
  online = false;
  await clock.advance(30000);
  assert.deepEqual(calls, ['login', 'status', 'login']);
  assert.equal(service.connection.status, 'connected');
  assert.equal(fs.readFileSync(service.file, 'utf8'), saved);
});

test('unknown status never sends a password and failed reconnections occur at most once per interval', async t => {
  const calls = [];
  let status = 'online', failLogin = false;
  const { service, clock } = fixture(t, async (_profile, action) => {
    calls.push(action);
    if (action === 'status' && status === 'unknown') throw new CampusError('timeout', 'TIMEOUT');
    if (action === 'login' && failLogin) throw new CampusError('rejected', 'AUTH_REJECTED');
    return { online: action === 'login' || status === 'online', message: 'ok' };
  });
  await service.connect({ username: 'local-account', password: 'local-password' });
  status = 'unknown';
  await clock.advance(60000);
  assert.deepEqual(calls, ['login', 'status', 'status']);
  status = 'offline'; failLogin = true;
  await clock.advance(30000);
  assert.deepEqual(calls.slice(-2), ['status', 'login']);
  const loginCount = calls.filter(action => action === 'login').length;
  await clock.advance(29999);
  assert.equal(calls.filter(action => action === 'login').length, loginCount);
  await clock.advance(1);
  assert.equal(calls.filter(action => action === 'login').length, loginCount + 1);
  assert.equal(clock.count, 1);
});

test('a browser session without credentials keeps checking with one actionable warning', async t => {
  let online = true;
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => { calls.push(action); return { online, message: 'ok' }; });
  await service.initialize();
  online = false;
  await clock.advance(90000);
  assert.deepEqual(calls, ['status', 'status', 'status', 'status']);
  assert.equal(service.logs.filter(entry => entry.message.includes('没有可用密码')).length, 1);
  assert.equal(service.snapshot().connection.monitoring, true);
});

test('manual logout pauses monitoring even after failure and read-only refresh cannot undo it', async t => {
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => {
    calls.push(action);
    if (action === 'logout') throw new CampusError('logout failed', 'HTTP_ERROR');
    return { online: true, message: 'online' };
  });
  await service.connect({ username: 'local-account', password: 'local-password' });
  await service.disconnect();
  assert.equal(service.snapshot().connection.monitoring, false);
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  assert.equal(clock.count, 0);
  await service.refreshStatus();
  await clock.advance(60000);
  assert.deepEqual(calls, ['login', 'logout']);
  await service.checkStatus();
  assert.equal(service.connection.status, 'connected');
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  assert.equal(clock.count, 0);
  service.saveSettings({ autoReconnect: false });
  service.saveSettings({ autoReconnect: true });
  assert.equal(service.snapshot().connection.reconnectPaused, false);
  assert.equal(clock.count, 1);
});

test('successful manual login resumes a pause while simply enabling reconnection offline does not', async t => {
  const { service, clock } = fixture(t, async (_profile, action) => ({ online: action === 'login', message: 'ok' }));
  await service.connect({ username: 'local-account', password: 'local-password' });
  await service.disconnect();
  service.saveSettings({ autoReconnect: false });
  service.saveSettings({ autoReconnect: true });
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  assert.equal(clock.count, 0);
  await service.connect({ password: 'local-password' });
  assert.equal(service.snapshot().connection.reconnectPaused, false);
  assert.equal(clock.count, 1);
});

test('disabling detection cancels timers and focus reads, interval changes keep just one timer', async t => {
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => { calls.push(action); return { online: true, message: 'ok' }; });
  await service.initialize();
  service.saveSettings({ reconnectIntervalSeconds: 5 });
  assert.equal(clock.count, 1);
  assert.equal(clock.delay, 5000);
  await clock.advance(5000);
  assert.deepEqual(calls, ['status', 'status']);
  service.saveSettings({ autoReconnect: false });
  await clock.advance(30000);
  await service.refreshStatus();
  assert.deepEqual(calls, ['status', 'status']);
  assert.equal(clock.count, 0);
  await service.checkStatus();
  assert.equal(calls.length, 3, 'explicit status remains available');
  assert.equal(clock.count, 0);
  service.saveSettings({ autoReconnect: true });
  assert.equal(clock.count, 1);
  assert.equal(clock.peak, 1);
});

test('clearing credentials removes the memory reconnect password and does not repersist it', async t => {
  let online = true;
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => { calls.push(action); return { online, message: 'ok' }; });
  await service.connect({ username: 'local-account', password: 'local-password', rememberPassword: true });
  service.clearCredentials();
  online = false;
  await clock.advance(60000);
  assert.deepEqual(calls, ['login', 'status', 'status']);
  assert.equal(service.reconnectContext, null);
  assert.equal(service.snapshot().hasPassword, false);
  assert.equal(JSON.parse(fs.readFileSync(service.file)).credential, null);
});

test('changing an offline identity or profile discards the old reconnect context', async t => {
  const { service, clock } = fixture(t, async (_profile, action) => ({ online: action === 'login', message: 'ok' }));
  await service.connect({ username: 'first-account', password: 'local-password' });
  await service.checkStatus();
  assert.ok(service.reconnectContext);
  service.saveSettings({ username: 'other-account' });
  assert.equal(service.reconnectContext, null);
  assert.equal(clock.count, 0);
  await service.connect({ password: 'new-local-password' });
  await service.checkStatus();
  service.importProfile(JSON.stringify(example));
  service.saveSettings({ profileId: example.id });
  assert.equal(service.reconnectContext, null);
  assert.equal(clock.count, 0);
});

test('in-flight status is serialized and manual logout intent prevents its later reconnection', async t => {
  let finish;
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => {
    calls.push(action);
    if (action === 'status') return new Promise(resolve => { finish = resolve; });
    return { online: true, message: 'ok' };
  });
  await service.connect({ username: 'local-account', password: 'local-password' });
  const pending = clock.fireNext();
  assert.equal(service.busy, true);
  assert.equal(clock.count, 0);
  await service.refreshStatus();
  await service.monitorTick();
  await assert.rejects(service.disconnect(), /稍候/);
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  finish({ online: false, message: 'offline' });
  await pending;
  assert.deepEqual(calls, ['login', 'status']);
  assert.equal(clock.count, 0);
});

test('a timer that meets a busy manual check waits another interval instead of overlapping', async t => {
  let finish;
  let slow = false;
  const calls = [];
  const { service, clock } = fixture(t, async (_profile, action) => {
    calls.push(action);
    if (action === 'status' && slow) return new Promise(resolve => { finish = resolve; });
    return { online: true, message: 'ok' };
  });
  await service.initialize();
  slow = true;
  const manual = service.checkStatus();
  await clock.fireNext();
  assert.deepEqual(calls, ['status', 'status']);
  assert.equal(clock.count, 1);
  assert.equal(clock.delay, 30000);
  finish({ online: true, message: 'online' });
  await manual;
  assert.equal(clock.count, 1);
});

test('manual reconnection resets an older pending deadline to a full interval', async t => {
  let online = true;
  const { service, clock } = fixture(t, async (_profile, action) => {
    if (action === 'login') online = true;
    return { online, message: 'ok' };
  });
  await service.connect({ username: 'local-account', password: 'local-password' });
  await clock.advance(29000);
  online = false;
  await service.checkStatus();
  assert.equal(clock.delay, 1000);
  await service.connect({ password: 'local-password' });
  assert.equal(clock.delay, 30000);
  assert.equal(clock.count, 1);
});

test('dispose prevents a pending status or login completion from restarting the monitor', async t => {
  for (const pendingAction of ['status', 'login', 'rejected-login']) {
    let finish, delayed = false;
    const calls = [];
    const { service, clock } = fixture(t, async (_profile, action) => {
      calls.push(action);
      if (delayed && action === (pendingAction === 'rejected-login' ? 'login' : pendingAction)) return new Promise((resolve, reject) => { finish = value => value instanceof Error ? reject(value) : resolve(value); });
      return { online: true, message: 'ok' };
    });
    await service.connect({ username: 'local-account', password: 'local-password' });
    delayed = true;
    let pending;
    if (pendingAction === 'status') pending = clock.fireNext();
    else { await service.disconnect(); pending = service.connect({ password: 'local-password' }); }
    service.dispose();
    finish(pendingAction === 'rejected-login' ? new CampusError('verify failed', 'VERIFY_FAILED') : { online: true, message: 'online' });
    await pending;
    assert.equal(clock.count, 0);
    assert.equal(service.snapshot().connection.monitoring, false);
    assert.equal(service.reconnectContext, null);
    assert.equal(service.session?.password, undefined);
    const count = calls.length;
    await clock.advance(120000);
    await service.refreshStatus();
    assert.equal(calls.length, count);
  }
});
