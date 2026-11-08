'use strict';

// NingMeng123 — all gateway requests below stay on local HTTP fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHmac, createHash } = require('node:crypto');
const { srunOperation, xencode } = require('../electron/srun.cjs');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfiles, profileParameters } = require('../electron/profiles.cjs');

const credentials = { username: 'student+测试', password: '密碼+ a&b/%', parameters: {} };
const challenge = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const alphabet = 'LVoJPiCN2R8G90yg+hmFHuacZ1OWMnrsSTXkYpUq/3dlbfKwv6xztjI7DeBE45QA';
const normal = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeInfo(info, token) {
  const ciphertext = info.slice(7).replace(/[A-Za-z0-9+/]/g, character => normal[alphabet.indexOf(character)]);
  const bytes = Buffer.from(ciphertext, 'base64');
  const words = Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
  const keyBytes = Buffer.alloc(16); Buffer.from(token).copy(keyBytes, 0, 0, 16);
  const key = Array.from({ length: 4 }, (_, index) => keyBytes.readUInt32LE(index * 4));
  const rounds = Math.floor(6 + 52 / words.length);
  let sum = Math.imul(rounds, 0x9e3779b9) >>> 0;
  let next = words[0];
  for (let round = 0; round < rounds; round++) {
    const selector = sum >>> 2 & 3;
    for (let index = words.length - 1; index >= 0; index--) {
      const previous = words[(index + words.length - 1) % words.length];
      const mixed = (previous >>> 5 ^ next << 2)
        + ((next >>> 3 ^ previous << 4) ^ (sum ^ next))
        + (key[(index & 3) ^ selector] ^ previous);
      next = words[index] = (words[index] - mixed) >>> 0;
    }
    sum = (sum - 0x9e3779b9) >>> 0;
  }
  const length = words.pop();
  const plain = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => plain.writeUInt32LE(word, index * 4));
  return JSON.parse(plain.subarray(0, length).toString('utf8'));
}

