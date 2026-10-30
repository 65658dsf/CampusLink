'use strict';

// NingMeng123 — dynamic endpoint changes using only local HTTP fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfile, builtinRuijieProfile, builtinJdztcProfile } = require('../electron/profiles.cjs');

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('Dr.COM discovers a changed origin, remembers it online, and never authenticates to the probe', async t => {
  const requests = [];
  const gateway = async name => server(t, (req, res) => {
    requests.push({ name, method: req.method, url: req.url });
    if (req.url.startsWith('/drcom/')) res.end('dr1003({"result":1})');
    else res.end('<html><!--Dr.COMWebLoginID_2.htm--><form><input name="DDDDD"></form></html>');
  });
  const old = await gateway('old'), first = await gateway('first'), second = await gateway('second');
  let target = `${first}/`;
  const probe = await server(t, (req, res) => {
    requests.push({ name: 'probe', method: req.method, url: req.url, headers: req.headers });
    res.writeHead(302, { Location: target }); res.end();
  });
  const profile = { ...builtinProfile, id: `discovery-${new URL(probe).port}`, homepage: `${old}/`, portalDiscovery: { url: `${probe}/redirect` } };
  const account = { username: 'local-account', password: 'local-secret', parameters: { operator: '1' } };
  assert.equal((await runOperation(profile, 'login', account)).portalUrl, `${first}/`);
  target = 'https://www.msn.com/';
  assert.equal((await runOperation(profile, 'status')).portalUrl, `${first}/`, 'Normal internet redirect reuses only the previously discovered origin');
  target = `${second}/`;
  assert.equal((await runOperation(profile, 'login', account)).portalUrl, `${second}/`, 'A new discovery supersedes the cached address');
  assert.equal(requests.some(item => item.name === 'old'), false);
  const probes = requests.filter(item => item.name === 'probe');
  assert.ok(probes.every(item => item.method === 'GET' && item.url === '/redirect' && !item.headers.cookie && !item.headers.authorization));
  assert.ok(requests.filter(item => item.url.includes('upass=')).every(item => ['first', 'second'].includes(item.name)));
});

test('Ruijie authenticates to a discovered origin and reuses only its root for later online checks', async t => {
  const calls = [];
  let online = false;
  const query = 'mac=eef900330a8987f0957c14c756513384&ip=192.0.2.1&opaque=a%252Bb';
  const gateway = await server(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, body });
    if (req.url === '/') { res.writeHead(302, { Location: online ? '/eportal/success.jsp?userIndex=local-session' : `/eportal/index.jsp?${query}` }); res.end(); }
    else if (req.url.startsWith('/eportal/InterFace.do')) { online = req.url.endsWith('method=login'); res.setHeader('Content-Type', 'application/json'); res.end('{"result":"success"}'); }
    else res.end('<html><title>Ruijie ePortal</title></html>');
  });
  let probeTarget = `${gateway}/eportal/index.jsp?${query}`;
  const probe = await server(t, (_req, res) => { res.writeHead(302, { Location: probeTarget }); res.end(); });
  const profile = { ...structuredClone(builtinRuijieProfile), id: `ruijie-${new URL(probe).port}`, homepage: 'http://unused.example.invalid/', portalDiscovery: { url: `${probe}/redirect` } };
  profile.ruijie.discoveryUrl = profile.homepage;
  profile.ruijie.redirectOrigins = [];
  const result = await runOperation(profile, 'login', { username: 'local-user', password: 'local-password', parameters: { service: 'internet' } });
  assert.equal(result.online, true);
  assert.equal(result.portalUrl, `${gateway}/`);
  assert.equal(new URLSearchParams(calls.find(item => item.url.endsWith('method=login')).body).get('queryString'), query);
  probeTarget = 'https://www.bing.com/';
  const count = calls.length;
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.equal(calls[count].url, '/', 'Do not reuse a stale device query after login');
  assert.equal((await runOperation(profile, 'logout')).online, false);
});

