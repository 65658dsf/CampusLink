'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseProfile, validateProfile, builtinProfile: builtinDrcomProfile, builtinProfiles, MAX_PROFILE_BYTES } = require('../electron/profiles.cjs');
// Keep legacy Dr.COM protocol fixtures fixed to their mocked authentication host.
const builtinProfile = structuredClone(builtinDrcomProfile);
delete builtinProfile.portalDiscovery;
const { request, parseJsonOrJsonp, CampusError } = require('../electron/transport.cjs');
const { runOperation } = require('../electron/adapters.cjs');
const { CampusService } = require('../electron/service.cjs');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/custom-campus.example.json'), 'utf8'));
const clone = value => structuredClone(value);

test('example validates and preserves declared extension variables', () => {
  assert.equal(validateProfile(example).protocol, 'http');
  assert.equal(parseProfile(JSON.stringify(example)).id, 'example-campus');
});
test('profile validation rejects code, unknown variables, reserved IDs, and cross-origin credentials', () => {
  for (const change of [
    x => { x.script = 'process.exit()'; },
    x => { x.operations.login.data.password = '{{process}}'; },
    x => { x.id = 'builtin-evil'; },
    x => { x.operations.login.url = 'https://attacker.invalid/login'; },
    x => { x.homepage = 'file:///C:/Windows'; },
    x => { x.operations.login.headers = { Host: 'other.invalid' }; },
    x => { x.operations.status.data.password = '{{password}}'; },
    x => { x.operations.status.method = 'POST'; },
    x => { x.operations.login.success.path = '__proto__.polluted'; },
    x => { x.fields[0].key = 'password'; },
    x => { x.operations.login.failure = clone(x.operations.login.success); },
    x => { delete x.operations.status; },
    x => { delete x.operations.logout; },
  ]) {
    const profile = clone(example); change(profile); assert.throws(() => validateProfile(profile));
  }
  assert.throws(() => parseProfile('{"__proto__":{"polluted":true}}'));
  assert.throws(() => parseProfile(' '.repeat(MAX_PROFILE_BYTES + 1)));
  assert.equal({}.polluted, undefined);
});
test('JSONP is parsed as data and cannot execute scripts', () => {
  assert.deepEqual(parseJsonOrJsonp('dr1003({"result":1});'), { result: 1 });
  assert.throws(() => parseJsonOrJsonp('dr1003({result:1});'));
  assert.throws(() => parseJsonOrJsonp('dr1003({"result":1}); process.exit(0);'));
});

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function localProfile(origin) {
  const profile = clone(example);
  profile.homepage = `${origin}/`;
  for (const op of Object.values(profile.operations)) op.url = `${origin}${new URL(op.url).pathname}`;
  return validateProfile(profile);
}
test('HTTP adapter encodes special characters, POST form, JSON logout, and GET status', async t => {
  const requests = [];
  const origin = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url.startsWith('/api/status') ? '{"online":false}' : '{"success":true}');
  });
  const profile = localProfile(origin);
  const context = { username: '张 三+a&b', password: 'secret&=+中文', parameters: { operator: 'campus' } };
  assert.equal((await runOperation(profile, 'login', context)).online, true);
  assert.equal((await runOperation(profile, 'logout', context)).online, false);
  assert.equal((await runOperation(profile, 'status', context)).online, false);
  assert.equal(new URLSearchParams(requests[0].body).get('password'), context.password);
  assert.equal(new URLSearchParams(requests[0].body).get('username'), context.username);
  assert.deepEqual(JSON.parse(requests[1].body), { username: context.username });
  assert.equal(requests[2].method, 'GET');
  assert.equal(requests[2].body, '');
});
test('Dr.COM uses observed local-login parameters without fabricated operator suffixes', async () => {
  const calls = [];
  let online = true;
  const mock = async (url, options) => { const parsed = new URL(url); calls.push({ url: parsed, options }); if (parsed.pathname === '/drcom/logout') online = false; return parsed.pathname === '/drcom/chkstatus' ? `dr1003({"result":${online ? 1 : 0},"v46ip":"10.1.2.3"});` : 'dr1003({"result":"ok"});'; };
  const context = { username: 'student&x', password: 'p+=&密', parameters: { operator: '1' } };
  assert.equal((await runOperation(builtinProfile, 'login', context, mock)).online, true);
  assert.equal((await runOperation(builtinProfile, 'status', {}, mock)).ip, '10.1.2.3');
  assert.equal((await runOperation(builtinProfile, 'logout', context, mock)).online, false);
  const url = calls[0].url;
  assert.equal(url.pathname, '/drcom/login');
  assert.equal(url.searchParams.get('DDDDD'), context.username);
  assert.equal(url.searchParams.get('upass'), context.password);
  assert.equal(url.searchParams.get('R3'), '1');
  assert.equal(url.searchParams.get('0MKKey'), '123456');
  assert.equal(url.searchParams.get('terminal_type'), '1');
  assert.equal(url.searchParams.get('jsVersion'), '4.2.1');
  assert.match(url.searchParams.get('callback'), /^dr\d+$/);
  assert.equal(calls[1].url.pathname, '/drcom/chkstatus');
  assert.equal(calls[3].url.pathname, '/drcom/logout');
  for (const call of calls.slice(1)) assert.equal(call.url.searchParams.has('upass'), false);
});
test('Dr.COM verifies an accepted login before claiming connected', async () => {
  const mock = async url => new URL(url).pathname === '/drcom/login' ? 'dr1003({"result":"ok"});' : 'dr1003({"result":0});';
  await assert.rejects(runOperation(builtinProfile, 'login', { username: 'x', password: 'p' }, mock), { code: 'VERIFY_FAILED' });
});
test('ambiguous, missing and rejected success responses never appear connected', async () => {
  const profile = clone(example);
  for (const response of ['{}', '{"success":false}', 'garbage']) {
    await assert.rejects(runOperation(profile, 'login', {}, async () => response), CampusError);
  }
  profile.operations.login.failure = { type: 'text', includes: 'true' };
  await assert.rejects(runOperation(profile, 'login', {}, async () => '{"success":true}'), /同时匹配/);
  await assert.rejects(runOperation(builtinProfile, 'login', {}, async () => 'dr1003({"result":0,"msg":"secret-password"});'), error => !error.message.includes('secret-password'));
});
test('requests reject redirects so credentials cannot follow to another destination', async t => {
  let followed = false;
  const origin = await fixture(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/target' }); res.end(); }
    else { followed = true; res.end('ok'); }
  });
  await assert.rejects(request(`${origin}/redirect`), { code: 'NETWORK_ERROR' });
  assert.equal(followed, false);
});
test('timeouts and oversized response bodies fail with bounded safe errors', async t => {
  const origin = await fixture(t, (req, res) => {
    if (req.url === '/large') { res.writeHead(200, { 'Content-Length': 2 * 1024 * 1024 }); res.end('x'); }
  });
  await assert.rejects(request(`${origin}/wait`, {}, 40), { code: 'TIMEOUT' });
  await assert.rejects(request(`${origin}/large`), { code: 'RESPONSE_TOO_LARGE' });
});

