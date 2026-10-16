'use strict';

// NingMeng123 — local ePortal fixtures only; never contacts a campus gateway.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOperation } = require('../electron/adapters.cjs');
const { encryptPassword } = require('../electron/ruijie.cjs');
const { builtinRuijieProfile, validateProfile } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');
const { CampusError } = require('../electron/transport.cjs');

const context = { username: 'student+中文', password: 'test-password&+', parameters: { service: '电信出口' } };
const mac = 'eef900330a8987f0957c14c756513384';
const rawQuery = `mac=${mac}&wlanuserip=192.0.2.55&nasip=192.0.2.1&ssid=A%2BB%2520C&opaque=a%3Db%26c`;

async function server(t, handle) {
  const instance = http.createServer((req, res) => Promise.resolve(handle(req, res)).catch(() => { res.writeHead(500); res.end('fixture failure'); }));
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

async function fixture(t, initial = {}) {
  const state = { online: false, calls: [], successIndex: true, loginResult: 'success', confirmLogin: true, confirmLogout: true, ...initial };
  let portalOrigin;
  const relay = await server(t, (req, res) => {
    state.calls.push({ role: 'relay', path: req.url, method: req.method, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'relayCookie=relay-only; Path=/' });
    res.end(`<script>top.self.location.href='${portalOrigin}/eportal/index.jsp?${(state.query ?? rawQuery).replaceAll('&', '&amp;')}'</script>`);
  });
  portalOrigin = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    state.calls.push({ role: 'portal', path: req.url, method: req.method, cookie: req.headers.cookie, body, rawHeaders: req.rawHeaders });
    const url = new URL(req.url, portalOrigin);
    if (url.pathname === '/') {
      if (state.homeHtml !== undefined) { res.end(state.homeHtml); return; }
      res.writeHead(302, { Location: state.firstTarget || '/eportal/redirectortosuccess.jsp', 'Set-Cookie': ['JSESSIONID=private-session; Path=/eportal', 'secureOnly=private-secure; Secure; Path=/'] }); res.end();
    } else if (url.pathname === '/eportal/redirectortosuccess.jsp') {
      const target = state.online ? `/eportal/success.jsp${state.successIndex ? '?userIndex=private-index' : ''}` : `${relay}/landing`;
      res.writeHead(302, { Location: target }); res.end();
    } else if (url.pathname === '/eportal/index.jsp') {
      res.end(state.indexHtml ?? '<html><title>锐捷认证</title><input name="userId"><input type="password"></html>');
    } else if (url.pathname === '/eportal/success.jsp') {
      res.end(state.successHtml ?? '<html>锐捷已登录</html>');
    } else if (url.pathname === '/eportal/InterFace.do') {
      if (state.apiRedirect) { res.writeHead(302, { Location: `${relay}/should-not-follow` }); res.end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      if (url.searchParams.get('method') === 'login') {
        if (state.loginResult === 'success' && state.confirmLogin) state.online = true;
        res.end(JSON.stringify({ result: state.loginResult, message: state.message || '', userIndex: 'private-index', userId: context.username, ...(state.echo ? { echoed: new URLSearchParams(body).get('password'), queryString: rawQuery, operatorUserId: 'private-operator-account' } : {}) }));
      } else {
        if (state.confirmLogout) state.online = false;
        res.end(JSON.stringify({ result: 'success' }));
      }
    } else { res.writeHead(404); res.end(); }
  });
  const profile = validateProfile({ ...structuredClone(builtinRuijieProfile), id: 'fixture-ruijie', homepage: `${portalOrigin}/`, ruijie: { ...builtinRuijieProfile.ruijie, discoveryUrl: `${portalOrigin}/`, redirectOrigins: [relay] } });
  delete profile.portalDiscovery; // These fixtures exercise ePortal itself, not network-wide discovery.
  return { state, profile, portalOrigin, relay };
}

test('legacy RSA matches the upstream C# published password/MAC vector', () => {
  const expected = '0f8c069affb97231446dce90164fd7d532b6e1a9fbe1d57e3d9f0794cc66b38e7161ba998541202189626c132989e3baab7f27f361ad5b4aca9589d42af9046a31a1ced0f46687f37175917d6563962a95937b283b725ab218d90b43777db40b0325baa07447a21baa892d96063241985df2af279928d742ea29dd6f0174e12f';
  assert.equal(encryptPassword('password9977', mac, builtinRuijieProfile.ruijie.publicKey), expected);
});

