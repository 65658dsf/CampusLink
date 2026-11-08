'use strict';

// NingMeng123 — CQU protocol fixtures are synthetic and use loopback only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runOperation } = require('../electron/adapters.cjs');
const { drcomEportalOperation } = require('../electron/drcom-eportal.cjs');
const { CampusError } = require('../electron/transport.cjs');

const credentials = { username: '2026+校园', password: 'cqu secret+&/%密码' };

async function fixture(t, initial = {}) {
  const state = {
    online: false, ip: '192.0.2.61', calls: [], statusReplies: [],
    loginReply: { result: 1 }, logoutReply: { result: 1 },
    verifyLogin: true, verifyLogout: true, ...initial,
  };
  async function listen(destination, handler) {
    const server = http.createServer((req, res) => {
      state.calls.push({ destination, url: new URL(req.url, `http://${req.headers.host}`), method: req.method, headers: req.headers });
      handler(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  function reply(res, value) {
    res.end(typeof value === 'string' ? value : `dr1002(${JSON.stringify(value)});`);
  }
  const origin = await listen('portal', (req, res) => {
    if (!req.url.startsWith('/drcom/chkstatus?')) { res.writeHead(404); res.end('unexpected portal path'); return; }
    if (state.statusRedirect) { res.writeHead(302, { Location: state.statusRedirect }); res.end(); return; }
    if (state.statusHttp) { res.writeHead(state.statusHttp); res.end('portal unavailable'); return; }
    reply(res, state.statusReplies.length ? state.statusReplies.shift() : {
      result: 1, v46ip: state.ip, ...(state.online ? { uid: credentials.username } : {}),
    });
  });
  const apiOrigin = await listen('api', (req, res) => {
    const url = new URL(req.url, 'http://local.invalid');
    if (state.apiRedirect) { res.writeHead(302, { Location: state.apiRedirect }); res.end(); return; }
    if (url.pathname === '/eportal/portal/login') {
      if (state.verifyLogin) state.online = true;
      reply(res, state.loginReply);
    } else if (url.pathname === '/eportal/portal/logout') {
      if (state.verifyLogout) state.online = false;
      reply(res, state.logoutReply);
    } else { res.writeHead(404); res.end('unexpected API path'); }
  });
  const profile = {
    id: `fixture-cqu-${new URL(origin).port}`, homepage: `${origin}/`,
    protocol: 'drcom-eportal', timeoutMs: 1000,
    drcomEportal: { variant: 'portal-v4', apiPort: Number(new URL(apiOrigin).port), dialect: 'cqu' },
  };
  return { state, profile, origin, apiOrigin };
}

test('CQU uses fresh read-only identity and the documented PC login fields on the API port', async t => {
  const { state, profile, origin, apiOrigin } = await fixture(t);
  const result = await runOperation(profile, 'login', credentials);
  assert.equal(result.online, true);
  assert.equal(result.ip, state.ip);
  assert.equal(result.portalUrl, `${origin}/`);
  assert.deepEqual(state.calls.map(call => call.destination), ['portal', 'api', 'portal']);
  const login = state.calls[1];
  assert.equal(login.url.origin, apiOrigin);
  assert.equal(login.url.pathname, '/eportal/portal/login');
  assert.deepEqual([...login.url.searchParams].map(([key, value]) => [key, key === 'v' ? '<nonce>' : value]), [
    ['callback', 'dr1004'], ['login_method', '1'],
    ['user_account', `,0,${credentials.username}`], ['user_password', credentials.password],
    ['wlan_user_ip', state.ip], ['wlan_user_ipv6', ''], ['wlan_user_mac', '000000000000'],
    ['wlan_ac_ip', ''], ['wlan_ac_name', ''],
    ['term_ua', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0'],
    ['term_type', '1'], ['jsVersion', '4.2.2'], ['terminal_type', '1'],
    ['lang', 'zh-cn'], ['v', '<nonce>'], ['lang', 'zh-cn'],
  ]);
  assert.match(login.url.search, /user_password=cqu%20secret%2B%26%2F%25/);
  assert.equal(login.headers.host, new URL(apiOrigin).host);
  assert.equal(login.headers.referer, `${origin}/`);
  for (const call of state.calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers.authorization, undefined);
    if (call.destination === 'portal') {
      assert.equal(call.url.origin, origin);
      assert.equal(call.url.pathname, '/drcom/chkstatus');
      assert.deepEqual({ ...Object.fromEntries(call.url.searchParams), v: '<nonce>' }, { callback: 'dr1002', jsVersion: '4.X', v: '<nonce>', lang: 'zh' });
    }
  }
});

test('CQU result=1 and IP without uid is offline; uid is required for online', async t => {
  const { state, profile } = await fixture(t);
  assert.equal((await runOperation(profile, 'status')).online, false);
  state.online = true;
  assert.equal((await runOperation(profile, 'status')).online, true);
  const before = state.calls.length;
  assert.equal((await runOperation(profile, 'login', credentials)).online, true);
  assert.equal(state.calls.length, before + 1, 'Already-online sessions do not resubmit credentials');
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
});

test('CQU login rereads its IP for every connection and never caches identity in the profile', async t => {
  const { state, profile } = await fixture(t);
  const before = JSON.stringify(profile);
  await runOperation(profile, 'login', credentials);
  state.online = false; state.ip = '192.0.2.93';
  await runOperation(profile, 'login', credentials);
  assert.deepEqual(state.calls.filter(call => call.destination === 'api').map(call => call.url.searchParams.get('wlan_user_ip')), ['192.0.2.61', '192.0.2.93']);
  assert.equal(JSON.stringify(profile), before);
});

test('CQU accepts uid/IP status without result but rejects missing, malformed and contradictory identity', async t => {
  const { state, profile } = await fixture(t);
  for (const reply of [
    { v46ip: state.ip }, { result: 0, v46ip: state.ip }, { result: '1', v46ip: state.ip, uid: '' },
  ]) {
    state.statusReplies.push(reply);
    assert.equal((await runOperation(profile, 'status')).online, false);
  }
  state.statusReplies.push({ uid: 'synthetic-account', v46ip: state.ip });
  assert.equal((await runOperation(profile, 'status')).online, true);
  for (const reply of [
    {}, [], null, { result: 1 }, { result: 1, v46ip: 'garbage' },
    { result: 1, v46ip: '::1' }, { result: 1, v46ip: '0.0.0.0' },
    { result: 1, v46ip: '255.255.255.255' }, { result: 1, v46ip: state.ip, uid: 42 },
    { result: true, v46ip: state.ip }, { result: 'maintenance', v46ip: state.ip },
    { result: 1, v46ip: state.ip, resCode: 2 }, { result: 1, v46ip: state.ip, uid: 'bad\nidentity' },
    '<html>maintenance</html>',
  ]) {
    state.statusReplies.push(reply);
    await assert.rejects(runOperation(profile, 'login', credentials));
  }
  state.statusReplies.push({ result: 0, v46ip: state.ip, uid: 'synthetic-account' });
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'AMBIGUOUS_RESPONSE' });
  assert.equal(state.calls.some(call => call.destination === 'api'), false, 'Unknown status never sends credentials');
});

test('CQU status transport failures and redirects do not submit credentials or follow other hosts', async t => {
  const { state, profile } = await fixture(t, { statusHttp: 503 });
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'HTTP_ERROR' });
  state.statusHttp = 0; state.statusRedirect = 'http://must-not-contact.example.invalid/';
  await assert.rejects(runOperation(profile, 'login', credentials));
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
  let calls = 0;
  await assert.rejects(drcomEportalOperation(profile, 'login', credentials, async () => {
    calls++;
    throw new CampusError('fixture network failure', 'NETWORK_ERROR');
  }), { code: 'NETWORK_ERROR' });
  assert.equal(calls, 1);
});

