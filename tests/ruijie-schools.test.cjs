'use strict';

// NingMeng123 — independent wire expectations for the five referenced campuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfiles, profileParameters, exportProfileJson, parseProfile } = require('../electron/profiles.cjs');

const account = { username: 'student+测试', password: '原始&Pass+% word' };
const query = 'wlanuserip=192.0.2.80&ssid=Campus_WLAN&opaque=a%2Bb';
const schools = [
  { id: 'builtin-jmu-ruijie', services: ['教育网接入', '移动宽带接入', '电信宽带接入', '联通宽带接入'], defaultService: '教育网接入', queryEncoding: 'jmu', serviceEncoding: 'percent' },
  { id: 'builtin-wtu-ruijie', services: ['DX', 'YD', 'LT'], defaultService: 'DX' },
  { id: 'builtin-upc-ruijie', services: ['cmcc', 'unicom', 'ctcc', 'default', 'local'], defaultService: 'cmcc', queryEncoding: 'upc' },
  { id: 'builtin-qust-ruijie', services: ['internet', 'local'], defaultService: 'internet' },
  { id: 'builtin-shu-ruijie', services: ['shu', 'dx', 'lt', 'yd'], defaultService: 'shu' },
];

function expectedQuery(value, encoding) {
  if (encoding === 'jmu') {
    const sourceWire = value.replaceAll('&', '%2526').replaceAll('=', '%253D');
    return new URLSearchParams(`queryString=${sourceWire}`).get('queryString');
  }
  if (encoding === 'percent') return encodeURIComponent(value);
  if (encoding !== 'upc') return value;
  // This source contract includes underscore and excludes hyphen and tilde.
  const punctuation = '!"#$%&\'()*+,/:;<=>?@[\\]^_`';
  return Array.from(value, character => punctuation.includes(character)
    ? `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    : character).join('');
}

async function fixture(t, builtin, initial = {}) {
  const state = { online: false, calls: [], query, ...initial };
  let origin;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const url = new URL(request.url, origin);
    state.calls.push({ url, body, method: request.method, headers: request.headers });
    if (url.pathname === '/') {
      response.writeHead(302, { Location: state.online
        ? '/eportal/success.jsp?userIndex=private-session'
        : `/eportal/index.jsp?${state.query}` });
      response.end();
    } else if (['/eportal/index.jsp', '/eportal/success.jsp'].includes(url.pathname)) {
      response.end('<html>Ruijie ePortal</html>');
    } else if (url.pathname === '/eportal/InterFace.do') {
      const method = url.searchParams.get('method');
      if (method === 'login') {
        if (state.reject) {
          response.end(JSON.stringify({ result: 'fail', message: `${account.username} ${account.password}`, queryString: state.query }));
        } else {
          if (!state.noLoginStateChange) state.online = true;
          response.end('{"result":"success"}');
        }
      } else if (method === 'logout') {
        if (!state.noLogoutStateChange) state.online = false;
        response.end('{"result":"success"}');
      } else {
        response.writeHead(400);
        response.end('No public-key or alternate authentication endpoint in this fixture');
      }
    } else {
      response.writeHead(404);
      response.end('Unknown fixture URL');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const profile = structuredClone(builtin);
  profile.id = `fixture-${builtin.id.slice(8)}-${server.address().port}`;
  profile.homepage = `${origin}/`;
  profile.ruijie.discoveryUrl = profile.homepage;
  profile.ruijie.redirectOrigins = [];
  delete profile.portalDiscovery;
  return { profile, state };
}

test('five campus definitions preserve source service codes, plaintext mode and importable configuration', () => {
  for (const school of schools) {
    const builtin = builtinProfiles.find(profile => profile.id === school.id);
    assert.ok(builtin, `${school.id} must be registered`);
    assert.equal(builtin.author, 'NingMeng123');
    assert.equal(builtin.ruijie.passwordMode, 'plain');
    assert.equal(Object.hasOwn(builtin.ruijie, 'publicKey'), false);
    assert.equal(Object.hasOwn(builtin.ruijie, 'publicKeySource'), false);
    assert.deepEqual(builtin.fields.find(field => field.key === 'service').options.map(option => option.value), school.services);
    assert.deepEqual(profileParameters(builtin), { service: school.defaultService });
    assert.deepEqual(parseProfile(exportProfileJson(builtin)), { ...builtin, id: `${builtin.id.slice(8)}-copy` });
  }
});

test('five campus wire matrix keeps service encoding separate from raw credentials and query encoding', async t => {
  for (const school of schools) {
    await t.test(school.id, async t => {
      const builtin = builtinProfiles.find(profile => profile.id === school.id);
      assert.ok(builtin);
      const { profile, state } = await fixture(t, builtin);
      const serialized = JSON.stringify(profile);
      assert.equal((await runOperation(profile, 'status')).online, false);
      assert.equal(state.calls.some(call => call.method === 'POST'), false);
      for (const service of school.services) {
        const input = { ...account, parameters: { service } };
        const result = await runOperation(profile, 'login', input);
        assert.equal(result.online, true);
        const login = state.calls.filter(call => call.url.searchParams.get('method') === 'login').at(-1);
        const form = new URLSearchParams(login.body);
        assert.deepEqual(Object.fromEntries(form), {
          userId: account.username, password: account.password,
          service: school.serviceEncoding === 'percent' ? encodeURIComponent(service) : service,
          queryString: expectedQuery(query, school.queryEncoding),
          operatorPwd: '', operatorUserId: '', validcode: '', passwordEncrypt: 'false',
        });
        assert.equal(login.method, 'POST');
        assert.equal(login.url.pathname, '/eportal/InterFace.do');
        assert.equal(state.calls.at(-1).url.pathname, '/eportal/success.jsp');
        assert.equal((await runOperation(profile, 'status')).online, true);
        const postCount = state.calls.filter(call => call.method === 'POST').length;
        assert.equal((await runOperation(profile, 'login', input)).online, true);
        assert.equal(state.calls.filter(call => call.method === 'POST').length, postCount);
        assert.equal((await runOperation(profile, 'logout')).online, false);
        const logout = state.calls.filter(call => call.url.searchParams.get('method') === 'logout').at(-1);
        assert.deepEqual([...new URLSearchParams(logout.body)], [['userIndex', 'private-session']]);
        assert.equal(state.calls.at(-1).url.pathname, '/eportal/index.jsp');
      }
      assert.equal(state.calls.some(call => call.url.searchParams.get('method') === 'pageInfo'), false);
      assert.equal(JSON.stringify(profile), serialized);
    });
  }
});

test('UPC query matches the referenced raw POST vector after one form parse, including underscore', async t => {
  const builtin = builtinProfiles.find(profile => profile.id === 'builtin-upc-ruijie');
  assert.ok(builtin);
  const inputQuery = 'wlanuserip=192.0.2.5&ssid=UPC_WLAN&note=a%2Bb~c';
  // Fixed from src/transcode.rs followed by raw body interpolation in portal.rs.
  const upstreamWire = 'queryString=wlanuserip%253D192.0.2.5%2526ssid%253DUPC%255FWLAN%2526note%253Da%25252Bb~c';
  const { profile, state } = await fixture(t, builtin, { query: inputQuery });
  await runOperation(profile, 'login', { ...account, parameters: { service: 'cmcc' } });
  const body = state.calls.find(call => call.url.searchParams.get('method') === 'login').body;
  assert.equal(new URLSearchParams(body).get('queryString'), new URLSearchParams(upstreamWire).get('queryString'));
  assert.match(body, /UPC%255FWLAN/);
  assert.equal(body.includes('UPC%25255F'), false);
});

test('JMU preserves the referenced separator-only raw query encoding with existing percent and plus', async t => {
  const builtin = builtinProfiles.find(profile => profile.id === 'builtin-jmu-ruijie');
  assert.ok(builtin);
  const inputQuery = 'wlanuserip=192.0.2.50&opaque=a%2Bb+c%20d';
  // Linux/ruijie_jmu.sh performs only & and = replacement before curl -d.
  const sourceWire = 'wlanuserip%253D192.0.2.50%2526opaque%253Da%2Bb+c%20d';
  const { profile, state } = await fixture(t, builtin, { query: inputQuery });
  await runOperation(profile, 'login', { ...account, parameters: { service: '电信宽带接入' } });
  const body = state.calls.find(call => call.url.searchParams.get('method') === 'login').body;
  assert.equal(body.split('queryString=')[1].split('&')[0], sourceWire);
  assert.equal(new URLSearchParams(body).get('queryString'), 'wlanuserip%3D192.0.2.50%26opaque%3Da+b c d');
});

test('plaintext campus requests retain independent state verification and redact rejected credentials', async t => {
  const builtin = builtinProfiles.find(profile => profile.id === 'builtin-wtu-ruijie');
  assert.ok(builtin);
  const { profile, state } = await fixture(t, builtin, { noLoginStateChange: true });
  const input = { ...account, parameters: { service: 'DX' } };
  await assert.rejects(runOperation(profile, 'login', input), { code: 'VERIFY_FAILED' });
  state.noLoginStateChange = false;
  await runOperation(profile, 'login', input);
  state.noLogoutStateChange = true;
  await assert.rejects(runOperation(profile, 'logout'), { code: 'VERIFY_FAILED' });
  state.online = false;
  state.reject = true;
  await assert.rejects(runOperation(profile, 'login', input), error => {
    assert.equal(error.code, 'AUTH_REJECTED');
    const diagnostic = JSON.stringify({ message: error.message, requests: error.diagnostics });
    for (const value of [account.username, account.password, query, 'private-session']) assert.equal(diagnostic.includes(value), false, value);
    return true;
  });
});