test('a discovered protocol mismatch blocks login instead of falling back to an old gateway', async t => {
  let posts = 0;
  const ruijie = await server(t, (req, res) => { if (req.method !== 'GET') posts++; res.end('<html>Ruijie ePortal</html>'); });
  const probe = await server(t, (_req, res) => { res.writeHead(302, { Location: `${ruijie}/eportal/index.jsp?mac=aabbccddeeff` }); res.end(); });
  const profile = { ...builtinProfile, homepage: 'http://must-not-contact.example.invalid/', portalDiscovery: { url: `${probe}/redirect` } };
  await assert.rejects(runOperation(profile, 'login', { username: 'local-user', password: 'local-password' }), { code: 'PORTAL_PROTOCOL_MISMATCH' });
  assert.equal(posts, 0);
});

test('JCU discovers a changed gateway, authenticates with current device parameters and verifies logout', async t => {
  const calls = [];
  const gateways = [];
  const makeGateway = async name => {
    let online = false;
    const origin = await server(t, (req, res) => {
      const url = new URL(req.url, 'http://local.invalid');
      calls.push({ name, method: req.method, url: req.url, headers: req.headers });
      if (url.pathname === '/eportal/') {
        assert.equal(url.searchParams.get('c'), 'Portal');
        assert.equal(url.searchParams.get('a'), 'login');
        assert.equal(url.searchParams.get('user_account'), ',0,local-student');
        assert.equal(url.searchParams.get('user_password'), 'local pass&+密');
        assert.equal(url.searchParams.get('wlan_user_ip'), name === 'first' ? '172.20.1.2' : '172.20.1.3');
        assert.equal(url.searchParams.get('wlan_ac_ip'), '172.20.0.1');
        assert.equal(url.searchParams.get('wlan_ac_name'), 'Local AC');
        online = true; res.end('dr1003({"result":"ok"})');
      } else if (url.pathname === '/drcom/logout') {
        online = false; res.end('dr1003({"result":1})');
      } else if (url.pathname === '/drcom/chkstatus') {
        res.end(`dr1003(${JSON.stringify({ result: online ? 1 : 0, v46ip: '172.20.1.2' })})`);
      } else if (url.pathname === '/a79.htm') {
        res.end(`<html><!--Dr.COMWebLoginID_${online ? 1 : 0}.htm--><form><input name="DDDDD"><input name="upass"></form></html>`);
      } else { res.statusCode = 404; res.end('unknown'); }
    });
    gateways.push(origin);
    return origin;
  };
  const first = await makeGateway('first'), second = await makeGateway('second');
  const entry = (origin, ip) => `${origin}/a79.htm?userip=${ip}&wlanacip=172.20.0.1&wlanacname=Local%20AC`;
  let target = entry(first, '172.20.1.2');
  const probe = await server(t, (req, res) => {
    calls.push({ name: 'probe', method: req.method, url: req.url, headers: req.headers });
    res.writeHead(302, { Location: target, 'Set-Cookie': 'probe-session=never-copy' }); res.end();
  });
  const profile = { ...builtinJdztcProfile, id: `jcu-discovery-${new URL(probe).port}`, homepage: 'http://must-not-contact.example.invalid/a79.htm', portalDiscovery: { url: `${probe}/redirect` } };
  const credentials = { username: 'local-student', password: 'local pass&+密', parameters: {} };
  assert.equal((await runOperation(profile, 'login', credentials)).portalUrl, `${first}/`);
  target = 'https://www.msn.com/';
  const count = calls.length;
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.deepEqual(calls.slice(count).map(call => call.name), ['probe', 'first']);
  assert.equal(new URL(calls.at(-1).url, first).pathname, '/drcom/chkstatus');
  assert.equal((await runOperation(profile, 'logout')).online, false);
  target = entry(second, '172.20.1.3');
  assert.equal((await runOperation(profile, 'login', credentials)).portalUrl, `${second}/`);
  assert.deepEqual(profile.homepage, 'http://must-not-contact.example.invalid/a79.htm', 'discovery does not mutate the stored profile');
  assert.equal(Object.hasOwn(profile, 'discoveredEntry'), false);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.every(call => !call.headers.cookie && !call.headers.authorization));
  const probes = calls.filter(call => call.name === 'probe');
  assert.ok(probes.every(call => call.url === '/redirect'));
  assert.deepEqual(calls.filter(call => call.url.startsWith('/eportal/')).map(call => call.name), ['first', 'second']);
});
