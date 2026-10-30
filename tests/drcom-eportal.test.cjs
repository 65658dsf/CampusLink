'use strict';

// NingMeng123 — isolated HTTP fixtures; no request reaches a campus gateway.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { drcomEportalOperation } = require('../electron/drcom-eportal.cjs');
const { CampusError } = require('../electron/transport.cjs');

const account = { username: '2026+测试', password: 'a&b+ c/%中文' };
const loginPage = '<html><!--Dr.COMWebLoginID_0.htm--><form><input name="DDDDD"><input name="upass" type="password"></form></html>';
const onlinePage = '<html><!--Dr.COMWebLoginID_1.htm--><body>online</body></html>';

async function fixture(t, initial = {}) {
  const state = { online: false, calls: [], ip: '192.0.2.54', statusMode: 'json', loginReply: { result: 'ok' }, verifyLogin: true, verifyLogout: true, ...initial };
  let origin;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    state.calls.push({ url, method: req.method, headers: req.headers });
    if (url.pathname === '/a79.htm') {
      if (state.pageRedirect) { res.writeHead(302, { Location: state.pageRedirect }); res.end(); }
      else if (!url.searchParams.has('userip') && !state.noPageQuery) {
        res.writeHead(302, { Location: `/a79.htm?userip=${state.ip}&wlanacip=192.0.2.1&wlanacname=AC%2B%E4%B8%AD%E6%96%87` }); res.end();
      } else res.end(state.page ?? (state.online ? onlinePage : loginPage));
    } else if (url.pathname === '/eportal/') {
      if (state.verifyLogin) state.online = true;
      res.end(`dr1003(${JSON.stringify(state.loginReply)});`);
    } else if (url.pathname === '/drcom/chkstatus') {
      if (state.statusMode === 'unsupported') { res.writeHead(404); res.end('not found'); }
      else if (state.statusMode === 'html') res.end('<html>missing endpoint</html>');
      else if (state.statusMode === 'unknown') res.end('dr1003({"result":"maintenance"})');
      else if (state.statusMode === 'empty') res.end('dr1003({})');
      else res.end(`dr1003(${JSON.stringify({ result: state.online ? 1 : 0, v46ip: state.ip })})`);
    } else if (url.pathname === '/drcom/logout') {
      if (state.verifyLogout) state.online = false;
      res.end('dr1003({"result":"ok"});');
    } else { res.writeHead(404); res.end('unexpected fixture URL'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const profile = { id: 'fixture-jcu', protocol: 'drcom-eportal', homepage: `${origin}/a79.htm`, timeoutMs: 1000 };
  return { state, profile, origin };
}

test('JCU uses the referenced ePortal fields, raw account and percent-encoded password, then verifies status', async t => {
  const { state, profile } = await fixture(t);
  const result = await drcomEportalOperation(profile, 'login', account);
  assert.equal(result.online, true);
  assert.equal(result.ip, state.ip);
  const login = state.calls.find(call => call.url.pathname === '/eportal/');
  const params = Object.fromEntries(login.url.searchParams);
  assert.deepEqual({ ...params, v: '<timestamp>' }, {
    c: 'Portal', a: 'login', callback: 'dr1003', login_method: '1',
    user_account: `,0,${account.username}`, user_password: account.password,
    wlan_user_ip: state.ip, wlan_user_ipv6: '', wlan_user_mac: '000000000000',
    wlan_ac_ip: '192.0.2.1', wlan_ac_name: 'AC+中文', jsVersion: '3.3.2', v: '<timestamp>',
  });
  assert.match(login.url.search, /user_password=a%26b%2B%20c%2F%25/);
  assert.equal(login.method, 'GET');
  assert.equal(state.calls.at(-1).url.pathname, '/drcom/chkstatus');
  assert.equal(state.calls.at(-1).url.search.includes('user_password'), false);
  assert.equal((await drcomEportalOperation(profile, 'logout')).online, false);
  assert.equal(state.calls.at(-2).url.pathname, '/drcom/logout');
  assert.equal(state.calls.at(-1).url.pathname, '/drcom/chkstatus');
  assert.ok(state.calls.every(call => !call.headers.cookie && !call.headers.authorization));
});

test('JCU device parameters are discovered afresh and never written back into a profile', async t => {
  const { state, profile } = await fixture(t);
  const before = JSON.stringify(profile);
  await drcomEportalOperation(profile, 'login', account);
  state.online = false; state.ip = '192.0.2.88';
  await drcomEportalOperation(profile, 'login', account);
  assert.deepEqual(state.calls.filter(call => call.url.pathname === '/eportal/').map(call => call.url.searchParams.get('wlan_user_ip')), ['192.0.2.54', '192.0.2.88']);
  assert.equal(JSON.stringify(profile), before);
});

test('a current discovered entry supplies query context only for its login operation', async t => {
  const { profile, state, origin } = await fixture(t, { noPageQuery: true });
  profile.discoveredEntry = `${origin}/a79.htm?userip=192.0.2.90&wlanacip=192.0.2.2&wlanacname=Fresh`;
  await drcomEportalOperation(profile, 'login', account);
  assert.equal(state.calls[0].url.href, profile.discoveredEntry);
  const login = state.calls.find(call => call.url.pathname === '/eportal/').url;
  assert.equal(login.searchParams.get('wlan_user_ip'), '192.0.2.90');
  assert.equal(login.searchParams.get('wlan_ac_name'), 'Fresh');
  state.statusMode = 'unsupported';
  const count = state.calls.length;
  await drcomEportalOperation(profile, 'status');
  assert.equal(state.calls[count + 1].url.href, profile.homepage, 'Status uses a fresh configured page rather than a stale discovered device query');
});

test('unsupported chkstatus falls back to explicit fresh DrCOM markers; unknown responses remain unknown', async t => {
  const { profile, state } = await fixture(t, { statusMode: 'unsupported' });
  assert.equal((await drcomEportalOperation(profile, 'status')).online, false);
  state.online = true;
  assert.equal((await drcomEportalOperation(profile, 'status')).online, true);
  state.statusMode = 'html';
  assert.equal((await drcomEportalOperation(profile, 'status')).online, true);
  for (const page of [
    '<html>internet available</html>',
    '<html><script>const template="<!--Dr.COMWebLoginID_1.htm-->";</script></html>',
    `<html><!--Dr.COMWebLoginID_0.htm--><!--Dr.COMWebLoginID_1.htm--></html>`,
  ]) {
    state.page = page;
    await assert.rejects(drcomEportalOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
  }
  state.statusMode = 'unknown';
  let count = state.calls.length;
  await assert.rejects(drcomEportalOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
  assert.equal(state.calls.length, count + 1, 'Unknown JSON is not treated as an unsupported endpoint');
  state.statusMode = 'empty';
  count = state.calls.length;
  await assert.rejects(drcomEportalOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
  assert.equal(state.calls.length, count + 1);
});

test('status network errors do not fall back or produce a false offline result', async () => {
  let calls = 0;
  await assert.rejects(drcomEportalOperation({ homepage: 'http://campus.example.invalid/a79.htm' }, 'status', {}, async () => {
    calls++;
    throw new CampusError('network unavailable', 'NETWORK_ERROR');
  }), { code: 'NETWORK_ERROR' });
  assert.equal(calls, 1);
});

test('login rejects external, action and credential-bearing redirects before submitting credentials', async t => {
  const { state, profile } = await fixture(t);
  for (const target of ['http://other.example.invalid/a79.htm', '/drcom/login', '/drcom/%6cogout', '/eportal/?c=Portal&a=login', '/F.htm', '/a79.htm?user_password=leak']) {
    state.pageRedirect = target;
    const start = state.calls.length;
    await assert.rejects(drcomEportalOperation(profile, 'login', account), { code: 'PORTAL_REDIRECT' });
    assert.equal(state.calls.length, start + 1);
  }
  delete state.pageRedirect;
  state.page = '<html><script>globalThis.jcuScriptExecuted=true</script></html>';
  await assert.rejects(drcomEportalOperation(profile, 'login', account), { code: 'UNKNOWN_RESPONSE' });
  assert.equal(globalThis.jcuScriptExecuted, undefined);
  assert.equal(state.calls.some(call => call.url.pathname === '/eportal/'), false);
});

test('literal HTML redirect chains provide current device parameters without executing scripts', async t => {
  const { profile, state } = await fixture(t, { noPageQuery: true });
  const page = '<html><input name="DDDDD"><input name="upass"></html>';
  const calls = [];
  const requester = async (url, options) => {
    calls.push(new URL(url));
    options.onResponse({ status: 200 });
    if (calls.length === 1) return '<html><meta http-equiv="refresh" content="0;url=/a79.htm?userip=192.0.2.99&amp;wlanacname=Meta"></html>';
    if (url.pathname === '/a79.htm') return page;
    return url.pathname === '/eportal/' ? 'dr1003({"resCode":0})' : 'dr1003({"result":1})';
  };
  await drcomEportalOperation(profile, 'login', account, requester);
  assert.equal(calls[2].searchParams.get('wlan_user_ip'), '192.0.2.99');
  assert.equal(calls[2].searchParams.get('wlan_ac_name'), 'Meta');
  assert.equal(state.calls.length, 0);
});

test('login does not retransmit credentials when the entry explicitly reports online', async t => {
  const { profile, state } = await fixture(t, { online: true });
  assert.equal((await drcomEportalOperation(profile, 'login', account)).online, true);
  assert.equal(state.calls.some(call => call.url.pathname === '/eportal/'), false);
});

test('identified portal pages do not execute logout or login navigation helpers', async t => {
  const { profile, state } = await fixture(t, { page: loginPage.replace('</html>', '<script>function logout(){location.href="/F.htm";} function login(){location.href="/drcom/login";}</script></html>') });
  assert.equal((await drcomEportalOperation(profile, 'login', account)).online, true);
  assert.equal(state.calls.some(call => ['/F.htm', '/drcom/login'].includes(call.url.pathname)), false);
});

test('conflicting or unknown page markers block credentials even when login inputs remain visible', async t => {
  const { profile, state } = await fixture(t);
  for (const markers of [
    '<!--Dr.COMWebLoginID_0.htm--><!--Dr.COMWebLoginID_1.htm-->',
    '<!--Dr.COMWebLoginID_0.htm--><!--Dr.COMWebLoginID_0.htm-->',
    '<!--Dr.COMWebLoginID_99.htm-->',
  ]) {
    state.page = `<html>${markers}<form><input name="DDDDD"><input name="upass"></form></html>`;
    await assert.rejects(drcomEportalOperation(profile, 'login', account), { code: 'UNKNOWN_RESPONSE' });
  }
  assert.equal(state.calls.some(call => call.url.pathname === '/eportal/'), false);
});

test('server acceptance still requires independent matching status after login and logout', async t => {
  const { profile, state } = await fixture(t, { verifyLogin: false });
  await assert.rejects(drcomEportalOperation(profile, 'login', account), { code: 'VERIFY_FAILED' });
  state.verifyLogin = true;
  state.statusMode = 'unknown';
  await assert.rejects(drcomEportalOperation(profile, 'login', account), { code: 'VERIFY_FAILED' });
  state.statusMode = 'json'; state.verifyLogout = false;
  await assert.rejects(drcomEportalOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
});

test('rejected, contradictory and unknown login results are handled explicitly', async t => {
  const { profile, state } = await fixture(t, { verifyLogin: false });
  for (const [reply, code] of [
    [{ result: 0, msg: 'account unavailable' }, 'AUTH_REJECTED'],
    [{ rescode: 3 }, 'AUTH_REJECTED'],
    [{ result: 0, resCode: 0 }, 'AMBIGUOUS_RESPONSE'],
    [{ result: 'maintenance' }, 'UNKNOWN_RESPONSE'],
    [{}, 'UNKNOWN_RESPONSE'],
  ]) {
    state.loginReply = reply;
    await assert.rejects(drcomEportalOperation(profile, 'login', account), { code });
  }
  for (const reply of [{ result: 1 }, { result: '1' }, { resCode: 0 }, { rescode: '0' }]) {
    state.loginReply = reply; state.verifyLogin = true; state.online = false;
    assert.equal((await drcomEportalOperation(profile, 'login', account)).online, true);
  }
  await assert.rejects(drcomEportalOperation(profile, 'login', {}), { code: 'INVALID_PARAMETERS' });
  await assert.rejects(drcomEportalOperation(profile, 'other'), { code: 'UNSUPPORTED_OPERATION' });
});

test('request observers receive full account and device secrets for diagnostic redaction', async t => {
  const { profile, state } = await fixture(t);
  const registered = [];
  const requester = async (url, options) => {
    options.onResponse({ status: 200 });
    if (url.pathname === '/a79.htm') return loginPage;
    assert.ok(options.diagnosticSecrets.includes(account.username));
    assert.ok(options.diagnosticSecrets.includes(account.password));
    assert.ok(options.diagnosticSecrets.includes(`,0,${account.username}`));
    return url.pathname === '/eportal/' ? 'dr1003({"result":"ok"})' : 'dr1003({"result":1})';
  };
  await drcomEportalOperation(profile, 'login', account, requester, value => registered.push(value));
  assert.ok(registered.includes(`,0,${account.username}`));
  assert.equal(state.calls.length, 0);
});
