'use strict';

// NingMeng123 — SWU pageInfo wire contract; isolated local servers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPublicKey, generateKeyPairSync, publicEncrypt, constants } = require('node:crypto');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfiles, builtinRuijieProfile } = require('../electron/profiles.cjs');

const mac = 'aabbccddeeff';
const query = `mac=${mac}&wlanuserip=192.0.2.50&opaque=a%2Bb%2520`;
const account = { username: 'student+测试', password: '密碼+&Password', parameters: { service: '默认' } };
const originalKey = builtinRuijieProfile.ruijie.publicKey;

function expectedCipher(password, key) {
  // OpenSSL's RSA_NO_PADDING is independent of the adapter's modular arithmetic.
  const modulus = Buffer.from(key.modulus, 'hex');
  const exponent = Buffer.from(key.exponent.padStart(Math.ceil(key.exponent.length / 2) * 2, '0'), 'hex');
  const publicKey = createPublicKey({ key: { kty: 'RSA', n: modulus.toString('base64url'), e: exponent.toString('base64url') }, format: 'jwk' });
  const bytes = Buffer.from(`${password}>${mac}`, 'utf8');
  const input = Buffer.concat([Buffer.alloc(modulus.length - bytes.length), bytes]);
  return publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, input).toString('hex').replace(/^0+/, '') || '0';
}

