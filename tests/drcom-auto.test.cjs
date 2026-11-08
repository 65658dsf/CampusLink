'use strict';

// NingMeng123 — execution-contract tests with synthetic local HTTP gateways.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const detector = require('../electron/drcom-detect.cjs');
const { runOperation } = require('../electron/adapters.cjs');
const { CampusService } = require('../electron/service.cjs');
const { builtinProfiles } = require('../electron/profiles.cjs');

const credentials = { username: 'synthetic student+中', password: 'synthetic password+&/密' };
const page = online => `<html><!--Dr.COMWebLoginID_${online ? 1 : 0}.htm--><form><input name="DDDDD"><input name="upass"></form></html>`;

async function fixture(t, initial = {}) {
  const state = { calls: [], online: false, ip: '192.0.2.72', detectionCount: 0, loginReply: { result: 1 }, logoutReply: { result: 1 }, verifyLogin: true, verifyLogout: true, ...initial };
  async function listen(destination) {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      state.calls.push({ destination, url, method: req.method, headers: req.headers });
      if (url.pathname === '/drcom/chkstatus') {
        if (state.statusHttp) { res.writeHead(state.statusHttp); res.end('unavailable'); return; }
        res.end(state.statusBody ?? `dr1003(${JSON.stringify({ result: 1, v46ip: state.ip, ...(state.online && !state.noUid ? { uid: credentials.username } : {}) })});`);
      } else if (url.pathname === '/' || url.pathname === '/landing.htm') {
        if (state.pageRedirect) { res.writeHead(302, { Location: state.pageRedirect }); res.end(); return; }
        res.end(url.pathname === '/' && state.rootBody !== undefined ? state.rootBody : state.pageBody ?? page(state.online));
      } else if (['/drcom/login', '/eportal/portal/login'].includes(url.pathname) || url.pathname === '/eportal/' && url.searchParams.get('a') === 'login') {
        if (state.apiRedirect) { res.writeHead(302, { Location: state.apiRedirect }); res.end(); return; }
        if (state.verifyLogin) state.online = true;
        res.end(`dr1003(${JSON.stringify(state.loginReply)});`);
      } else if (['/drcom/logout', '/eportal/portal/logout'].includes(url.pathname)) {
        if (state.verifyLogout) state.online = false;
        res.end(`dr1003(${JSON.stringify(state.logoutReply)});`);
      } else { res.writeHead(404); res.end('unexpected fixture path'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const origin = await listen('portal'), apiOrigin = await listen('api');
  const detected = {
    homepage: `${origin}/`, entryUrl: `${origin}/landing.htm?userip=${state.ip}`,
    mode: 'v4', apiPort: Number(new URL(apiOrigin).port), accountPrefix: ',0,', jsVersion: '4.2.1',
    suffixes: [{ label: '校园网', value: '' }, { label: '中国电信', value: '@telecom' }, { label: '中国移动', value: '@cmcc' }],
    operatorMode: 'suffix', defaultOperator: '@telecom', loginParams: {},
    device: { ip: state.ip, mac: '020000000001', acIp: '192.0.2.1', acName: 'Synthetic AC' },
    evidence: ['synthetic-contract'], logoutMode: 'v4',
  };
  t.mock.method(detector, 'detectDrcom', async () => {
    state.detectionCount++;
    return structuredClone(detected);
  });
  const profile = { id: 'fixture-auto', protocol: 'drcom-auto', homepage: 'http://unvisited-probe.invalid/', timeoutMs: 1000 };
  return { profile, detected, state, origin, apiOrigin };
}

test('automatic DrCOM uses the detected v4 endpoint, fresh identity and unique operator mapping', async t => {
  const { profile, detected, state, origin, apiOrigin } = await fixture(t);
  detected.loginParams = { wlan_vlan_id: '7', program_index: '2' };
  const original = JSON.stringify(profile);
  const result = await runOperation(profile, 'login', { ...credentials, parameters: { operator: 'telecom' } });
  assert.equal(result.online, true);
  assert.equal(result.portalUrl, `${origin}/`);
  assert.match(result.message, /已识别 Dr\.COM ePortal v4/);
  assert.ok(result.message.includes(`接口端口 ${new URL(apiOrigin).port}`));
  assert.ok(result.message.includes('账号前缀 ,0,'));
  assert.equal(result.message.includes(state.ip), false);
  const login = state.calls.find(call => call.url.pathname === '/eportal/portal/login');
  assert.equal(login.url.origin, apiOrigin);
  assert.equal(login.url.searchParams.get('user_account'), `,0,${credentials.username}@telecom`);
  assert.equal(login.url.searchParams.get('user_password'), credentials.password);
  assert.equal(login.url.searchParams.get('wlan_user_ip'), state.ip);
  assert.equal(login.url.searchParams.get('wlan_user_mac'), detected.device.mac);
  assert.equal(login.url.searchParams.get('wlan_ac_ip'), detected.device.acIp);
  assert.equal(login.url.searchParams.get('wlan_ac_name'), detected.device.acName);
  assert.equal(login.url.searchParams.get('wlan_vlan_id'), '7');
  assert.equal(login.url.searchParams.get('program_index'), '2');
  assert.deepEqual(login.url.searchParams.getAll('lang'), ['zh-cn', 'zh']);
  assert.equal(state.calls.at(-1).url.pathname, '/drcom/chkstatus');
  assert.equal(JSON.stringify(profile), original);
  assert.ok(state.calls.every(call => call.method === 'GET' && !call.headers.cookie && !call.headers.authorization));
  assert.ok(state.calls.filter(call => call.destination === 'portal').every(call => !call.url.searchParams.has('user_password')));
});

test('automatic DrCOM dispatches exactly one web or legacy dialect without login retries', async t => {
  const { profile, detected, state, origin, apiOrigin } = await fixture(t);
  detected.mode = 'web'; detected.accountPrefix = ''; detected.operatorMode = 'r3';
  detected.suffixes = [{ label: '校园网', value: '1' }]; detected.defaultOperator = '1'; detected.logoutMode = 'drcom';
  detected.loginParams = { enable_r3: '1', login_method: '0' };
  await runOperation(profile, 'login', credentials);
  const web = state.calls.find(call => call.url.pathname === '/drcom/login');
  assert.equal(web.url.origin, origin);
  assert.equal(web.url.searchParams.get('DDDDD'), credentials.username);
  assert.equal(web.url.searchParams.get('R3'), '1');
  assert.equal(web.url.searchParams.get('upass'), credentials.password);
  assert.deepEqual([...web.url.searchParams.keys()], ['callback', 'DDDDD', 'upass', '0MKKey', 'R1', 'R2', 'R3', 'R6', 'para', 'v6ip', 'terminal_type', 'lang', 'jsVersion', 'v', 'lang']);
  assert.deepEqual(web.url.searchParams.getAll('lang'), ['en', 'en']);
  assert.equal(web.url.searchParams.has('enable_r3'), false);
  assert.equal(web.url.searchParams.has('v4ip'), false);
  assert.equal((await runOperation(profile, 'logout')).online, false);
  assert.equal(state.calls.find(call => call.url.pathname === '/drcom/logout').url.origin, origin);
  detected.mode = 'legacy'; detected.accountPrefix = ',1,'; detected.operatorMode = 'none'; detected.suffixes = []; detected.defaultOperator = '';
  await runOperation(profile, 'login', credentials);
  const legacy = state.calls.find(call => call.url.pathname === '/eportal/');
  assert.equal(legacy.url.origin, apiOrigin);
  assert.equal(legacy.url.searchParams.get('c'), 'Portal');
  assert.equal(legacy.url.searchParams.get('a'), 'login');
  assert.equal(legacy.url.searchParams.get('user_account'), `,1,${credentials.username}`);
  assert.equal(state.calls.filter(call => call.url.pathname.includes('login') || call.url.searchParams.get('a') === 'login').length, 2);
});

test('automatic DrCOM redetects each operation and takes new status IP over old detected IP', async t => {
  const { profile, detected, state } = await fixture(t);
  await runOperation(profile, 'login', credentials);
  state.online = false; state.ip = '192.0.2.99'; detected.accountPrefix = ',1,';
  await runOperation(profile, 'login', credentials);
  const logins = state.calls.filter(call => call.url.pathname === '/eportal/portal/login');
  assert.equal(logins[1].url.searchParams.get('wlan_user_ip'), state.ip);
  assert.equal(logins[1].url.searchParams.get('user_account'), `,1,${credentials.username}@telecom`);
  assert.equal(state.detectionCount, 2);
});

test('automatic DrCOM does not duplicate a full account suffix and permits explicit raw accounts', async t => {
  const { profile, state } = await fixture(t);
  for (const [username, operator, expected] of [
    ['student@telecom', 'telecom', ',0,student@telecom'],
    ['student@cmcc', 'auto', ',0,student@cmcc'],
    ['student@custom', 'raw', ',0,student@custom'],
  ]) {
    state.online = false;
    await runOperation(profile, 'login', { username, password: credentials.password, parameters: { operator } });
    assert.equal(state.calls.findLast(call => call.url.pathname === '/eportal/portal/login').url.searchParams.get('user_account'), expected);
  }
});

test('automatic DrCOM rejects carrier conflicts, absent choices and ambiguous defaults before credentials', async t => {
  const { profile, detected, state } = await fixture(t);
  for (const [username, operator] of [['student@cmcc', 'telecom'], ['student@unknown', 'auto'], ['student', 'unicom'], ['student', 'unknown']]) {
    await assert.rejects(runOperation(profile, 'login', { username, password: 'synthetic-secret', parameters: { operator } }));
  }
  detected.suffixes.push({ label: '中国电信另一出口', value: '@other-telecom' });
  await assert.rejects(runOperation(profile, 'login', { ...credentials, parameters: { operator: 'telecom' } }), { code: 'OPERATOR_UNKNOWN' });
  detected.defaultOperator = '@unadvertised';
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'OPERATOR_UNKNOWN' });
  detected.defaultOperator = null; detected.suffixes = [{ label: '其他服务', value: '' }];
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'OPERATOR_UNKNOWN' });
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
});