function serviceFixture(t, operation = async () => ({ online: true, message: '已认证。' }), extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from([...value].reverse().join('')),
    decryptString: value => [...value.toString()].reverse().join(''),
  };
  return new CampusService({ directory, safeStorage: storage, operation, ...extra });
}
test('remembered password is encrypted on disk and absent from snapshots and logs', async t => {
  const service = serviceFixture(t);
  const password = 'DoNotExpose-密码-7391';
  await service.connect({ username: 'student', password, rememberPassword: true });
  const disk = fs.readFileSync(service.file, 'utf8');
  assert.equal(disk.includes(password), false);
  assert.equal(JSON.stringify(service.snapshot()).includes(password), false);
  assert.equal(service.snapshot().hasPassword, true);
  assert.equal(service.decryptPassword(), password);
  await service.disconnect();
  service.saveSettings({ rememberPassword: false });
  assert.equal(JSON.parse(fs.readFileSync(service.file, 'utf8')).credential, null);
  assert.equal(service.snapshot().hasPassword, false);
});
test('unremembered passwords and server error details never persist', async t => {
  const password = 'HiddenSecret123';
  const service = serviceFixture(t, async () => { throw new Error(`Request failed ${password}`); });
  const result = await service.connect({ username: 'student', password, rememberPassword: false });
  assert.equal(result.connection.status, 'error');
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(fs.readFileSync(service.file, 'utf8').includes(password), false);
  assert.equal(result.hasPassword, false);
});
test('changing account removes old credentials and disables automatic connection', async t => {
  const service = serviceFixture(t);
  await service.connect({ username: 'first', password: 'secret', rememberPassword: true });
  await service.disconnect();
  service.saveSettings({ autoConnect: true });
  assert.equal(service.snapshot().settings.autoConnect, true);
  service.saveSettings({ username: 'second' });
  assert.equal(service.snapshot().hasPassword, false);
  assert.equal(service.snapshot().settings.autoConnect, false);
  await assert.rejects(service.connect({}), /密码/);
});
test('automatic authentication is opt-in, requires saved credentials and respects manual logout', async t => {
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation) => { calls.push(operation); return { online: operation === 'login', message: 'ok' }; });
  await service.autoConnectIfEnabled();
  assert.deepEqual(calls, []);
  assert.throws(() => service.saveSettings({ rememberPassword: true, autoConnect: true }), /密码/);
  await service.connect({ username: 'student', password: 'pw', rememberPassword: true });
  await service.disconnect();
  service.saveSettings({ autoConnect: true });
  await service.autoConnectIfEnabled();
  assert.deepEqual(calls, ['login', 'logout', 'status']);
  assert.equal(service.snapshot().connection.reconnectPaused, true);
  assert.equal(service.snapshot().connection.monitoring, false);
});
test('explicit automatic connection requests fail clearly without valid remembered credentials', async t => {
  const service = serviceFixture(t);
  assert.throws(() => service.saveSettings({ autoConnect: true }), /记住密码/);
  assert.equal(service.snapshot().settings.autoConnect, false);
  assert.equal(service.snapshot().settings.rememberPassword, false);
  service.saveSettings({ rememberPassword: true });
  assert.throws(() => service.saveSettings({ autoConnect: true }), /记住密码/);
  await service.connect({ username: 'student', password: 'pw', rememberPassword: true });
  await service.disconnect();
  assert.throws(() => service.saveSettings({ rememberPassword: false, autoConnect: true }), /记住密码/);
  assert.equal(service.snapshot().hasPassword, true);
  assert.throws(() => service.saveSettings({ username: 'other', autoConnect: true }), /记住密码/);
  assert.equal(service.snapshot().settings.username, 'student');
  service.saveSettings({ autoConnect: true });
  assert.equal(service.snapshot().settings.autoConnect, true);
});
test('automatic authentication checks status and skips login when already online', async t => {
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation) => { calls.push(operation); return { online: true, message: 'ok' }; });
  await service.connect({ username: 'student', password: 'pw', rememberPassword: true });
  await service.disconnect();
  service.saveSettings({ autoConnect: true });
  calls.length = 0;
  await service.autoConnectIfEnabled();
  assert.deepEqual(calls, ['status']);
});
test('concurrent actions are blocked and credentials clear disables auto connect', async t => {
  let resolve;
  const service = serviceFixture(t, () => new Promise(done => { resolve = done; }));
  const pending = service.connect({ username: 'student', password: 'pw', rememberPassword: true });
  assert.equal(service.snapshot().connection.status, 'connecting');
  await assert.rejects(service.disconnect(), /稍候/);
  assert.throws(() => service.saveSettings({ username: 'other' }), /稍候/);
  resolve({ online: true, message: 'ok' }); await pending;
  service.clearCredentials();
  assert.equal(service.snapshot().hasPassword, false);
  assert.equal(service.session.password, undefined);
});
test('import supports portable declarative profiles and protects built-in and duplicate IDs', t => {
  const service = serviceFixture(t);
  service.importProfile(JSON.stringify(example));
  assert.equal(service.snapshot().profiles.length, builtinProfiles.length + 1);
  assert.throws(() => service.importProfile(JSON.stringify(example)), /已存在/);
  assert.throws(() => service.removeProfile(builtinProfile.id), /内置/);
  service.saveSettings({ profileId: example.id });
  assert.equal(service.snapshot().settings.parameters.operator, 'campus');
  service.removeProfile(example.id);
  assert.equal(service.snapshot().settings.profileId, builtinProfile.id);
});
test('unavailable secure storage prevents remembering and startup registration errors propagate', t => {
  const service = serviceFixture(t, undefined, { safeStorage: { isEncryptionAvailable: () => false }, autoLaunch: () => { throw new Error('开发预览不注册开机自启动'); } });
  assert.throws(() => service.saveSettings({ rememberPassword: true }), /安全存储/);
  assert.throws(() => service.saveSettings({ autoLaunch: true }), /开发预览/);
  assert.equal(service.snapshot().settings.autoLaunch, false);
});
test('failed status checks do not permit changing the active session destination', async t => {
  const service = serviceFixture(t, async (_profile, operation) => { if (operation === 'status') throw new CampusError('timeout', 'TIMEOUT'); return { online: true, message: 'ok' }; });
  service.importProfile(JSON.stringify(example));
  await service.connect({ username: 'student', password: 'pw' });
  assert.equal(service.snapshot().connection.canDisconnect, true);
  await service.checkStatus();
  assert.equal(service.snapshot().connection.status, 'error');
  assert.equal(service.snapshot().connection.canDisconnect, true);
  assert.throws(() => service.saveSettings({ profileId: example.id }), /断开/);
  assert.throws(() => service.saveSettings({ username: 'other' }), /断开/);
  await assert.rejects(service.connect({ password: 'pw' }), /会话/);
  await service.disconnect();
  assert.equal(service.snapshot().connection.canDisconnect, false);
});
test('a selection field without an explicit default selects its first option', t => {
  const service = serviceFixture(t);
  const profile = clone(example); delete profile.fields[0].default;
  service.importProfile(JSON.stringify(profile));
  service.saveSettings({ profileId: profile.id });
  assert.equal(service.snapshot().settings.parameters.operator, 'campus');
});
test('accepted login with unverified status retains a session until status or logout resolves it', async t => {
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation, context) => {
    calls.push({ operation, username: context.username });
    if (operation === 'login') throw new CampusError('认证服务器已接受请求，但暂时无法确认状态。', 'VERIFY_FAILED');
    return { online: false, message: 'offline' };
  });
  const result = await service.connect({ username: 'student', password: 'private-password' });
  assert.equal(result.connection.status, 'error');
  assert.equal(result.connection.canDisconnect, true);
  assert.equal(JSON.stringify(result).includes('private-password'), false);
  await assert.rejects(service.connect({ password: 'private-password' }), /会话/);
  assert.equal(calls.filter(call => call.operation === 'login').length, 1);
  await service.checkStatus();
  assert.equal(service.snapshot().connection.canDisconnect, false);
  assert.equal(service.session, null);
  await service.connect({ username: 'student', password: 'private-password' });
  await service.disconnect();
  assert.deepEqual(calls.at(-1), { operation: 'logout', username: 'student' });
  assert.equal(service.snapshot().connection.canDisconnect, false);
});