async function fixture(t, initial = {}) {
  const state = { online: false, ip: '192.0.2.73', username: '', acId: '7', calls: [], ...initial };
  let origin;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    state.calls.push({ url, method: req.method, headers: req.headers });
    if (url.pathname === '/') {
      if (state.pageRedirect) { res.writeHead(302, { Location: state.pageRedirect }); res.end(); }
      else res.end(state.page ?? `<html><meta http-equiv="refresh" content="0;url=/srun_portal_pc?ac_id=${state.acId}&amp;theme=pro"></html>`);
    } else if (url.pathname === '/srun_portal_pc') {
      res.end(state.finalPage ?? `<html><script>var CONFIG={acid:'${state.acId}',ip:'${state.ip}'};</script></html>`);
    } else if (url.pathname === '/cgi-bin/rad_user_info') {
      if (state.statusRedirect) { res.writeHead(302, { Location: state.statusRedirect }); res.end(); }
      else if (state.statusCode) { res.writeHead(state.statusCode); res.end('unavailable'); }
      else if (state.statusBody !== undefined) res.end(state.statusBody);
      else res.end(`jQuery(${JSON.stringify(state.online ? { error: 'ok', user_name: state.username || credentials.username, online_ip: state.ip } : { error: 'not_online_error', online_ip: state.ip })});`);
    } else if (url.pathname === '/cgi-bin/get_challenge') {
      if (state.challengeRedirect) { res.writeHead(302, { Location: state.challengeRedirect }); res.end(); }
      else res.end(`jQuery(${JSON.stringify(state.challengeReply ?? { error: 'ok', res: 'ok', challenge, client_ip: state.ip })});`);
    } else if (url.pathname === '/cgi-bin/srun_portal') {
      if (state.apiRedirect) { res.writeHead(302, { Location: state.apiRedirect }); res.end(); return; }
      if (state.reject) {
        res.end(`jQuery(${JSON.stringify({ error: 'login_error', res: 'login_error', error_msg: `${credentials.username} ${credentials.password} ${url.searchParams.get('username')} ${url.searchParams.get('info')} ${url.searchParams.get('password')} ${challenge}` })});`);
        return;
      }
      if (url.searchParams.get('action') === 'login') {
        state.username = state.reportedUsername || url.searchParams.get('username');
        if (state.verifyLogin !== false) state.online = true;
      } else if (state.verifyLogout !== false) state.online = false;
      res.end(`jQuery(${JSON.stringify(state.apiReply ?? { error: 'ok', res: 'ok', suc_msg: 'login_ok' })});`);
    } else { res.writeHead(404); res.end('unexpected request'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { state, origin, profile: { id: `fixture-srun-${server.address().port}`, protocol: 'srun', homepage: `${origin}/`, timeoutMs: 1000, srun: { acId: '1', hmacMode: 'password' } } };
}

test('SRun xencode matches the published independent Go protocol vector', () => {
  assert.equal(xencode('aaaaaaaaaaaa', 'bbbbbbbbbbbb').toString('hex'), 'd4eb3234a6e57d455fdca5bcbefb3ad1');
});

test('SRun sends the BX1 info, HMAC and checksum and verifies the current session', async t => {
  const { state, profile, origin } = await fixture(t);
  const result = await srunOperation(profile, 'login', credentials);
  assert.equal(result.online, true); assert.equal(result.ip, state.ip); assert.equal(result.portalUrl, `${origin}/`);
  const request = state.calls.find(call => call.url.searchParams.get('action') === 'login');
  const params = request.url.searchParams;
  assert.equal(request.method, 'GET'); assert.equal(request.url.origin, origin);
  assert.equal(params.get('username'), credentials.username);
  assert.deepEqual(decodeInfo(params.get('info'), challenge), { username: credentials.username, password: credentials.password, ip: state.ip, acid: '1', enc_ver: 'srun_bx1' });
  const hmd5 = createHmac('md5', challenge).update(credentials.password).digest('hex');
  assert.equal(params.get('password'), `{MD5}${hmd5}`);
  const check = [credentials.username, hmd5, '1', state.ip, '200', '1', params.get('info')].map(value => challenge + value).join('');
  assert.equal(params.get('chksum'), createHash('sha1').update(check).digest('hex'));
  assert.equal(params.get('n'), '200'); assert.equal(params.get('type'), '1');
  assert.equal(state.calls.at(-1).url.pathname, '/cgi-bin/rad_user_info');
  assert.equal(state.calls.some(call => call.url.searchParams.get('password') === credentials.password), false);
});

test('BIT/HDU empty-message HMAC differs from password-message deployments', async t => {
  const { state, profile } = await fixture(t); profile.srun.hmacMode = 'empty';
  await srunOperation(profile, 'login', credentials);
  const params = state.calls.find(call => call.url.searchParams.get('action') === 'login').url.searchParams;
  assert.equal(params.get('password'), `{MD5}${createHmac('md5', challenge).update('').digest('hex')}`);
  assert.equal(decodeInfo(params.get('info'), challenge).password, credentials.password);
});

test('SRun reads a current AC identifier from bounded same-origin redirects and rejects conflicts', async t => {
  const { state, profile } = await fixture(t); profile.srun.acId = 'auto';
  await srunOperation(profile, 'login', credentials);
  assert.equal(state.calls.find(call => call.url.searchParams.get('action') === 'login').url.searchParams.get('ac_id'), '7');
  state.online = false; state.acId = '8';
  await srunOperation(profile, 'login', credentials);
  assert.equal(state.calls.filter(call => call.url.searchParams.get('action') === 'login').at(-1).url.searchParams.get('ac_id'), '8');
  state.online = false; state.finalPage = '<html><script>var CONFIG={acid:"99"}</script></html>';
  const before = state.calls.filter(call => call.url.pathname === '/cgi-bin/srun_portal').length;
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'PORTAL_PARAMETERS' });
  assert.equal(state.calls.filter(call => call.url.pathname === '/cgi-bin/srun_portal').length, before);
});

test('SRun suffix selection preserves complete accounts and rejects conflicts', async t => {
  const { state, profile } = await fixture(t);
  profile.srun.usernameSuffix = '@study';
  profile.fields = [{ key: 'suffix', default: '@study', options: [{ label: '校园网', value: '@study' }, { label: '完整账号', value: '' }] }];
  await srunOperation(profile, 'login', credentials);
  assert.equal(state.username, `${credentials.username}@study`);
  state.online = false;
  await srunOperation(profile, 'login', { ...credentials, username: `${credentials.username}@study` });
  assert.equal(state.username, `${credentials.username}@study`);
  state.online = false;
  await assert.rejects(srunOperation(profile, 'login', { ...credentials, username: 'student@other' }), { code: 'INVALID_PARAMETERS' });
  await srunOperation(profile, 'login', { ...credentials, username: 'student@other', parameters: { suffix: '' } });
  assert.equal(state.username, 'student@other');
});