test('SCU discovery, encrypted login and verified logout use scoped cookies and exact encoding', async t => {
  const { profile, state } = await fixture(t);
  const login = await runOperation(profile, 'login', context);
  assert.equal(login.online, true);
  const request = state.calls.find(call => call.method === 'POST');
  assert.equal(request.path, '/eportal/InterFace.do?method=login');
  const form = new URLSearchParams(request.body);
  assert.deepEqual([...form.keys()], ['userId', 'password', 'service', 'queryString', 'operatorPwd', 'operatorUserId', 'validcode', 'passwordEncrypt']);
  assert.equal(form.get('userId'), context.username);
  assert.equal(form.get('password'), encryptPassword(context.password, mac, profile.ruijie.publicKey));
  assert.equal(form.get('service'), encodeURIComponent(context.parameters.service));
  assert.equal(form.get('queryString'), rawQuery);
  assert.equal(form.get('passwordEncrypt'), 'true');
  assert.ok(request.body.includes('%25E7%2594%25B5'));
  assert.match(request.cookie, /JSESSIONID=private-session/);
  assert.ok(state.calls.filter(call => call.role === 'relay').every(call => !call.cookie?.includes('private-session')));
  assert.ok(state.calls.filter(call => call.role === 'portal').every(call => !call.cookie?.includes('relay-only') && !call.cookie?.includes('private-secure')));
  assert.ok(state.calls.filter(call => call.role === 'portal').every(call => call.rawHeaders.includes('Host') && !call.rawHeaders.includes('host')));
  assert.equal((await runOperation(profile, 'logout', context)).online, false);
  const logout = state.calls.find(call => call.path === '/eportal/InterFace.do?method=logout');
  assert.equal(new URLSearchParams(logout.body).get('userIndex'), 'private-index');
  assert.equal(new URLSearchParams(logout.body).has('password'), false);
  assert.equal((await runOperation(profile, 'status')).online, false);
});

test('plain service encoding supports other ePortal profiles without double encoding', async t => {
  const { profile, state } = await fixture(t);
  profile.ruijie.serviceEncoding = 'plain';
  await runOperation(profile, 'login', context);
  const body = state.calls.find(call => call.method === 'POST').body;
  assert.equal(new URLSearchParams(body).get('service'), '电信出口');
  assert.equal(body.includes('%25E7'), false);
});

async function cdutStyleFixture(t, initial = {}) {
  const base = await fixture(t, initial);
  const profile = validateProfile({
    ...structuredClone(base.profile),
    id: 'fixture-cdut-yibin',
    fields: [],
    ruijie: { ...base.profile.ruijie, serviceOptional: true, valueEncoding: 'percent' },
  });
  return { ...base, profile };
}

test('CDUT-Yibin style portals accept an empty service with double-encoded values and password>mac RSA', async t => {
  // The success page carries a literal self-navigation inside a helper
  // function; discovery must treat the current document as authoritative.
  const selfNavigation = '<html>已登录<script>function gologinPage(){ window.location="./success.jsp"; }</script></html>';
  const { profile, state } = await cdutStyleFixture(t, { successHtml: selfNavigation });
  const login = await runOperation(profile, 'login', { username: '202619130115@ct', password: 'test-password&+' });
  assert.equal(login.online, true);
  const request = state.calls.find(call => call.method === 'POST');
  assert.equal(request.path, '/eportal/InterFace.do?method=login');
  const form = new URLSearchParams(request.body);
  assert.equal(form.get('userId'), '202619130115%40ct');
  assert.equal(form.get('service'), '');
  assert.equal(form.get('queryString'), encodeURIComponent(rawQuery));
  assert.equal(form.get('password'), encryptPassword('test-password&+', mac, profile.ruijie.publicKey));
  assert.equal(form.get('passwordEncrypt'), 'true');
  assert.ok(request.body.includes('%2540'));
  assert.ok(request.body.includes('%2526'));
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.equal((await runOperation(profile, 'logout', {})).online, false);
});

test('already online status and login do not transmit credentials or execute portal scripts', async t => {
  const { profile, state } = await fixture(t, { online: true });
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.equal((await runOperation(profile, 'login', context)).online, true);
  assert.ok(state.calls.every(call => call.method === 'GET' && !call.body));
});