async function fixture(t, initial = {}) {
  const state = { online: false, calls: [], key: originalKey, ...initial };
  let origin;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, origin);
    state.calls.push({ url, body, method: req.method, headers: req.headers });
    if (url.pathname === '/') {
      res.writeHead(302, { Location: state.online ? '/eportal/success.jsp?userIndex=private-session-index' : `/eportal/index.jsp?${query}`, 'Set-Cookie': 'JSESSIONID=private-cookie; Path=/eportal' });
      res.end();
    } else if (url.pathname === '/eportal/index.jsp' || url.pathname === '/eportal/success.jsp') {
      res.end('<html>Ruijie ePortal</html>');
    } else if (url.pathname === '/eportal/InterFace.do') {
      const method = url.searchParams.get('method');
      if (method === 'pageInfo') {
        if (state.redirect) { res.writeHead(302, { Location: state.redirect }); res.end(); return; }
        res.writeHead(state.status || 200, { 'Content-Type': 'application/json' });
        if (state.raw !== undefined) res.end(state.raw);
        else res.end(JSON.stringify(state.info === undefined ? { publicKeyExponent: state.key.exponent, publicKeyModulus: state.key.modulus } : state.info));
      } else if (method === 'login') {
        const form = new URLSearchParams(body);
        if (state.reject) res.end(JSON.stringify({ result: 'fail', message: `${account.username} ${account.password} ${form.get('password')}`, queryString: query }));
        else { state.online = true; res.end('{"result":"success"}'); }
      } else if (method === 'logout') {
        state.online = false; res.end('{"result":"success"}');
      } else { res.writeHead(400); res.end('Unexpected API'); }
    } else { res.writeHead(404); res.end('Unexpected URL'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const builtin = builtinProfiles.find(profile => profile.id === 'builtin-swu-ruijie');
  assert.ok(builtin, 'SWU must be registered in the built-in catalog');
  const profile = structuredClone(builtin);
  profile.id = 'fixture-swu';
  profile.homepage = `${origin}/`;
  profile.ruijie.discoveryUrl = profile.homepage;
  profile.ruijie.redirectOrigins = [];
  delete profile.portalDiscovery;
  return { profile, state, origin };
}

test('SWU pageInfo sends only the fresh query and uses dynamic UTF-8 RSA with normal form encoding', async t => {
  const { profile, state, origin } = await fixture(t);
  const before = JSON.stringify(profile);
  assert.equal((await runOperation(profile, 'status')).online, false);
  assert.equal((await runOperation(profile, 'login', account)).online, true);
  const posts = state.calls.filter(call => call.method === 'POST');
  assert.deepEqual(posts.map(call => call.url.searchParams.get('method')), ['pageInfo', 'login']);
  assert.deepEqual([...new URLSearchParams(posts[0].body)], [['queryString', query]]);
  assert.equal(posts[0].url.origin, origin);
  assert.equal(posts[0].headers.origin, origin);
  assert.equal(posts[0].headers.referer, `${origin}/eportal/index.jsp?${query}`);
  assert.match(posts[0].headers.cookie, /JSESSIONID=private-cookie/);
  const form = new URLSearchParams(posts[1].body);
  assert.equal(form.get('userId'), account.username);
  assert.equal(form.get('service'), '默认');
  assert.equal(form.get('queryString'), query);
  assert.equal(form.get('passwordEncrypt'), 'true');
  assert.equal(form.get('password'), expectedCipher(account.password, originalKey));
  assert.equal(form.get('operatorPwd'), '');
  assert.equal(form.get('validcode'), '');
  assert.equal(JSON.stringify(profile), before);
  assert.equal((await runOperation(profile, 'logout')).online, false);
  const logout = state.calls.find(call => call.url.searchParams.get('method') === 'logout');
  assert.deepEqual([...new URLSearchParams(logout.body)], [['userIndex', 'private-session-index']]);
  assert.equal(state.calls.filter(call => call.url.searchParams.get('method') === 'pageInfo').length, 1);
});

test('a subsequent login obtains a new public key without changing the stored profile', async t => {
  const { profile, state } = await fixture(t);
  await runOperation(profile, 'login', account);
  const jwk = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' });
  state.key = { modulus: Buffer.from(jwk.n, 'base64url').toString('hex'), exponent: Buffer.from(jwk.e, 'base64url').toString('hex') };
  state.online = false;
  await runOperation(profile, 'login', account);
  const requests = state.calls.filter(call => call.url.searchParams.get('method') === 'login');
  const ciphers = requests.map(call => new URLSearchParams(call.body).get('password'));
  assert.deepEqual(ciphers, [expectedCipher(account.password, originalKey), expectedCipher(account.password, state.key)]);
  assert.notEqual(ciphers[0], ciphers[1]);
  assert.equal(Object.hasOwn(profile.ruijie, 'publicKey'), false);
});

test('missing, malformed, oversized and invalid RSA key responses block credential submission', async t => {
  const { profile, state } = await fixture(t);
  const valid = { publicKeyModulus: originalKey.modulus, publicKeyExponent: originalKey.exponent };
  const cases = [
    null, [], {}, { ...valid, publicKeyModulus: 123 }, { ...valid, publicKeyExponent: 65537 },
    { ...valid, publicKeyModulus: 'f'.repeat(1025) }, { ...valid, publicKeyModulus: 'f'.repeat(127) },
    { ...valid, publicKeyModulus: '0'.repeat(300) }, { ...valid, publicKeyModulus: 'f'.repeat(255) + 'e' },
    { ...valid, publicKeyModulus: 'eval(1)' }, { ...valid, publicKeyExponent: '100000001' },
    { ...valid, publicKeyExponent: '2' }, { ...valid, publicKeyExponent: '0' },
    { ...valid, publicKeyExponent: '0x10001' }, { ...valid, publicKeyExponent: '' },
    { ...valid, result: 'fail' },
  ];
  for (const info of cases) {
    state.info = info;
    await assert.rejects(runOperation(profile, 'login', account), error => ['INVALID_RESPONSE', 'PORTAL_PUBLIC_KEY'].includes(error.code));
  }
  assert.equal(state.calls.some(call => call.url.searchParams.get('method') === 'login'), false);
});

test('pageInfo never follows redirects or evaluates scripts and HTTP errors do not fall back to a static key', async t => {
  const { profile, state } = await fixture(t);
  profile.ruijie.publicKey = originalKey;
  state.redirect = 'http://outside.example.invalid/collect';
  await assert.rejects(runOperation(profile, 'login', account), error => ['NETWORK_ERROR', 'PORTAL_REDIRECT'].includes(error.code));
  delete state.redirect;
  state.status = 503;
  await assert.rejects(runOperation(profile, 'login', account), { code: 'HTTP_ERROR' });
  state.status = 200;
  state.raw = '<script>throw new Error("must not execute")</script>';
  await assert.rejects(runOperation(profile, 'login', account), { code: 'INVALID_RESPONSE' });
  assert.equal(state.calls.some(call => call.url.searchParams.get('method') === 'login'), false);
});

test('online login and read-only status skip pageInfo and avoid sending credentials', async t => {
  const { profile, state } = await fixture(t, { online: true });
  assert.equal((await runOperation(profile, 'status')).online, true);
  assert.equal((await runOperation(profile, 'login', account)).online, true);
  assert.equal(state.calls.some(call => call.method === 'POST'), false);
});

test('dynamic encrypted passwords, account and device context are redacted from failure diagnostics', async t => {
  const { profile } = await fixture(t, { reject: true });
  await assert.rejects(runOperation(profile, 'login', account), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    const output = JSON.stringify({ message: error.message, diagnostics: error.diagnostics });
    for (const value of [account.username, account.password, expectedCipher(account.password, originalKey), query, mac, 'private-cookie']) assert.equal(output.includes(value), false, value);
    return true;
  });
});

test('UTF-8 input exceeding the RSA modulus is rejected before login', async t => {
  const { profile, state } = await fixture(t);
  await assert.rejects(runOperation(profile, 'login', { ...account, password: '密'.repeat(100) }), { code: 'INVALID_PARAMETERS' });
  assert.equal(state.calls.some(call => call.url.searchParams.get('method') === 'login'), false);
});