test('automatic DrCOM carrier labels map unusual suffixes only when the match is unique', async t => {
  const { profile, detected, state } = await fixture(t);
  detected.suffixes = [{ label: '中国电信', value: '@njxy' }]; detected.defaultOperator = '@njxy';
  await runOperation(profile, 'login', { ...credentials, parameters: { operator: 'telecom' } });
  assert.equal(state.calls.find(call => call.destination === 'api').url.searchParams.get('user_account'), `,0,${credentials.username}@njxy`);
});

test('automatic DrCOM follows an explicitly detected language and never infers campus from empty suffix alone', async t => {
  const { profile, detected, state } = await fixture(t);
  detected.mode = 'web'; detected.accountPrefix = ''; detected.operatorMode = 'none';
  detected.suffixes = []; detected.defaultOperator = ''; detected.loginParams = { lang: 'zh-cn', enable_r3: '0' };
  await runOperation(profile, 'login', credentials);
  const web = state.calls.find(call => call.url.pathname === '/drcom/login');
  assert.deepEqual(web.url.searchParams.getAll('lang'), ['zh-cn', 'zh-cn']);
  assert.equal(web.url.searchParams.has('enable_r3'), false);
  state.online = false; detected.mode = 'v4'; detected.operatorMode = 'suffix';
  detected.suffixes = [{ label: '其他服务', value: '' }];
  const count = state.calls.filter(call => call.destination === 'api').length;
  await assert.rejects(runOperation(profile, 'login', { ...credentials, parameters: { operator: 'campus' } }), { code: 'OPERATOR_UNKNOWN' });
  assert.equal(state.calls.filter(call => call.destination === 'api').length, count);
});

