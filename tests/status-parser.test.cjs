'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { request, parseJsonOrJsonp, CampusError } = require('../electron/transport.cjs');
const { runOperation, drcomPageStatus } = require('../electron/adapters.cjs');
const { builtinProfile } = require('../electron/profiles.cjs');

const page = marker => `<!DOCTYPE html><html><head><!--Dr.COMWebLoginID_${marker}.htm-->
  <script>authsuccess='Dr.COMWebLoginID_3.htm';authfail='Dr.COMWebLoginID_2.htm';</script>
  </head><body></body></html>`;

test('portal JSONP accepts observed padding, optional semicolons, BOM, and strict callback wrappers', () => {
  for (const source of [
    '     dr1003({"result":1,"uid":"example-student"})   ',
    '\uFEFF\r\n dr1003 ( {"result":"1"} );\r\n',
    '/**/dr1003({"result":0});',
    'portal.callback({"result":"0"});',
    '{"result":1}',
  ]) assert.ok(Object.hasOwn(parseJsonOrJsonp(source), 'result'));
});

test('JSONP rejects scripts and non-JSON object syntax without evaluating the response', () => {
  for (const source of [
    'dr1003({result:1});',
    "dr1003({'result':1});",
    'dr1003({"result":1});globalThis.portalExecuted=true;',
    'dr1003((globalThis.portalExecuted=true,{"result":1}));',
    'var data={"result":1};',
    'dr1003({"result":1}, {"result":0});',
    '<html><body>已成功登录</body></html>',
    'dr1003({"result":1',
  ]) assert.throws(() => parseJsonOrJsonp(source), { code: 'INVALID_RESPONSE' });
  assert.equal(globalThis.portalExecuted, undefined);
});

test('known online and offline JSONP states never require a homepage request', async () => {
  for (const state of [1, '1', 0, '0']) {
    const calls = [];
    const result = await runOperation(builtinProfile, 'status', {}, async (url, options) => {
      calls.push(new URL(url));
      assert.equal(options.method, 'GET');
      return `     dr1003(${JSON.stringify({ result: state })})   `;
    });
    assert.equal(result.online, Number(state) === 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/drcom/chkstatus');
    assert.equal(calls[0].searchParams.get('callback'), 'dr1003');
    assert.equal(calls[0].searchParams.get('jsVersion'), '4.2.1');
    assert.equal(calls[0].searchParams.has('DDDDD'), false);
    assert.equal(calls[0].searchParams.has('upass'), false);
  }
});

test('HTML fallback recognizes only the current page marker and ignores script template references', async () => {
  for (const marker of [1, 3, 2]) {
    const calls = [];
    const result = await runOperation(builtinProfile, 'status', {}, async (url, options) => {
      const parsed = new URL(url);
      calls.push(parsed.pathname);
      assert.equal(options.method, 'GET');
      assert.equal(parsed.searchParams.has('upass'), false);
      return parsed.pathname === '/drcom/chkstatus' ? '<html><body>redirect page</body></html>' : page(marker);
    });
    assert.equal(result.online, marker !== 2);
    assert.deepEqual(calls, ['/drcom/chkstatus', '/']);
  }
});

test('unknown, conflicting, or script-only HTML markers never claim online or offline', () => {
  for (const html of [
    '<html><body>您已经成功登录。<button>注销</button></body></html>',
    '<html><script>authsuccess="Dr.COMWebLoginID_3.htm";authfail="Dr.COMWebLoginID_2.htm";</script></html>',
    '<html><script>"<!--Dr.COMWebLoginID_1.htm-->"</script></html>',
    '<html><script><!--Dr.COMWebLoginID_1.htm-->',
    '<html><!--Dr.COMWebLoginID_1.htm--><!--Dr.COMWebLoginID_2.htm--></html>',
    '<html><body>Dr.COMWebLoginID_1.htm</body></html>',
    '<!--Dr.COMWebLoginID_1.htm-->',
    page(0),
    page(4),
  ]) assert.throws(() => drcomPageStatus(html), { code: 'UNKNOWN_RESPONSE' });
});

test('unrecognized status values use the fallback and stay unknown if it is also unrecognized', async () => {
  for (const api of ['{}', '{"result":2}', '{"result":"ok"}', '{"result":true}', '[]', 'dr1003({"result":null});', 'invalid']) {
    const calls = [];
    await assert.rejects(runOperation(builtinProfile, 'status', {}, async url => {
      calls.push(new URL(url).pathname);
      return calls.length === 1 ? api : '<html><body>portal unavailable</body></html>';
    }), { code: 'UNKNOWN_RESPONSE' });
    assert.deepEqual(calls, ['/drcom/chkstatus', '/']);
  }
});

test('a status timeout can recover from the fresh homepage but two timeouts remain an error', async () => {
  let requests = 0;
  const recovered = await runOperation(builtinProfile, 'status', {}, async () => {
    if (++requests === 1) throw new CampusError('timeout', 'TIMEOUT');
    return page(1);
  });
  assert.equal(recovered.online, true);
  assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(runOperation(builtinProfile, 'status', {}, async () => {
    requests++;
    throw new CampusError('timeout', 'TIMEOUT');
  }), { code: 'TIMEOUT' });
  assert.equal(requests, 2);
});

test('unrecognized login and logout responses cannot be rescued by an unrelated online homepage', async () => {
  for (const operation of ['login', 'logout']) {
    const calls = [];
    await assert.rejects(runOperation(builtinProfile, operation, {}, async url => {
      calls.push(new URL(url).pathname);
      return page(1);
    }), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(calls, [`/drcom/${operation}`]);
  }
});

test('accepted login still verifies online using a read-only homepage fallback', async () => {
  const calls = [];
  const result = await runOperation(builtinProfile, 'login', { username: 'example', password: 'test-only' }, async url => {
    const endpoint = new URL(url).pathname;
    calls.push(endpoint);
    return endpoint === '/drcom/login' ? 'dr1003({"result":"ok"});' : endpoint === '/' ? page(1) : '<html></html>';
  });
  assert.equal(result.online, true);
  assert.deepEqual(calls, ['/drcom/login', '/drcom/chkstatus', '/']);
});

test('transport honors the portal GBK response encoding', async t => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=gbk');
    res.end(Buffer.concat([Buffer.from('dr1003({"result":1,"msg":"'), Buffer.from([0xb5, 0xc7, 0xc2, 0xbc]), Buffer.from('"})')]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const body = await request(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(parseJsonOrJsonp(body), { result: 1, msg: '登录' });
});
