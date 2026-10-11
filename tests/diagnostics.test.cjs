'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { request, CampusError, MAX_RESPONSE_BYTES } = require('../electron/transport.cjs');
const { createDiagnostic, sanitizeText, collectSecrets, MAX_DIAGNOSTIC_BYTES } = require('../electron/diagnostics.cjs');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('request diagnostics hide query, URL credentials and all credential echoes', () => {
  const account = 'student+example';
  const password = 's<&"\\ 密/word';
  const url = new URL('https://portal.invalid/login?callback=hello');
  url.username = 'admin'; url.password = 'private';
  url.searchParams.set('DDDDD', account); url.searchParams.set('upass', password);
  const echo = [account, password, encodeURIComponent(password), new URLSearchParams({ value: password }).toString(), JSON.stringify(password), [...password].map(char => `&#${char.codePointAt(0)};`).join('')].join('\n');
  const diagnostic = createDiagnostic(url, { method: 'get' }, { responseBody: echo, status: 200, durationMs: 3.7 });
  assert.equal(diagnostic.url, 'https://portal.invalid/login');
  assert.equal(diagnostic.method, 'GET');
  assert.equal(diagnostic.durationMs, 4);
  assert.equal(diagnostic.status, 200);
  assert.equal(diagnostic.responseBody.includes(account), false);
  assert.equal(diagnostic.responseBody.includes(password), false);
  assert.equal(diagnostic.responseBody.includes('word'), false);
  assert.equal(diagnostic.responseBody.includes('s%3C'), false);
  assert.match(diagnostic.responseBody, /已隐藏/);
});

test('redaction preserves harmless source and handles mixed, nested and JSON escaping', () => {
  const secret = 'ab&密"z';
  const escaped = 'a&#98;&amp;%E5%AF%86\\"\\u007a';
  const doubleEncoded = encodeURIComponent(encodeURIComponent(secret));
  const result = sanitizeText(`<pre>safe &amp; visible</pre> ${escaped} ${doubleEncoded}`, [secret]);
  assert.equal(result, '<pre>safe &amp; visible</pre> [已隐藏] [已隐藏]');
  assert.equal(sanitizeText('\\u0061\\x62&#x26;密&quot;z', [secret]), '[已隐藏]');
  assert.equal(sanitizeText('escaped \\ud83d\\ude80', ['🚀']), 'escaped [已隐藏]');
});

test('request JSON, form body and sensitive headers supply redaction secrets', () => {
  assert.deepEqual(new Set(collectSecrets('https://portal.invalid/', { body: '{"nested":{"password":"JSON-secret","user_name":"student"}}' })), new Set(['JSON-secret', 'student']));
  const diagnostic = createDiagnostic('https://portal.invalid/', {
    body: 'username=hidden%2Baccount&password=form%26secret',
    headers: { Authorization: 'Bearer header-token', Cookie: 'sid=cookie-value; session=second-value' },
    diagnosticSecrets: ['explicit-secret'],
  }, { responseBody: 'hidden+account form&secret header-token cookie-value second-value explicit-secret' });
  assert.equal(diagnostic.responseBody, '[已隐藏] [已隐藏] [已隐藏] [已隐藏] [已隐藏] [已隐藏]');
});

test('server-issued secrets are hidden even when not present in the request', () => {
  const response = '{"password":"server-pass","user_name":"server-user","access_token":"server-token"}\nAuthorization: Bearer arbitrary-value\nSet-Cookie: session=arbitrary-cookie; Path=/\n<input value="input-secret" name="upass"><script>token = "script-secret";</script>';
  const result = sanitizeText(response);
  for (const secret of ['server-pass', 'server-user', 'server-token', 'arbitrary-value', 'arbitrary-cookie', 'input-secret', 'script-secret']) assert.equal(result.includes(secret), false, secret);
  assert.match(result, /<script>/, 'HTML remains inert text for the renderer, never executed here');
  assert.equal(sanitizeText('{"pass\\u0077ord":"embedded\\"quote-tail"}').includes('quote-tail'), false);
  assert.equal(sanitizeText('hello\u0000\u001b\u202e world\nnext\tcolumn'), 'hello world\nnext\tcolumn');
});

test('Dr.COM account, encoded account and device fields do not expose personal identifiers', () => {
  const account = 'example-student-321';
  const encoded = Buffer.from(account).toString('base64');
  const result = sanitizeText(`uid='server-user';ac0='${encoded}';ss1='other-account';ss4='server-secret';mac='A0:01:02:03:04:05';client_mac='A1:02:03:04:05:06';freeEcho=${encoded}`, [account]);
  for (const secret of ['server-user', encoded, 'other-account', 'server-secret', 'A0:01:02:03:04:05', 'A1:02:03:04:05:06']) assert.equal(result.includes(secret), false, secret);
  const password = 'Base64-password?';
  for (const variant of [Buffer.from(password).toString('base64'), Buffer.from(password).toString('base64url')]) assert.equal(sanitizeText(variant, [password]), '[已隐藏]');
});

