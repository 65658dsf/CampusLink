'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfile } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');

test('Dr.COM login preserves the successful browser capture order and duplicate language fields', async () => {
  const calls = [];
  const result = await runOperation(builtinProfile, 'login', { username: 'test+user', password: 'test pass&word', parameters: { operator: '1' } }, async (url, options) => {
    calls.push({ url: new URL(url), options });
    return '     dr1003({"result":1,"v46ip":"192.0.2.1","uid":"test+user"})   ';
  });
  assert.equal(result.online, true);
  const { url, options } = calls[0];
  assert.deepEqual([...url.searchParams.keys()], ['callback', 'DDDDD', 'upass', '0MKKey', 'R1', 'R2', 'R3', 'R6', 'para', 'v6ip', 'terminal_type', 'lang', 'jsVersion', 'v', 'lang']);
  assert.deepEqual(url.searchParams.getAll('lang'), ['en', 'en']);
  assert.match(url.search, /^\?callback=dr1003&DDDDD=test%2Buser&upass=test%20pass%26word&0MKKey=123456&/);
  assert.ok(Number(url.searchParams.get('v')) >= 500 && Number(url.searchParams.get('v')) <= 10499);
  assert.equal(options.headers.Referer, builtinProfile.homepage);
  assert.equal(options.headers['Accept-Language'], 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.equal(calls[1].url.pathname, '/drcom/chkstatus');
  assert.equal(calls[1].url.searchParams.has('upass'), false);
});

test('the observed HTTP 203 HTML rejection reaches clickable logs with a redacted response', async t => {
  const username = 'diagnostic-student';
  const password = 'diagnostic-private-password';
  const server = http.createServer((_req, res) => {
    res.writeHead(203, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body>Error code: 203 Bad request(2) ${username} ${password}<script>unsafe()</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const localProfile = { ...builtinProfile, homepage: `http://127.0.0.1:${server.address().port}/` };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-response-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = new CampusService({ directory, operation: (_profile, operation, context) => runOperation(localProfile, operation, context) });
  const snapshot = await service.connect({ username, password, rememberPassword: false });
  assert.equal(snapshot.connection.status, 'error');
  assert.match(snapshot.connection.message, /Bad request\(2\)/);
  const errorLog = snapshot.logs.find(log => log.level === 'error');
  assert.equal(errorLog.details.code, 'PORTAL_BAD_REQUEST');
  assert.equal(errorLog.details.requests[0].status, 203);
  assert.equal(errorLog.details.requests[0].contentType, 'text/html; charset=utf-8');
  assert.match(errorLog.details.requests[0].responseBody, /Bad request\(2\)/);
  assert.match(errorLog.details.requests[0].responseBody, /<script>unsafe/);
  const details = JSON.stringify(errorLog);
  assert.equal(details.includes(username), false);
  assert.equal(details.includes(password), false);
  assert.equal(errorLog.details.requests[0].url.includes('?'), false);
  assert.equal(fs.readFileSync(service.file, 'utf8').includes('Bad request'), false, 'Responses remain in memory only');
});

test('server msga feedback is preserved while credentials are redacted in summary and response', async () => {
  const context = { username: 'private-account', password: 'private-password' };
  await assert.rejects(runOperation(builtinProfile, 'login', context, async () => `dr1003(${JSON.stringify({ result: 0, msg: 1, msga: `error5 waitsec <3 ${context.username} ${context.password}` })});`), error => {
    assert.match(error.message, /error5 waitsec <3/);
    const combined = error.message + JSON.stringify(error.diagnostics);
    assert.equal(combined.includes(context.username), false);
    assert.equal(combined.includes(context.password), false);
    assert.equal(error.diagnostics.length, 1);
    return true;
  });
});
