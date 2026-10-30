'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { discoverPortal } = require('../electron/portal-discovery.cjs');
const { CampusError } = require('../electron/transport.cjs');

const PROBE = 'http://www.msftconnecttest.com/redirect';
const DRCOM = '<!doctype html><html><!--Dr.COMWebLoginID_1.htm--><body>校园网</body></html>';
const profile = (protocol = 'drcom') => ({ protocol, homepage: 'http://10.0.0.1/', portalDiscovery: { url: PROBE }, timeoutMs: 1000 });

function fixture(routes) {
  const requests = [];
  return {
    requests,
    requester: async (url, options) => {
      requests.push({ url: String(url), options });
      const response = routes[String(url)];
      assert.ok(response, `Unexpected fixture request: ${url}`);
      if (response.error) throw response.error;
      options.onResponse({ status: response.status || 200, location: response.location, setCookies: response.cookies || [] });
      return response.body || '';
    },
  };
}

test('discovers a changed DrCOM IP without using the old configured server', async () => {
  const f = fixture({ [PROBE]: { status: 302, location: 'http://10.8.6.20/portal/' }, 'http://10.8.6.20/portal/': { body: DRCOM } });
  assert.deepEqual(await discoverPortal(profile(), f.requester), { homepage: 'http://10.8.6.20/', entryUrl: 'http://10.8.6.20/portal/', redirectOrigins: ['http://10.8.6.20'] });
  assert.equal(f.requests.length, 2);
});

test('Ruijie uses the full HTTP / JS / meta discovery chain, preserving only the temporary entry query', async () => {
  const entry = 'http://10.8.6.22/eportal/index.jsp?mac=aa-bb-cc-dd-ee-ff&ip=172.16.3.4';
  const f = fixture({
    [PROBE]: { status: 302, location: 'http://10.8.6.22/eportal/redirectortosuccess.jsp', cookies: ['MicrosoftSession=never-copy'] },
    'http://10.8.6.22/eportal/redirectortosuccess.jsp': { status: 302, location: 'http://123.123.123.123/', cookies: ['JSESSIONID=portal-only'] },
    'http://123.123.123.123/': { body: `<script>location.replace('${entry.replace('&', '&amp;')}');</script>` },
    [entry]: { body: '<html><title>校园网认证</title></html>' },
  });
  const result = await discoverPortal(profile('ruijie'), f.requester);
  assert.deepEqual(result, { homepage: 'http://10.8.6.22/', entryUrl: entry, redirectOrigins: ['http://10.8.6.22', 'http://123.123.123.123'] });
  for (const { options } of f.requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(new Headers(options.headers).has('cookie'), false);
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.equal(new Headers(options.headers).has('referer'), false);
  }
  assert.ok(!f.requests[2].url.includes('JSESSIONID'));
});

test('Ruijie success landing and a meta refresh can identify a portal but never claim online', async () => {
  const f = fixture({
    [PROBE]: { body: '<meta http-equiv="refresh" content="0;url=http://10.8.6.23/eportal/success.jsp">' },
    'http://10.8.6.23/eportal/success.jsp': { body: '<html><title>Ruijie ePortal</title></html>' },
  });
  const result = await discoverPortal(profile('ruijie'), f.requester);
  assert.equal(result.homepage, 'http://10.8.6.23/');
  assert.equal(result.online, undefined);
});

test('SCU opaque 32-digit mac identifies its index page without an ePortal text marker', async () => {
  const entry = 'http://10.8.6.23/eportal/index.jsp?mac=eef900330a8987f0957c14c756513384&ip=172.16.3.4';
  const f = fixture({
    [PROBE]: { status: 302, location: entry },
    [entry]: { body: '<html><title>校园网认证</title><body>请输入账号密码</body></html>' },
  });
  const result = await discoverPortal(profile('ruijie'), f.requester);
  assert.deepEqual(result, { homepage: 'http://10.8.6.23/', entryUrl: entry, redirectOrigins: ['http://10.8.6.23'] });
  assert.equal(f.requests.length, 2);
});