test('one MiB plain text and malformed HTML diagnostics finish within a bounded worker deadline', () => {
  const modulePath = path.resolve(__dirname, '../electron/diagnostics.cjs');
  const worker = spawnSync(process.execPath, ['-e', `
    const { createDiagnostic } = require(${JSON.stringify(modulePath)});
    for (const source of ['x'.repeat(1024 * 1024), '<input '.repeat(Math.floor(1024 * 1024 / 7)), '<input name="password" value="' + 'x'.repeat(1024 * 1024 - 30)]) {
      const result = createDiagnostic('http://portal.invalid/', {}, { responseBody: source });
      if (Buffer.byteLength(result.responseBody) > 16384) throw new Error('unbounded output');
    }
  `], { timeout: 5000, encoding: 'utf8', windowsHide: true });
  assert.equal(worker.error, undefined, worker.error?.message);
  assert.equal(worker.status, 0, worker.stderr);
});

test('diagnostic bodies are UTF-8 byte bounded and redact before truncating', () => {
  const secret = 'Boundary-secret-that-must-not-leak';
  const body = '字'.repeat(5500) + secret;
  const result = createDiagnostic('http://portal.invalid/', { diagnosticSecrets: [secret] }, { responseBody: body });
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.responseBody, 'utf8') <= MAX_DIAGNOSTIC_BYTES);
  assert.match(result.responseBody, /已截断/);
  assert.equal(result.responseBody.includes('�'), false);
  const partial = createDiagnostic('http://portal.invalid/', { diagnosticSecrets: [secret] }, { responseBody: 'prefix Boundary-secret', truncated: true });
  assert.equal(partial.responseBody.includes('Boundary'), false);
});

test('HTTP errors retain bounded redacted server bodies and notify exactly once', async t => {
  const origin = await fixture(t, (req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html>Denied test-account test-password <script>bad()</script></html>');
  });
  const diagnostics = [];
  await assert.rejects(request(`${origin}/login?username=test-account&upass=test-password`, { onDiagnostic: item => diagnostics.push(item) }), error => {
    assert.ok(error instanceof CampusError);
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.diagnostics.length, 1);
    assert.equal(error.diagnostics[0], diagnostics[0]);
    return true;
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].status, 403);
  assert.equal(diagnostics[0].url, `${origin}/login`);
  assert.match(diagnostics[0].responseBody, /Denied \[已隐藏\] \[已隐藏\]/);
  assert.match(diagnostics[0].responseBody, /<script>/);
});

test('successful requests preserve full original text while removing internal fetch options', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let received;
  global.fetch = async (_url, options) => { received = options; return new Response('original private response', { headers: { 'Content-Type': 'text/plain' } }); };
  const diagnostics = [];
  const result = await request('http://portal.invalid/', { diagnosticSecrets: ['private'], onDiagnostic: item => diagnostics.push(item) });
  assert.equal(result, 'original private response');
  assert.equal(Object.hasOwn(received, 'diagnosticSecrets'), false);
  assert.equal(Object.hasOwn(received, 'onDiagnostic'), false);
  assert.equal(received.redirect, 'error');
  assert.equal(diagnostics[0].responseBody, 'original [已隐藏] response');
  assert.equal(await request('http://portal.invalid/', { onDiagnostic: () => { throw new Error('observer failure'); } }), 'original private response');
});

test('timeout, redirect and oversized responses retain safe diagnostics', async t => {
  let followed = false;
  const origin = await fixture(t, (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/target' }); res.end(); }
    else if (req.url === '/target') { followed = true; res.end('unexpected'); }
    else if (req.url === '/large') { res.writeHead(200, { 'Content-Length': MAX_RESPONSE_BYTES + 10 }); res.end('x'); }
    else if (req.url === '/error-large') { res.writeHead(500); res.end('x'.repeat(MAX_RESPONSE_BYTES + 100)); }
  });
  for (const [path, code] of [['/wait', 'TIMEOUT'], ['/redirect', 'NETWORK_ERROR'], ['/large', 'RESPONSE_TOO_LARGE'], ['/error-large', 'HTTP_ERROR']]) {
    const events = [];
    await assert.rejects(request(`${origin}${path}`, { onDiagnostic: item => events.push(item) }, path === '/wait' ? 50 : 5000), error => {
      assert.equal(error.code, code);
      assert.equal(error.diagnostics.length, 1);
      assert.equal(error.diagnostics[0].url, `${origin}${path}`);
      assert.ok(Buffer.byteLength(error.diagnostics[0].responseBody) <= MAX_DIAGNOSTIC_BYTES);
      if (path.includes('large')) assert.equal(error.diagnostics[0].truncated, true);
      return true;
    });
    assert.equal(events.length, 1);
  }
  assert.equal(followed, false);
});
