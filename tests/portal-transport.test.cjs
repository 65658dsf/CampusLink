'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { portalRequest } = require('../electron/portal-transport.cjs');
const { CampusError, MAX_RESPONSE_BYTES } = require('../electron/transport.cjs');

async function serve(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('portal sends a literal Host header and forwards only explicit HTTP fields', async t => {
  const requests = [];
  const origin = await serve(t, (req, res) => {
    requests.push(req);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => res.end(Buffer.concat(chunks)));
  });
  const diagnostics = [];
  const options = {
    method: 'POST', headers: { host: new URL(origin).host, 'X-Campus': 'test' },
    body: new URLSearchParams({ userId: 'sample-student', password: 'sample-pass' }),
    diagnosticSecrets: ['sample-student', 'sample-pass'],
    allowRedirect: true, onResponse: () => {}, onDiagnostic: entry => diagnostics.push(entry),
  };
  assert.equal(await portalRequest(origin, options), 'userId=sample-student&password=sample-pass');
  assert.ok(requests[0].rawHeaders.includes('Host'));
  assert.ok(!requests[0].rawHeaders.includes('host'));
  assert.equal(requests[0].headers['x-campus'], 'test');
  assert.equal(requests[0].headers['accept-encoding'], 'identity');
  assert.match(requests[0].headers['content-type'], /application\/x-www-form-urlencoded/);
  for (const name of ['ondiagnostic', 'onresponse', 'diagnosticsecrets', 'allowredirect']) assert.equal(requests[0].headers[name], undefined);
  assert.equal(diagnostics.length, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /sample-student|sample-pass/);
});

test('GET redirect exposes headers and body but is never followed, POST cannot opt in', async t => {
  const paths = [];
  let observed;
  const origin = await serve(t, (req, res) => {
    paths.push(req.url);
    if (req.url === '/target') { res.end('target must not be requested'); return; }
    res.writeHead(302, { Location: '/target', 'Set-Cookie': ['sid=sample-session; HttpOnly; Path=/'] });
    res.end('redirect-body');
  });
  assert.equal(await portalRequest(`${origin}/start`, {
    allowRedirect: true,
    onResponse: metadata => { observed = metadata; },
  }), 'redirect-body');
  assert.deepEqual(observed, { status: 302, location: '/target', setCookies: ['sid=sample-session; HttpOnly; Path=/'] });
  for (const options of [{}, { method: 'POST', allowRedirect: true, body: 'sample' }]) {
    await assert.rejects(portalRequest(`${origin}/start`, options), error => {
      assert.ok(error instanceof CampusError);
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.diagnostics[0].status, 302);
      assert.equal(error.diagnostics[0].responseBody, 'redirect-body');
      return true;
    });
  }
  assert.deepEqual(paths, ['/start', '/start', '/start']);
});

test('cookies are returned as metadata, never automatically sent to another request', async t => {
  const cookies = [];
  const origin = await serve(t, (req, res) => {
    cookies.push(req.headers.cookie);
    res.setHeader('Set-Cookie', 'sid=session-only');
    res.end('ok');
  });
  await portalRequest(origin);
  await portalRequest(origin);
  assert.deepEqual(cookies, [undefined, undefined]);
});

test('portal decodes declared GBK charset without executing JSONP', async t => {
  const origin = await serve(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=gbk');
    res.end(Buffer.from([0xb5, 0xc7, 0xc2, 0xbc, 0xb3, 0xc9, 0xb9, 0xa6]));
  });
  assert.equal(await portalRequest(origin), '登录成功');
});

test('timeout covers the response body and captures a bounded, redacted partial response', async t => {
  const diagnostics = [];
  const origin = await serve(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('account=sample-student&password=sample-password\n');
  });
  await assert.rejects(portalRequest(origin, { onDiagnostic: value => diagnostics.push(value) }, 60), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.diagnostics[0].status, 200);
    assert.equal(error.diagnostics[0].truncated, true);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /sample-student|sample-password/);
    return true;
  });
  assert.equal(diagnostics.length, 1);
});

test('oversized declared and streamed bodies stop at the cap; HTTP errors retain their code', async t => {
  const origin = await serve(t, (req, res) => {
    const huge = Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'x');
    if (req.url === '/declared') res.writeHead(200, { 'Content-Length': huge.length });
    else res.writeHead(req.url === '/error' ? 503 : 200, { 'Transfer-Encoding': 'chunked' });
    res.end(huge);
  });
  for (const [path, code] of [['/declared', 'RESPONSE_TOO_LARGE'], ['/streamed', 'RESPONSE_TOO_LARGE'], ['/error', 'HTTP_ERROR']]) {
    await assert.rejects(portalRequest(`${origin}${path}`), error => {
      assert.equal(error.code, code);
      assert.equal(error.diagnostics[0].truncated, true);
      assert.ok(Buffer.byteLength(error.diagnostics[0].responseBody) <= 16 * 1024);
      return true;
    });
  }
});

test('diagnostics redact URL, account/password echoes and request/response cookie values', async t => {
  const origin = await serve(t, (_req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'Set-Cookie': 'sid=issued-session-secret; Path=/; HttpOnly' });
    res.end('sample-student sample-password client-cookie-secret issued-session-secret extra-secret');
  });
  let observed;
  await assert.rejects(portalRequest(`${origin}/login?username=sample-student&password=sample-password`, {
    headers: { Cookie: 'sid=client-cookie-secret' }, diagnosticSecrets: ['extra-secret'],
    onDiagnostic: diagnostic => { observed = diagnostic; },
  }), error => {
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.diagnostics[0].url, `${origin}/login`);
    assert.equal(error.diagnostics[0].status, 403);
    assert.equal(error.diagnostics[0], observed);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /sample-student|sample-password|client-cookie-secret|issued-session-secret|extra-secret/);
    return true;
  });
});

test('observer failures do not change success; credential URLs never reach the server', async t => {
  let calls = 0;
  const origin = await serve(t, (_req, res) => { calls++; res.end('ok'); });
  assert.equal(await portalRequest(origin, {
    onResponse: () => { throw new Error('observer-private'); },
    onDiagnostic: () => { throw new Error('observer-private'); },
  }), 'ok');
  await assert.rejects(portalRequest(origin.replace('http://', 'http://private-user:private-password@')), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /private-user|private-password/);
    return true;
  });
  assert.equal(calls, 1);
});