test('startup detects an existing browser session without saved credentials or automatic login', async t => {
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation) => { calls.push(operation); return { online: true, message: 'already online' }; });
  const snapshot = await service.initialize();
  assert.deepEqual(calls, ['status']);
  assert.equal(snapshot.settings.autoConnect, false);
  assert.equal(snapshot.hasPassword, false);
  assert.equal(snapshot.connection.status, 'connected');
  assert.equal(snapshot.connection.canDisconnect, true);
  assert.ok(snapshot.connection.checkedAt);
  assert.equal(snapshot.connection.since, undefined, 'Do not invent a login time for a browser session');
  assert.throws(() => service.saveSettings({ username: 'another-account' }), /断开/);
});

test('startup leaves offline devices on the login form without authenticating by default', async t => {
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation) => { calls.push(operation); return { online: false, message: 'offline' }; });
  const snapshot = await service.initialize();
  assert.deepEqual(calls, ['status']);
  assert.equal(snapshot.connection.status, 'idle');
  assert.equal(snapshot.connection.canDisconnect, false);
});

test('startup does not authenticate when the status is unknown even with automatic login enabled', async t => {
  const calls = [];
  let failStatus = false;
  const service = serviceFixture(t, async (_profile, operation) => {
    calls.push(operation);
    if (failStatus && operation === 'status') throw new CampusError('unknown', 'INVALID_RESPONSE');
    return { online: operation === 'login', message: 'ok' };
  });
  await service.connect({ username: 'student', password: 'pw', rememberPassword: true });
  await service.disconnect();
  service.saveSettings({ autoConnect: true });
  failStatus = true; calls.length = 0;
  const result = await service.initialize();
  assert.equal(result.connection.status, 'error');
  assert.deepEqual(calls, ['status']);
});