test('automatic DrCOM never treats IP-only v4 result=1 as online without a fresh explicit page', async t => {
  const { profile, state } = await fixture(t, { noUid: true });
  assert.equal((await runOperation(profile, 'status')).online, false);
  state.online = true;
  assert.equal((await runOperation(profile, 'status')).online, true);
  for (const body of ['<html>internet works</html>', '<html><script>const page="<!--Dr.COMWebLoginID_1.htm-->"</script></html>', '<html><!--Dr.COMWebLoginID_0.htm--><!--Dr.COMWebLoginID_1.htm--></html>']) {
    state.pageBody = body;
    await assert.rejects(runOperation(profile, 'status'), { code: 'UNKNOWN_RESPONSE' });
  }
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
});

test('automatic DrCOM unknown status and transport failures block credentials', async t => {
  const { profile, state } = await fixture(t);
  for (const body of ['dr1003({})', 'dr1003({"result":"maintenance"})', 'dr1003({"result":0,"uid":"student","v46ip":"192.0.2.72"})', 'dr1003({"result":1,"resCode":2})']) {
    state.statusBody = body;
    await assert.rejects(runOperation(profile, 'login', credentials));
  }
  state.statusBody = undefined; state.statusHttp = 503;
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'HTTP_ERROR' });
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
});