test('SRun status and an already online login do not send challenge or credentials', async t => {
  const { state, profile } = await fixture(t, { online: true });
  assert.equal((await srunOperation(profile, 'status')).online, true);
  assert.equal((await srunOperation(profile, 'login', credentials)).online, true);
  assert.ok(state.calls.every(call => call.url.pathname === '/cgi-bin/rad_user_info' && !call.url.searchParams.has('username')));
});

test('SRun logout uses the confirmed session identity without a password and verifies offline', async t => {
  const { state, profile } = await fixture(t, { online: true, username: 'browser-session@campus' });
  assert.equal((await srunOperation(profile, 'logout')).online, false);
  const logout = state.calls.find(call => call.url.searchParams.get('action') === 'logout').url;
  assert.equal(logout.searchParams.get('username'), 'browser-session@campus');
  assert.equal(logout.searchParams.get('ip'), state.ip);
  assert.equal(logout.searchParams.has('password'), false); assert.equal(logout.searchParams.has('info'), false);
  assert.equal(state.calls.at(-1).url.pathname, '/cgi-bin/rad_user_info');
});

test('SRun offline logout is read-only and unknown states never trigger authentication', async t => {
  const { state, profile } = await fixture(t);
  assert.equal((await srunOperation(profile, 'logout')).online, false);
  for (const body of ['jQuery({})', 'jQuery({"error":"maintenance"})', 'jQuery({"error":"ok","online_ip":"192.0.2.73"})', 'jQuery({"error":"not_online_error","user_name":"conflict"})', '<html>success</html>']) {
    state.statusBody = body;
    await assert.rejects(srunOperation(profile, 'login', credentials));
  }
  assert.ok(state.calls.every(call => call.url.pathname === '/cgi-bin/rad_user_info'));
});

test('SRun fails malformed challenge, IP and operation responses without credential retries', async t => {
  const { state, profile } = await fixture(t);
  for (const response of [{}, { error: 'ok', challenge: 'short' }, { error: 'failed', challenge, client_ip: state.ip }]) {
    state.challengeReply = response;
    await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'UNKNOWN_RESPONSE' });
  }
  state.challengeReply = { error: 'ok', challenge, client_ip: 'invalid-address' };
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'PORTAL_PARAMETERS' });
  assert.equal(state.calls.some(call => call.url.pathname === '/cgi-bin/srun_portal'), false);
  delete state.challengeReply;
  state.apiReply = { error: 'login_error', res: 'ok' };
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'AUTH_REJECTED' });
  assert.equal(state.calls.filter(call => call.url.searchParams.get('action') === 'login').length, 1);
});

test('SRun accepted operations still require independent matching status', async t => {
  const { state, profile } = await fixture(t, { verifyLogin: false });
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
  state.online = true; state.verifyLogout = false;
  await assert.rejects(srunOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
  state.online = false; state.verifyLogin = true; state.reportedUsername = 'different-session';
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
});

test('SRun discovery and APIs reject action, cross-origin and credential-forwarding redirects', async t => {
  const { state, profile } = await fixture(t); profile.srun.acId = 'auto';
  for (const target of ['http://outside.example.invalid/srun_portal_pc?ac_id=7', '/cgi-bin/srun_portal?action=logout', '/srun_portal_pc?ac_id=7&username=leak']) {
    state.pageRedirect = target;
    await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'PORTAL_REDIRECT' });
  }
  assert.equal(state.calls.some(call => call.url.pathname === '/cgi-bin/get_challenge'), false);
  delete state.pageRedirect; profile.srun.acId = '1';
  state.apiRedirect = 'http://outside.example.invalid/collect';
  await assert.rejects(srunOperation(profile, 'login', credentials), error => ['NETWORK_ERROR', 'PORTAL_REDIRECT'].includes(error.code));
});

test('SRun automatic discovery never executes an action-bearing configured entry', async t => {
  const { state, profile, origin } = await fixture(t);
  profile.srun.acId = 'auto';
  profile.homepage = `${origin}/cgi-bin/srun_portal?action=logout`;
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'PORTAL_REDIRECT' });
  assert.ok(state.calls.every(call => call.url.pathname === '/cgi-bin/rad_user_info'));
});

