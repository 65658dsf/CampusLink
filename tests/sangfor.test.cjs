'use strict';

// NingMeng123 — Sangfor requests use local fixtures and synthetic credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sangforOperation, encryptPassword } = require('../electron/sangfor.cjs');
const { runOperation } = require('../electron/adapters.cjs');

const credentials = { username: 'student+001', password: '密碼+ &/%', parameters: {} };
const passwordForm = '<html><input id="password_name"><input type="password" id="password_pwd"><button id="password_submitBtn">登录</button></html>';

async function fixture(t, initial = {}) {
  const state = { online: false, username: credentials.username, calls: [], ...initial };
  let origin;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, origin);
    const call = { url, method: req.method, headers: req.headers, body, fields: new URLSearchParams(body) };
    state.calls.push(call);
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    if (url.pathname === '/ac_portal/template/pc.html' || url.pathname === '/') {
      if (state.redirect) { res.writeHead(302, { Location: state.redirect }); res.end(); return; }
      res.setHeader('Set-Cookie', ['AUTHSESSID=fixture-session; Path=/; HttpOnly', 'scoped=hidden-cookie; Path=/private']);
      res.end(state.page ?? passwordForm);
    } else if (url.pathname === '/homepage/info.php') {
      if (state.statusCode) { res.writeHead(state.statusCode); res.end('unavailable'); return; }
      if (state.statusBody !== undefined) { res.end(state.statusBody); return; }
      const response = state.online ? { success: true, data: { basic: { name: state.username } } } : { success: false, location: `${origin}/ac_portal/needauth.html` };
      if (state.requireCookie && !req.headers.cookie?.includes('AUTHSESSID=fixture-session')) {
        res.end(JSON.stringify({ success: false, msg: 'missing session' }));
      } else res.end(JSON.stringify(response));
    } else if (url.pathname === '/homepage/index.html') {
      res.end('<html><p>Authenticated homepage</p></html>');
    } else if (url.pathname === '/ac_portal/login.php') {
      if (state.reject) {
        res.end(JSON.stringify({ success: false, msg: [...call.fields.values()].join(' ') }));
        return;
      }
      state.loggedIn = true;
      if (state.verifyLogin !== false) state.online = true;
      state.username = state.reportedUsername || call.fields.get('userName');
      res.end(JSON.stringify(state.loginReply ?? { success: true, msg: 'logon success' }));
    } else if (url.pathname === '/homepage/logout') {
      if (state.verifyLogout !== false) state.online = false;
      res.end(JSON.stringify(state.logoutReply ?? { success: true }));
    } else { res.writeHead(404); res.end('unexpected endpoint'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { state, origin, profile: { id: `fixture-sangfor-${server.address().port}`, protocol: 'sangfor', homepage: `${origin}/ac_portal/template/pc.html?template=template&tabs=pwd`, timeoutMs: 1000 } };
}

test('Sangfor RC4 matches the published standard vector and trims portal passwords', () => {
  assert.equal(encryptPassword('Plaintext', 'Key'), 'bbf316e8d940af0ad3');
  assert.equal(encryptPassword('  Plaintext\t', 'Key'), 'bbf316e8d940af0ad3');
  assert.equal(encryptPassword('\u5bc6', 'Key'), '5b2d');
  assert.throws(() => encryptPassword('password', ''), { code: 'INVALID_PARAMETERS' });
});

test('Sangfor logs in with a fresh timestamp and RC4 password then verifies identity', async t => {
  const { profile, state, origin } = await fixture(t, { requireCookie: true });
  const secrets = [];
  const result = await sangforOperation(profile, 'login', credentials, undefined, value => secrets.push(value));
  assert.equal(result.online, true);
  const login = state.calls.find(call => call.url.pathname === '/ac_portal/login.php');
  assert.equal(login.method, 'POST');
  assert.equal(login.fields.get('opr'), 'pwdLogin');
  assert.equal(login.fields.get('userName'), credentials.username);
  assert.match(login.fields.get('auth_tag'), /^\d{13}$/);
  assert.equal(login.fields.get('pwd'), encryptPassword(credentials.password, login.fields.get('auth_tag')));
  assert.equal(login.fields.get('rememberPwd'), '0');
  assert.equal(login.headers.origin, origin);
  assert.equal(login.headers['x-requested-with'], 'XMLHttpRequest');
  assert.match(login.headers.cookie, /AUTHSESSID=fixture-session/);
  assert.equal(login.headers.cookie.includes('scoped='), false);
  assert.ok(secrets.includes(login.fields.get('pwd')));
  assert.ok(secrets.includes(login.fields.get('auth_tag')));
  assert.ok(secrets.includes('fixture-session'));
  assert.equal(state.calls.at(-1).url.pathname, '/homepage/info.php');
  assert.equal(state.calls.at(-1).fields.get('opr'), 'list');
});

test('Sangfor status requires explicit state and exposes no account identity', async t => {
  const { profile, state } = await fixture(t);
  assert.equal((await sangforOperation(profile, 'status')).online, false);
  state.online = true;
  const result = await sangforOperation(profile, 'status');
  assert.equal(result.online, true);
  assert.equal(Object.hasOwn(result, 'username'), false);
  state.statusBody = JSON.stringify({ success: true, data: { basic: {} } });
  await assert.rejects(sangforOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
  state.statusBody = JSON.stringify({ success: false, msg: 'temporary error' });
  await assert.rejects(sangforOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
});

test('Sangfor never treats malformed or unexpected response structures as online', async t => {
  const { profile, state } = await fixture(t);
  for (const body of ['<html>Login</html>', 'null', '[]', '{"success":"true","data":{"basic":{"name":"student"}}}']) {
    state.statusBody = body;
    await assert.rejects(sangforOperation(profile, 'status'));
  }
});

test('Sangfor skips redundant login and logout when current state is explicit', async t => {
  const { profile, state } = await fixture(t, { online: true });
  assert.equal((await sangforOperation(profile, 'login', credentials)).online, true);
  assert.equal(state.calls.length, 2);
  state.online = false;
  assert.equal((await sangforOperation(profile, 'logout')).online, false);
  assert.equal(state.calls.length, 4);
});

test('Sangfor rejects authentication failures and verifies accepted requests', async t => {
  const { profile, state } = await fixture(t, { reject: true });
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'AUTH_REJECTED' });
  state.reject = false;
  state.verifyLogin = false;
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
  state.verifyLogin = true;
  state.reportedUsername = 'another-user';
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
});

test('Sangfor logout uses the source-backed GET endpoint and rechecks the session', async t => {
  const { profile, state } = await fixture(t, { online: true });
  assert.equal((await sangforOperation(profile, 'logout')).online, false);
  const logout = state.calls.find(call => call.url.pathname === '/homepage/logout');
  assert.equal(logout.method, 'GET');
  assert.equal(state.calls.at(-1).url.pathname, '/homepage/info.php');
  state.online = true;
  state.verifyLogout = false;
  await assert.rejects(sangforOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
  state.logoutReply = { success: false };
  await assert.rejects(sangforOperation(profile, 'logout'), { code: 'AUTH_REJECTED' });
});

test('Sangfor status and logout establish a cookie session and accept online homepages', async t => {
  const { profile, state } = await fixture(t, { online: true, requireCookie: true, redirect: '/homepage/index.html' });
  // The first landing response provides the session before its same-origin
  // redirect. An online homepage has no password controls.
  const requester = async (url, options, timeout) => {
    const { portalRequest } = require('../electron/portal-transport.cjs');
    const onResponse = options.onResponse;
    return portalRequest(url, { ...options, onResponse: response => {
      if (url.pathname === '/ac_portal/template/pc.html') response.setCookies = ['AUTHSESSID=fixture-session; Path=/; HttpOnly'];
      onResponse(response);
    } }, timeout);
  };
  assert.equal((await sangforOperation(profile, 'status', {}, requester)).online, true);
  assert.equal((await sangforOperation(profile, 'logout', {}, requester)).online, false);
  assert.equal(state.calls.some(call => call.url.pathname === '/ac_portal/login.php'), false);
});

test('Sangfor normal adapter routing redacts timestamp, ciphertext and session diagnostics', async t => {
  const { profile, state } = await fixture(t, { reject: true });
  let caught;
  try { await runOperation(profile, 'login', credentials); } catch (error) { caught = error; }
  assert.equal(caught?.code, 'AUTH_REJECTED');
  const login = state.calls.find(call => call.url.pathname === '/ac_portal/login.php');
  const output = JSON.stringify(caught.diagnostics);
  for (const secret of [credentials.username, credentials.password, login.fields.get('auth_tag'), login.fields.get('pwd'), 'fixture-session']) assert.equal(output.includes(secret), false);
  state.reject = false;
  assert.equal((await runOperation(profile, 'login', credentials)).online, true);
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.equal((await runOperation(profile, 'logout')).online, false);
});

test('Sangfor confirms password input controls before submitting credentials', async t => {
  const { profile, state } = await fixture(t, { page: '<html><h1>Other service</h1></html>' });
  for (const page of [state.page, '<input data-id="password_name"><input data-id="password_pwd">', `<script>const sample=${JSON.stringify(passwordForm)};</script>`]) {
    state.page = page;
    await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'PORTAL_PARAMETERS' });
  }
  assert.equal(state.calls.some(call => call.url.pathname === '/ac_portal/login.php'), false);
  state.page = '<html><input id=password_name><input id=password_pwd></html>';
  assert.equal((await sangforOperation(profile, 'login', credentials)).online, true);
});