test('automatic DrCOM can use explicit fresh page markers when chkstatus is unsupported', async t => {
  const { profile, state } = await fixture(t, { statusHttp: 404 });
  assert.equal((await runOperation(profile, 'status')).online, false);
  state.online = true;
  assert.equal((await runOperation(profile, 'status')).online, true);
});

test('automatic DrCOM status retains the discovered entry path without its old device query', async t => {
  const { profile, state } = await fixture(t, { statusHttp: 404, rootBody: '<html>unknown root page</html>' });
  assert.equal((await runOperation(profile, 'status')).online, false);
  const landing = state.calls.find(call => call.url.pathname === '/landing.htm');
  assert.ok(landing);
  assert.equal(landing.url.search, '');
  assert.equal(state.calls.some(call => call.url.pathname === '/'), false);
});

test('automatic DrCOM requires a valid current IPv4 before legacy or v4 credentials', async t => {
  const { profile, detected, state } = await fixture(t);
  state.statusBody = 'dr1003({"result":0})'; detected.device.ip = '';
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'PORTAL_PARAMETERS' });
  detected.mode = 'legacy';
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'PORTAL_PARAMETERS' });
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
});

test('automatic DrCOM checks accepted login and logout independently and never unbinds devices', async t => {
  const { profile, state, apiOrigin } = await fixture(t, { verifyLogin: false });
  await assert.rejects(runOperation(profile, 'login', credentials), { code: 'VERIFY_FAILED' });
  state.online = true; state.verifyLogout = false;
  await assert.rejects(runOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
  state.verifyLogout = true;
  assert.equal((await runOperation(profile, 'logout')).online, false);
  for (const call of state.calls.filter(call => call.url.pathname === '/eportal/portal/logout')) assert.equal(call.url.href, `${apiOrigin}/eportal/portal/logout`);
  assert.equal(state.calls.some(call => call.url.pathname.includes('unbind')), false);
});

test('automatic DrCOM login rejection is not followed by other credential attempts', async t => {
  const { profile, state } = await fixture(t, { verifyLogin: false });
  for (const [reply, code] of [[{ result: 0 }, 'AUTH_REJECTED'], [{ result: 0, resCode: 0 }, 'AMBIGUOUS_RESPONSE'], [{}, 'UNKNOWN_RESPONSE']]) {
    state.loginReply = reply;
    const before = state.calls.filter(call => call.destination === 'api').length;
    await assert.rejects(runOperation(profile, 'login', credentials), { code });
    assert.equal(state.calls.filter(call => call.destination === 'api').length, before + 1);
  }
});

test('automatic DrCOM blocks action or off-origin status redirects and API credential forwarding', async t => {
  const { profile, state } = await fixture(t);
  for (const redirect of ['http://must-not-contact.example.invalid/', '/drcom/logout', '/F.htm', '/landing.htm?user_password=leak', '/eportal/portal/mac/unbind', '/eportal/?a=unbind', '/eportal/portal/mac/bind', '/eportal/portal/Custom/remove', '/eportal/?a=delete', '/landing.htm?pwd=leak']) {
    state.pageRedirect = redirect;
    await assert.rejects(runOperation(profile, 'login', credentials));
  }
  assert.equal(state.calls.some(call => call.destination === 'api'), false);
  state.pageRedirect = ''; state.apiRedirect = 'http://must-not-contact.example.invalid/';
  await assert.rejects(runOperation(profile, 'login', credentials));
  assert.equal(state.calls.filter(call => call.destination === 'api').length, 1);
});

test('automatic DrCOM static parameters cannot replace credentials, origins or encryption behavior', async t => {
  const { profile, detected, state } = await fixture(t);
  for (const params of [{ user_account: 'replacement' }, { user_password: 'replacement' }, { url: 'http://other.invalid/' }, { encrypt: '1' }, { login_method: {} }]) {
    detected.loginParams = params;
    await assert.rejects(runOperation(profile, 'login', credentials), { code: 'DRCOM_DETECTION_INCOMPLETE' });
  }
  assert.equal(state.calls.length, 0);
});

test('automatic DrCOM diagnostics redact dynamic account, password and discovered device values', async t => {
  const { profile, detected, state } = await fixture(t, { verifyLogin: false });
  const account = `,0,${credentials.username}@telecom`;
  state.loginReply = { result: 0, msg: `${account} ${credentials.password} ${state.ip} ${detected.device.mac} ${detected.device.acIp} ${detected.device.acName}` };
  await assert.rejects(runOperation(profile, 'login', credentials), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    const output = JSON.stringify({ message: error.message, diagnostics: error.diagnostics });
    for (const value of [account, credentials.username, credentials.password, ...Object.values(detected.device)]) {
      assert.equal(output.includes(value), false);
      assert.equal(output.includes(encodeURIComponent(value)), false);
    }
    assert.match(error.message, /已识别 Dr\.COM/);
    return true;
  });
});