test('normal Microsoft/MSN/Bing redirects stop before requesting those landing pages', async () => {
  for (const location of ['https://www.msn.com/zh-cn/?ocid=wispr', 'https://www.msn.cn/zh-cn/?ocid=wispr', 'https://www.bing.com/', 'https://www.microsoft.com/', 'http://www.msftconnecttest.com/connecttest.txt']) {
    const f = fixture({ [PROBE]: { status: 302, location } });
    assert.equal(await discoverPortal(profile(), f.requester), null);
    assert.equal(f.requests.length, 1);
  }
});

test('transparent proxy HTML cannot turn the Microsoft hostname into a credential destination', async () => {
  for (const body of [DRCOM, `${DRCOM}<form action="/drcom/login"></form>`, '<html><form action="https://search.example.com/"><input name="q"></form></html>']) {
    const f = fixture({ [PROBE]: { body } });
    assert.equal(await discoverPortal(profile(), f.requester), null);
    assert.equal(f.requests.length, 1);
  }
  const f = fixture({
    [PROBE]: { body: `${DRCOM}<form method="post" action="http://10.8.6.24/drcom/login"><input name="DDDDD"></form>` },
    'http://10.8.6.24/': { body: DRCOM },
  });
  assert.equal((await discoverPortal(profile(), f.requester)).homepage, 'http://10.8.6.24/');
  assert.ok(f.requests.every(request => !new URL(request.url).pathname.includes('/drcom/login')));
});

test('a recognized different protocol raises a mismatch, not fallback', async () => {
  for (const [selected, location, body] of [
    ['ruijie', 'http://10.8.6.25/', DRCOM],
    ['drcom', 'http://10.8.6.25/eportal/index.jsp?mac=aabbccddeeff', '<html>ePortal</html>'],
    ['drcom-eportal', 'http://10.8.6.25/eportal/index.jsp?mac=aabbccddeeff', '<html>ePortal</html>'],
    ['drcom', 'http://10.8.6.25/a79.htm', '<html><!--Dr.COMWebLoginID_0.htm--></html>'],
  ]) {
    const f = fixture({ [PROBE]: { status: 302, location }, [location]: { body } });
    await assert.rejects(discoverPortal(profile(selected), f.requester), { code: 'PORTAL_PROTOCOL_MISMATCH' });
    assert.equal(f.requests.length, 2);
  }
});

test('JCU a79 and its JSONP login reference identify Dr.COM ePortal without executing scripts', async () => {
  const body = '<html><form><input name="DDDDD"><input name="upass"></form><script>const api="/eportal/?c=Portal&a=login";globalThis.portalExecuted=true;</script></html>';
  for (const [path, html] of [
    ['/a79.htm?userip=172.20.1.2&wlanacip=172.20.0.1', '<html><!--Dr.COMWebLoginID_0.htm--></html>'],
    ['/portal/', body],
    ['/portal/', DRCOM],
    ['/a79.htm', `${DRCOM}<script>function logout(){location.href="/F.htm";}function login(){location.href="/drcom/login";}</script>`],
  ]) {
    const entry = `http://10.8.6.40${path}`;
    const f = fixture({ [PROBE]: { status: 302, location: entry }, [entry]: { body: html } });
    const found = await discoverPortal(profile('drcom-eportal'), f.requester);
    assert.equal(found.homepage, 'http://10.8.6.40/');
    assert.equal(found.entryUrl, entry);
    assert.equal(f.requests.length, 2);
  }
  assert.equal(globalThis.portalExecuted, undefined);
});

test('discovery never follows ePortal credential URLs or read-write GET actions', async () => {
  for (const path of [
    '/?user_account=private', '/?user_password=private',
    '/eportal/?c=Portal&a=login', '/eportal/?c=Portal&a=logout',
    '/drcom/login', '/drcom/logout', '/F.htm',
  ]) {
    const f = fixture({ [PROBE]: { status: 302, location: `http://10.8.6.41${path}` } });
    assert.equal(await discoverPortal(profile('drcom-eportal'), f.requester), null);
    assert.equal(f.requests.length, 1);
  }
});