test('Sangfor bounds same-origin discovery and rejects external redirects', async t => {
  const { profile, state } = await fixture(t, { redirect: 'https://example.org/ac_portal/template/pc.html' });
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'PORTAL_REDIRECT' });
  state.redirect = '/homepage/logout';
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'PORTAL_REDIRECT' });
  state.redirect = '/';
  await assert.rejects(sangforOperation(profile, 'login', credentials), { code: 'PORTAL_REDIRECT' });
  assert.equal(state.calls.some(call => call.url.pathname === '/ac_portal/login.php'), false);
});

test('Sangfor rejects cross-origin locations returned by the state endpoint', async t => {
  const { profile } = await fixture(t, { statusBody: JSON.stringify({ success: false, location: 'https://example.org/ac_portal/needauth.html' }) });
  await assert.rejects(sangforOperation(profile, 'status'), { code: 'PORTAL_REDIRECT' });
});

test('Sangfor supports a manually supplied school portal and validates its origin', async t => {
  const { profile, state } = await fixture(t);
  const override = { ...credentials, parameters: { portalUrl: profile.homepage } };
  assert.equal((await sangforOperation({ ...profile, homepage: 'http://192.0.2.99/' }, 'login', override)).online, true);
  assert.ok(state.calls.length > 0);
  for (const portalUrl of ['file:///ac_portal/template/pc.html', 'http://user:password@example.org/', 'https://example.org/#token', 17]) {
    await assert.rejects(sangforOperation(profile, 'login', { ...credentials, parameters: { portalUrl } }), { code: 'INVALID_PARAMETERS' });
  }
});

test('Sangfor rejects invalid credentials without sending a login request', async t => {
  const { profile, state } = await fixture(t);
  for (const values of [{ username: '', password: 'x' }, { username: 'user\nname', password: 'x' }, { username: 'user', password: '  ' }]) {
    await assert.rejects(sangforOperation(profile, 'login', values), { code: 'INVALID_PARAMETERS' });
  }
  assert.equal(state.calls.some(call => call.url.pathname === '/ac_portal/login.php'), false);
});