test('CQU accepted login requires a new online state for the same device IP', async t => {
  const { state, profile } = await fixture(t, { verifyLogin: false });
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
  for (const verification of [
    { result: 1, v46ip: state.ip },
    { result: 1, v46ip: '192.0.2.99', uid: credentials.username },
    { result: 1, uid: credentials.username },
    '<html>unknown state</html>',
  ]) {
    state.statusReplies.push({ result: 1, v46ip: state.ip }, verification);
    await assert.rejects(runOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
  }
});

test('CQU logs out through the bare API and confirms status without credentials or MAC unbinding', async t => {
  const { state, profile, apiOrigin } = await fixture(t, { online: true });
  for (const response of [{ result: 1 }, { resCode: 0 }, 'Radius注销成功！']) {
    state.online = true; state.logoutReply = response;
    assert.equal((await runOperation(profile, 'logout')).online, false);
  }
  assert.equal(state.calls.filter(call => call.destination === 'api').length, 3);
  for (const call of state.calls.filter(call => call.destination === 'api')) {
    assert.equal(call.url.href, `${apiOrigin}/eportal/portal/logout`);
  }
  assert.deepEqual(state.calls.map(call => call.destination), ['api', 'portal', 'api', 'portal', 'api', 'portal']);
  assert.equal(state.calls.some(call => call.url.pathname.includes('unbind')), false);
});

test('CQU logout rejects arbitrary success-like text and still requires offline confirmation', async t => {
  const { state, profile } = await fixture(t, { online: true, verifyLogout: false });
  for (const response of [{ result: 1 }, 'Radius注销成功！']) {
    state.logoutReply = response;
    await assert.rejects(runOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
  }
  for (const response of [
    'failed: Radius注销成功！', '<html>Radius注销成功！</html>',
    { msg: 'Radius注销成功！' }, { result: 0, msg: 'Radius注销成功！' },
    { result: 0, resCode: 0 },
  ]) {
    state.logoutReply = response;
    const before = state.calls.length;
    await assert.rejects(runOperation(profile, 'logout'));
    assert.equal(state.calls.length, before + 1);
  }
});

test('CQU rejects failed, conflicting and unknown login results without retrying credentials', async t => {
  const { state, profile } = await fixture(t, { verifyLogin: false });
  for (const [response, code] of [
    [{ result: 0 }, 'AUTH_REJECTED'], [{ result: 1, resCode: 5 }, 'AMBIGUOUS_RESPONSE'],
    [{ result: 'maintenance' }, 'UNKNOWN_RESPONSE'], [{}, 'UNKNOWN_RESPONSE'],
  ]) {
    state.loginReply = response;
    const before = state.calls.length;
    await assert.rejects(runOperation(profile, 'login', credentials), { code });
    assert.equal(state.calls.length, before + 2);
  }
});

test('CQU errors redact credentials, prefixed accounts and discovered identity through runOperation', async t => {
  const account = `,0,${credentials.username}`;
  const { state, profile } = await fixture(t, { verifyLogin: false });
  state.loginReply = { result: 0, msg: `${account} ${credentials.password} ${state.ip}` };
  await assert.rejects(runOperation(profile, 'login', credentials), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    assert.ok(error.diagnostics.length >= 2);
    const output = JSON.stringify({ message: error.message, diagnostics: error.diagnostics });
    for (const secret of [credentials.username, credentials.password, account, state.ip]) {
      assert.equal(output.includes(secret), false);
      assert.equal(output.includes(encodeURIComponent(secret)), false);
    }
    return true;
  });
});

test('CQU rejects invalid parameters before sending a request', async t => {
  const { state, profile } = await fixture(t);
  for (const context of [{}, { username: 'student' }, { username: 12, password: 'secret' }]) {
    await assert.rejects(runOperation(profile, 'login', context), { code: 'INVALID_PARAMETERS' });
  }
  await assert.rejects(drcomEportalOperation(profile, 'unsupported'), { code: 'UNSUPPORTED_OPERATION' });
  await assert.rejects(drcomEportalOperation({ ...profile, drcomEportal: { ...profile.drcomEportal, apiPort: 0 } }, 'login', credentials), { code: 'INVALID_PROFILE' });
  assert.equal(state.calls.length, 0);
});