test('SCU permits empty logout when the online page does not expose userIndex', async t => {
  const { profile, state } = await fixture(t, { online: true, successIndex: false });
  assert.equal((await runOperation(profile, 'logout', context)).online, false);
  assert.equal(state.calls.find(call => call.method === 'POST').body, '');
});

test('offline logout needs no authentication POST', async t => {
  const { profile, state } = await fixture(t);
  assert.equal((await runOperation(profile, 'logout', context)).online, false);
  assert.ok(state.calls.every(call => call.method === 'GET'));
});

test('unknown HTML, missing device parameters, loops and unexpected origins do not mean offline', async t => {
  for (const [initial, code] of [
    [{ homeHtml: '<html><script>globalThis.ruijieExecuted=true</script></html>' }, 'UNKNOWN_RESPONSE'],
    [{ query: 'wlanuserip=192.0.2.2' }, 'PORTAL_PARAMETERS'],
    [{ firstTarget: '/' }, 'PORTAL_REDIRECT'],
    [{ firstTarget: 'http://outside.example.invalid/eportal/success.jsp' }, 'PORTAL_REDIRECT'],
    [{ firstTarget: 'http://name:secret@127.0.0.1/eportal/index.jsp' }, 'PORTAL_REDIRECT'],
  ]) {
    const { profile, state } = await fixture(t, initial);
    await assert.rejects(runOperation(profile, 'login', context), { code });
    assert.ok(state.calls.every(call => call.method === 'GET'));
  }
  assert.equal(globalThis.ruijieExecuted, undefined);
});

test('accepted operations are verified and API redirects never forward credentials', async t => {
  const first = await fixture(t, { confirmLogin: false });
  await assert.rejects(runOperation(first.profile, 'login', context), { code: 'VERIFY_FAILED' });
  const second = await fixture(t, { online: true, confirmLogout: false });
  await assert.rejects(runOperation(second.profile, 'logout', context), { code: 'VERIFY_FAILED' });
  const third = await fixture(t, { apiRedirect: true });
  await assert.rejects(runOperation(third.profile, 'login', context), { code: 'NETWORK_ERROR' });
  assert.ok(third.state.calls.filter(call => call.role === 'relay').every(call => call.path === '/landing' && call.method === 'GET'));
});

test('errors retain server explanations without credentials, query tokens or ciphertext', async t => {
  const { profile } = await fixture(t, { loginResult: 'fail', message: `账号已达到同时在线上限 ${context.username} ${context.password} private-index private-session`, echo: true });
  await assert.rejects(runOperation(profile, 'login', context), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    assert.match(error.message, /同时在线上限/);
    const rendered = error.message + JSON.stringify(error.diagnostics);
    for (const secret of [context.username, context.password, 'private-index', 'private-session', 'private-operator-account', mac, encryptPassword(context.password, mac, profile.ruijie.publicKey)]) assert.equal(rendered.includes(secret), false, secret);
    assert.ok(error.diagnostics.length > 0);
    assert.ok(error.diagnostics.every(item => !item.url.includes('?')));
    return true;
  });
});

test('literal script and meta-refresh navigation take precedence over a stale page pathname', async t => {
  const first = await fixture(t, { indexHtml: '<script>window.location.href="/eportal/success.jsp";</script>' });
  assert.equal((await runOperation(first.profile, 'status')).online, true);
  const second = await fixture(t, { online: true, successHtml: `<meta content="0; url=/eportal/index.jsp?${rawQuery}" http-equiv="refresh">` });
  assert.equal((await runOperation(second.profile, 'status')).online, false);
  const third = await fixture(t, { homeHtml: `<a href="/eportal/success.jsp?userIndex=stale">普通历史链接</a>` });
  await assert.rejects(runOperation(third.profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
});

test('captcha is reported separately and stops automatic login loops in the service', async t => {
  const { profile } = await fixture(t, { loginResult: 'fail', message: '验证码错误.' });
  await assert.rejects(runOperation(profile, 'login', context), { code: 'CAPTCHA_REQUIRED' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-ruijie-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = new CampusService({ directory, operation: async () => { throw new CampusError('请打开认证页完成验证码。', 'CAPTCHA_REQUIRED'); } });
  t.after(() => service.dispose());
  service.monitorArmed = true;
  await service.connect({ username: 'fixture-account', password: 'fixture-password' }, { automatic: false });
  assert.equal(service.snapshot().connection.monitoring, false);
  assert.equal(service.reconnectContext, null);
});