test('background status updates are throttled, do not flash the form, and track external logout', async t => {
  let online = true;
  const calls = [];
  const service = serviceFixture(t, async (_profile, operation) => { calls.push(operation); return { online, message: 'ok' }; });
  await service.initialize();
  const events = [];
  service.on('snapshot', snapshot => events.push(snapshot.connection.status));
  const logCount = service.logs.length;
  await service.refreshStatus();
  assert.equal(calls.length, 1, 'focus events within five seconds are coalesced');
  service.lastStatusCheck = 0;
  await service.refreshStatus();
  assert.deepEqual(events, ['connected', 'connected']);
  assert.equal(service.logs.length, logCount, 'unchanged background reads do not spam logs');
  online = false; service.lastStatusCheck = 0;
  await service.refreshStatus();
  assert.equal(service.snapshot().connection.status, 'idle');
  assert.equal(service.session, null);
  assert.equal(calls.every(value => value === 'status'), true);
});

test('slow background reads publish a busy flag while retaining the online session card', async t => {
  let complete;
  const service = serviceFixture(t, () => new Promise(resolve => { complete = resolve; }));
  service.connection = { status: 'connected', message: 'online' };
  const events = [];
  service.on('snapshot', snapshot => events.push(snapshot.connection));
  const read = service.refreshStatus();
  assert.equal(events[0].status, 'connected');
  assert.equal(events[0].refreshing, true);
  assert.equal(events[0].canDisconnect, true);
  complete({ online: true, message: 'online' });
  await read;
  assert.equal(events.at(-1).refreshing, false);
  assert.equal(events.at(-1).status, 'connected');
});