test('mere paths, marketing text, script string markers and ordinary links cannot identify a portal', async () => {
  for (const [location, body] of [
    ['http://10.8.6.26/eportal/index.jsp', '<html>hello</html>'],
    ['http://10.8.6.26/', '<html>Dr.COM</html>'],
    ['http://10.8.6.26/', '<html><script>const example="<!--Dr.COMWebLoginID_1.htm-->";</script></html>'],
    ['http://10.8.6.26/', '<html><a href="http://10.1.1.1/eportal/index.jsp?mac=aabbccddeeff">Example</a></html>'],
  ]) {
    const f = fixture({ [PROBE]: { status: 302, location }, [location]: { body } });
    assert.equal(await discoverPortal(profile(), f.requester), null);
    assert.equal(f.requests.length, 2);
  }
});

test('login form plus a DrCOM API reference is sufficient without the legacy comment marker', async () => {
  const f = fixture({
    [PROBE]: { status: 302, location: 'http://10.8.6.27/' },
    'http://10.8.6.27/': { body: '<html><form><input name="username"><input name="password"></form><script>const api="/drcom/login";</script></html>' },
  });
  assert.equal((await discoverPortal(profile(), f.requester)).homepage, 'http://10.8.6.27/');
});

test('unsafe destinations and credential queries are never requested', async () => {
  for (const location of [
    'file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,portal',
    'http://user:password@10.8.6.28/', 'http://10.8.6.28/#session',
    'http://10.8.6.28/?username=private&password=private-pass',
    'http://10.8.6.28/?DDDDD=private&upass=private-pass',
    'http://10.8.6.28/?token=private-token',
  ]) {
    const f = fixture({ [PROBE]: { status: 302, location } });
    assert.equal(await discoverPortal(profile(), f.requester), null);
    assert.equal(f.requests.length, 1);
  }
});

test('cross-origin hops do not copy cookies, referrers or previous device query strings', async () => {
  const first = 'http://10.8.6.29/start?mac=aabbccddeeff&ip=172.16.1.1';
  const f = fixture({
    [PROBE]: { status: 302, location: first },
    [first]: { status: 302, location: 'http://10.8.6.30/', cookies: ['session=private-session'] },
    'http://10.8.6.30/': { body: DRCOM },
  });
  assert.equal((await discoverPortal(profile(), f.requester)).homepage, 'http://10.8.6.30/');
  assert.equal(f.requests[2].url, 'http://10.8.6.30/');
  assert.doesNotMatch(JSON.stringify(f.requests[2]), /aabbccddeeff|172\.16\.1\.1|private-session/);
});

test('loop, excessive hop count, failed request and missing opt-in safely return null', async () => {
  const loop = fixture({ [PROBE]: { status: 302, location: 'http://10.8.6.31/' }, 'http://10.8.6.31/': { status: 302, location: 'http://10.8.6.31/' } });
  assert.equal(await discoverPortal(profile(), loop.requester), null);
  assert.equal(loop.requests.length, 2);
  let calls = 0;
  assert.equal(await discoverPortal(profile(), async (_url, options) => {
    options.onResponse({ status: 302, location: `http://10.8.6.32/step${++calls}` }); return '';
  }), null);
  assert.equal(calls, 6);
  assert.equal(await discoverPortal(profile(), async () => { throw new CampusError('timeout', 'TIMEOUT'); }), null);
  assert.equal(await discoverPortal({ protocol: 'drcom' }, async () => { throw new Error('must not run'); }), null);
});

test('default transport performs only GET with literal Host and no credentials on a local server', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    if (req.url === '/probe') {
      res.writeHead(302, { Location: '/portal', 'Set-Cookie': 'private=never-forward' }); res.end();
    } else res.end(DRCOM);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await discoverPortal({ ...profile(), portalDiscovery: { url: `${origin}/probe` } });
  assert.equal(result.entryUrl, `${origin}/portal`);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.method, 'GET');
    assert.ok(request.rawHeaders.includes('Host'));
    assert.ok(!request.rawHeaders.includes('host'));
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
  }
});