test('automatic DrCOM connects and disconnects through the real read-only detector using loopback fixtures', async t => {
  const calls = [];
  let online = false, apiPort, origin;
  async function listen(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const api = await listen((req, res) => {
    const url = new URL(req.url, 'http://local.invalid');
    calls.push({ destination: 'api', url });
    if (url.pathname === '/eportal/portal/page/loadConfig') {
      res.end('dr1001({"result":1,"data":{"login_method":1,"account_prefix":1,"account_suffix":"@telecom","en_md5":0,"enable_r3":0}});');
    } else if (url.pathname === '/eportal/portal/login') {
      assert.equal(url.searchParams.get('user_account'), `,0,${credentials.username}@telecom`);
      assert.equal(url.searchParams.get('user_password'), credentials.password);
      assert.equal(url.searchParams.get('wlan_user_ip'), '192.0.2.80');
      online = true; res.end('dr1003({"result":1});');
    } else if (url.pathname === '/eportal/portal/logout') {
      assert.equal(url.search, '');
      online = false; res.end('dr1003({"result":1});');
    } else { res.writeHead(404); res.end(); }
  });
  apiPort = new URL(api).port;
  origin = await listen((req, res) => {
    const url = new URL(req.url, 'http://local.invalid');
    calls.push({ destination: 'portal', url });
    if (url.pathname === '/a41.js') {
      res.end(`var epHTTPPort=${apiPort}; var page_data_encrypt='0'; var jsVersion='4.2.1'; var portal_api='/eportal/portal/';`);
    } else if (url.pathname === '/drcom/chkstatus') {
      res.end(`dr1003(${JSON.stringify({ result: 1, v46ip: '192.0.2.80', ...(online ? { uid: 'synthetic-authenticated' } : {}) })});`);
    } else {
      res.end(page(online).replace('</html>', '<script>var v46ip="192.0.2.80";</script><script src="/a41.js"></script></html>'));
    }
  });
  const probe = await listen((req, res) => {
    calls.push({ destination: 'probe', url: new URL(req.url, 'http://local.invalid') });
    res.writeHead(302, { Location: `${origin}/a79.htm?userip=192.0.2.80` }); res.end();
  });
  const profile = { id: 'auto-real-detector', protocol: 'drcom-auto', homepage: `${probe}/redirect`, timeoutMs: 1000 };
  assert.equal((await runOperation(profile, 'login', credentials)).online, true);
  const result = await runOperation(profile, 'logout');
  assert.equal(result.online, false);
  assert.equal(result.portalUrl, `${origin}/`);
  assert.ok(calls.filter(call => call.destination === 'probe').every(call => call.url.pathname === '/redirect' && !call.url.search));
  assert.equal(calls.filter(call => call.url.pathname === '/eportal/portal/page/loadConfig').length, 2);
  assert.ok(calls.filter(call => call.url.searchParams.has('user_password')).every(call => call.destination === 'api' && call.url.pathname === '/eportal/portal/login'));
});

test('CampusService keeps automatic status and logout working after the probe goes online and rediscovers another campus', async t => {
  const calls = [];
  async function listen(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function campus(name, initialIp) {
    const state = { name, ip: initialIp, online: false };
    const api = await listen((req, res) => {
      const url = new URL(req.url, 'http://local.invalid');
      calls.push({ name, destination: 'api', url });
      if (url.pathname === '/eportal/portal/page/loadConfig') {
        res.end('dr1001({"result":1,"data":{"login_method":1,"account_prefix":1,"account_suffix":"@telecom","en_md5":0,"enable_r3":0}});');
      } else if (url.pathname === '/eportal/portal/login') {
        assert.equal(url.searchParams.get('wlan_user_ip'), state.ip);
        state.online = true; res.end('dr1003({"result":1});');
      } else if (url.pathname === '/eportal/portal/logout') {
        assert.equal(url.search, '');
        state.online = false; res.end('dr1003({"result":1});');
      } else { res.writeHead(404); res.end(); }
    });
    state.origin = await listen((req, res) => {
      const url = new URL(req.url, 'http://local.invalid');
      calls.push({ name, destination: 'portal', url });
      if (url.pathname === '/a41.js') res.end(`var epHTTPPort=${new URL(api).port};var page_data_encrypt=0;var jsVersion='4.2.1';var portal_api='/eportal/portal/';`);
      else if (url.pathname === '/drcom/chkstatus') res.end(`dr1003(${JSON.stringify({ result: 1, v46ip: state.ip, ...(state.online ? { uid: 'synthetic-user' } : {}) })});`);
      else {
        const currentPage = state.online ? '<html><!--Dr.COMWebLoginID_1.htm--><body>online</body></html>' : page(false);
        res.end(currentPage.replace('</html>', `<script>var v46ip='${state.ip}';</script><script src='/a41.js'></script></html>`));
      }
    });
    return state;
  }
  const first = await campus('first', '192.0.2.81'), second = await campus('second', '192.0.2.92');
  let active = first;
  const probe = await listen((req, res) => {
    calls.push({ name: 'probe', destination: 'probe', url: new URL(req.url, 'http://local.invalid') });
    res.writeHead(302, { Location: active.online ? 'http://www.msn.com/' : `${active.origin}/a79.htm?userip=${active.ip}&wlanacip=192.0.2.1` });
    res.end();
  });
  const profile = builtinProfiles.find(item => item.protocol === 'drcom-auto');
  assert.ok(profile, 'The production catalog exposes the automatic profile');
  const original = JSON.stringify(profile);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-auto-service-test-'));
  const service = new CampusService({
    directory,
    safeStorage: { isEncryptionAvailable: () => false },
    operation: (current, operation, context) => runOperation({ ...current, homepage: `${probe}/redirect`, portalDiscovery: { url: `${probe}/redirect` } }, operation, context),
  });
  t.after(() => {
    service.dispose();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('campus-auto-service-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  service.saveSettings({ profileId: profile.id, autoReconnect: false });
  assert.equal((await service.connect({ ...credentials, rememberPassword: false })).connection.status, 'connected');
  first.ip = '192.0.2.82';
  let start = calls.length;
  const current = await service.checkStatus();
  assert.equal(current.connection.status, 'connected', current.connection.message);
  assert.equal(current.connection.ip, first.ip);
  assert.ok(calls.slice(start).filter(call => call.destination === 'portal' && /a79\.htm|^\/$/.test(call.url.pathname)).every(call => !call.url.search), 'Cached entry retains no former device query');
  assert.equal((await service.disconnect()).connection.status, 'idle');
  active = second; start = calls.length;
  assert.equal((await service.checkStatus()).connection.status, 'idle');
  assert.ok(calls.slice(start).every(call => call.name !== 'first'), 'A newly discovered portal takes precedence over the cached old origin');
  assert.equal((await service.connect({ ...credentials, rememberPassword: false })).connection.status, 'connected');
  assert.equal((await service.checkStatus()).connection.status, 'connected');
  assert.equal((await service.disconnect()).connection.status, 'idle');
  const saved = fs.readFileSync(service.file, 'utf8');
  for (const secret of [credentials.password, first.ip, second.ip, first.origin, second.origin, 'userip', 'wlanacip']) assert.equal(saved.includes(secret), false);
  assert.equal(JSON.parse(saved).credential, null);
  assert.equal(JSON.stringify(profile), original);
  assert.ok(calls.filter(call => call.url.searchParams.has('user_password')).every(call => call.destination === 'api' && call.url.pathname === '/eportal/portal/login'));
});

test('online Web pages without service radios still support fresh status and logout after an idle interval', async t => {
  let online = false;
  const calls = [];
  async function listen(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const origin = await listen((req, res) => {
    const url = new URL(req.url, 'http://local.invalid'); calls.push(url);
    if (url.pathname === '/drcom/chkstatus') {
      // Deliberately omit uid: the adapter must read the fresh HTML marker.
      res.end('dr1003({"result":1,"v46ip":"192.0.2.63"});');
    } else if (url.pathname === '/drcom/login') {
      assert.equal(url.searchParams.get('R3'), '1');
      assert.equal(url.searchParams.get('DDDDD'), credentials.username);
      online = true; res.end('dr1003({"result":1});');
    } else if (url.pathname === '/drcom/logout') {
      assert.equal(url.searchParams.has('DDDDD'), false);
      assert.equal(url.searchParams.has('upass'), false);
      online = false; res.end('dr1003({"result":1});');
    } else {
      const form = online ? '<body>online</body>' : '<form><input name="DDDDD"><input name="upass"><label><input type="radio" name="R3" value="1" checked>校园网</label></form>';
      res.end(`<html><!--Dr.COMWebLoginID_${online ? 1 : 0}.htm--><script>var jsVersion='4.2.1';var config={login_method:0,en_md5:0,enable_r3:1,account_prefix:0};</script>${form}</html>`);
    }
  });
  const probe = await listen((_req, res) => {
    res.writeHead(302, { Location: online ? 'http://www.msn.com/' : `${origin}/a79.htm?userip=192.0.2.63` }); res.end();
  });
  const profile = { ...structuredClone(builtinProfiles.find(item => item.protocol === 'drcom-auto')), id: `web-without-radios-${new URL(probe).port}`, homepage: `${probe}/redirect`, portalDiscovery: { url: `${probe}/redirect` } };
  assert.equal((await runOperation(profile, 'login', credentials)).online, true);
  const now = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => now() + 31 * 60 * 1000);
  assert.equal((await runOperation(profile, 'status')).online, true);
  const before = calls.filter(url => url.pathname === '/drcom/login').length;
  assert.equal((await runOperation(profile, 'login', credentials)).online, true, 'An existing online session needs no operator choice');
  assert.equal(calls.filter(url => url.pathname === '/drcom/login').length, before);
  assert.equal((await runOperation(profile, 'logout')).online, false);
  assert.equal(calls.filter(url => url.pathname === '/drcom/logout').length, 1);
});