test('SRun route integration redacts raw credentials, HMAC, BX1 info and challenges', async t => {
  const { state, profile } = await fixture(t, { reject: true });
  await assert.rejects(runOperation(profile, 'login', credentials), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    const output = JSON.stringify({ message: error.message, diagnostics: error.diagnostics });
    const login = state.calls.find(call => call.url.searchParams.get('action') === 'login').url.searchParams;
    for (const secret of [credentials.username, credentials.password, challenge, login.get('info'), login.get('password')]) assert.equal(output.includes(secret), false, secret);
    return true;
  });
});

test('SRun reports CAPTCHA separately for the existing automatic reconnect guard', async t => {
  const { state, profile } = await fixture(t);
  state.apiReply = { error: 'login_error', error_msg: '需要验证码 captcha' };
  await assert.rejects(srunOperation(profile, 'login', credentials), { code: 'CAPTCHA_REQUIRED' });
});

test('SDU password-update reminder is accepted only for a verified login', async t => {
  const definition = builtinProfiles.find(profile => profile.id === 'builtin-sdu-srun');
  const { state, origin } = await fixture(t);
  const profile = { ...structuredClone(definition), homepage: `${origin}/` };
  state.apiReply = { error: 'up_pwd_alert', res: 'ok' };
  const loggedIn = await runOperation(profile, 'login', credentials);
  assert.equal(loggedIn.online, true);
  assert.match(loggedIn.message, /更新密码/);
  await assert.rejects(runOperation(profile, 'logout'), { code: 'AUTH_REJECTED' });
  state.online = false; state.verifyLogin = false;
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
});

test('all eight shipped SRun schools use their own catalog settings through normal dispatch', async t => {
  const expected = [
    ['builtin-bit-srun', '7', 'empty', ''],
    ['builtin-hdu-srun', '0', 'empty', ''],
    ['builtin-jxnu-srun', '1', 'password', ''],
    ['builtin-lzu-srun', '2', 'password', '@study'],
    ['builtin-ucas-srun', '1', 'password', ''],
    ['builtin-ncu-srun', '7', 'password', '@ncu'],
    ['builtin-ncepu-srun', '1', 'password', ''],
    ['builtin-sdu-srun', '1', 'password', ''],
  ];
  assert.deepEqual(builtinProfiles.filter(profile => profile.protocol === 'srun').map(profile => profile.id).sort(), expected.map(([id]) => id).sort());
  for (const [id, expectedAcId, hmacMode, defaultSuffix] of expected) {
    await t.test(id, async subtest => {
      const definition = builtinProfiles.find(profile => profile.id === id);
      const before = JSON.stringify(definition);
      const { state, origin } = await fixture(subtest);
      const profile = { ...structuredClone(definition), homepage: `${origin}/` };
      const parameters = profileParameters(profile);
      assert.equal((await runOperation(profile, 'login', { ...credentials, parameters })).online, true);
      let login = state.calls.find(call => call.url.searchParams.get('action') === 'login').url.searchParams;
      const username = credentials.username + defaultSuffix;
      assert.equal(login.get('username'), username);
      assert.equal(login.get('ac_id'), expectedAcId);
      assert.equal(login.get('password'), `{MD5}${createHmac('md5', challenge).update(hmacMode === 'empty' ? '' : credentials.password).digest('hex')}`);
      assert.deepEqual(decodeInfo(login.get('info'), challenge), { username, password: credentials.password, ip: state.ip, acid: expectedAcId, enc_ver: 'srun_bx1' });
      assert.equal((await runOperation(profile, 'status', { parameters })).online, true);
      assert.equal((await runOperation(profile, 'logout', { parameters })).online, false);
      for (const choice of profile.fields?.find(field => field.key === 'suffix')?.options || []) {
        const selected = profileParameters(profile, { suffix: choice.value });
        const enteredUsername = choice.value ? credentials.username : `${credentials.username}@existing`;
        await runOperation(profile, 'login', { ...credentials, username: enteredUsername, parameters: selected });
        login = state.calls.filter(call => call.url.searchParams.get('action') === 'login').at(-1).url.searchParams;
        assert.equal(login.get('username'), enteredUsername + choice.value);
        await runOperation(profile, 'logout', { parameters: selected });
      }
      assert.equal(JSON.stringify(definition), before, 'Runtime gateway state does not modify the shipped catalog');
      assert.ok(state.calls.every(call => call.url.origin === origin && call.method === 'GET'));
    });
  }
});
