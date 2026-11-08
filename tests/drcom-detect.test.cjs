'use strict';

// NingMeng123 — evidence-driven detection fixtures never contact a campus.
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDrcom, parseStatic } = require('../electron/drcom-detect.cjs');

const profile = { homepage: 'http://probe.example.invalid/redirect', portalDiscovery: { url: 'http://probe.example.invalid/redirect' }, timeoutMs: 10000 };
const portal = 'http://portal.example.invalid';
const page = `<html><!--Dr.COMWebLoginID_0.htm--><script>v46ip='192.0.2.50';ss4='aabbccddeeff';vlanid='2';</script>
<script src='/a41.js'></script><form><input name='DDDDD'><input name='upass'></form></html>`;
const script = `var epHTTPPort=803;var enHTTPSPort=804;var enableHttps=0;var page_data_encrypt='0';
var jsVersion='4.2.1';var page={name:'fixture-school',portal_api:'/eportal/portal/',login_method:0};`;
const settings = { login_method: 1, account_prefix: 1, account_suffix: '@telecom', en_md5: 0, enable_r3: 0 };

function fixture(initial = {}) {
  const state = { page, script, settings: { ...settings }, calls: [], ...initial };
  const context = { username: 'NEVER-SEND-ACCOUNT', password: 'NEVER-SEND-PASSWORD', parameters: { portalUrl: `${portal}/a79.htm`, accountPrefix: 'auto', operator: 'auto' } };
  const requester = async (value, options, timeout) => {
    const url = new URL(value);
    state.calls.push({ url, options, timeout });
    assert.equal(options.method, 'GET');
    assert.ok(timeout <= 5000);
    assert.equal(url.href.includes(context.username) || url.href.includes(context.password), false);
    assert.equal(/\/(?:login|logout)$/.test(url.pathname), false);
    assert.equal(['login', 'logout'].includes(url.searchParams.get('a')?.toLowerCase()), false);
    if (url.hostname === 'probe.example.invalid') {
      if (state.probeOnline) { options.onResponse?.({ status: 302, location: 'https://www.msn.com/' }); return ''; }
      options.onResponse?.({ status: 302, location: `${portal}/a79.htm?userip=192.0.2.70&wlanacip=192.0.2.1&wlanacname=Campus` }); return '';
    }
    if (url.pathname === '/a79.htm' || url.pathname === '/') {
      options.onResponse?.({ status: state.pageStatus || 200, location: state.pageRedirect || '' });
      return state.page;
    }
    if (url.pathname === '/a41.js') {
      options.onResponse?.({ status: state.scriptStatus || 200, location: state.scriptRedirect || '' }); return state.script;
    }
    if (url.pathname === '/eportal/portal/page/loadConfig') {
      options.onResponse?.({ status: state.configStatus || 200 });
      return state.configBody ?? `dr1001(${JSON.stringify({ result: 1, data: state.settings })})`;
    }
    if (state.extra?.[url.pathname] !== undefined) { options.onResponse?.({ status: 200 }); return state.extra[url.pathname]; }
    throw new Error(`Unexpected read-only fixture request: ${url.pathname}`);
  };
  return { state, context, requester };
}

test('v4 reads real script port and loadConfig instead of stale HTML authlogin metadata', async () => {
  const { state, context, requester } = fixture({ page: page.replace('</html>', `<script>authloginport=801;authloginpath='/eportal/?c=ACSetting&a=Login';</script></html>`) });
  const result = await detectDrcom(profile, context, requester);
  assert.equal(result.mode, 'v4'); assert.equal(result.apiPort, 803);
  assert.equal(result.accountPrefix, ',0,'); assert.equal(result.defaultOperator, '@telecom');
  assert.equal(result.operatorMode, 'suffix'); assert.equal(result.jsVersion, '4.2.1');
  assert.deepEqual(result.device, { ip: '192.0.2.50', mac: 'aabbccddeeff', acIp: '', acName: '' });
  assert.deepEqual(result.loginParams, { login_method: '1', enable_r3: '0', program_index: 'fixture-school', wlan_vlan_id: '2' });
  const config = state.calls.find(call => call.url.pathname.endsWith('loadConfig'));
  assert.equal(config.url.port, '803');
  assert.equal(config.url.searchParams.get('wlan_user_ip'), Buffer.from('192.0.2.50').toString('base64'));
  assert.equal(state.calls.length, 3);
});

test('automatic detection reuses the safe probe and keeps fresh redirect device context', async () => {
  const { context, requester } = fixture(); context.parameters.portalUrl = '';
  const result = await detectDrcom(profile, context, requester);
  assert.equal(result.homepage, `${portal}/a79.htm`);
  assert.equal(result.device.ip, '192.0.2.70');
  assert.equal(result.device.acIp, '192.0.2.1');
  assert.equal(result.device.acName, 'Campus');
});

test('successful discovery caches only the clean entry and rereads fresh context when the probe becomes online', async () => {
  const { state, context, requester } = fixture(); context.parameters.portalUrl = '';
  const isolated = { ...profile, id: 'cache-success-fixture' };
  const before = JSON.stringify(isolated);
  await detectDrcom(isolated, context, requester);
  state.probeOnline = true;
  state.page = page.replace("v46ip='192.0.2.50'", "v46ip='192.0.2.99'");
  const start = state.calls.length;
  const result = await detectDrcom(isolated, context, requester);
  assert.equal(result.device.ip, '192.0.2.99');
  assert.equal(result.device.acIp, '', 'Previous device/AC query must never be reused');
  assert.equal(result.entryUrl, `${portal}/a79.htm`);
  assert.equal(state.calls[start + 1].url.href, `${portal}/a79.htm`);
  assert.equal(JSON.stringify(isolated), before);
  context.parameters.accountPrefix = 'none';
  await assert.rejects(detectDrcom(isolated, context, requester), { code: 'DRCOM_DETECTION_FAILED' });
});

test('failed identification never populates the online fallback cache', async () => {
  const { state, context, requester } = fixture({ settings: { ...settings, en_md5: 1 } }); context.parameters.portalUrl = '';
  const isolated = { ...profile, id: 'cache-failure-fixture' };
  await assert.rejects(detectDrcom(isolated, context, requester), { code: 'DRCOM_UNSUPPORTED' });
  state.probeOnline = true; state.settings = { ...settings };
  await assert.rejects(detectDrcom(isolated, context, requester), { code: 'DRCOM_DETECTION_FAILED' });
});

test('literal parser ignores comments, quoted instructions, regexes and runtime/default assignments', () => {
  const parsed = parseStatic(`// epHTTPPort=9999;
var note="epHTTPPort=9998";var re=/{ epHTTPPort=9997; }/g;
function later(){epHTTPPort=9996;}var page={login_method:0};
if (false) epHTTPPort=9995; if(false) var epHTTPPort=9994;
foo.epHTTPPort=9993;for(var epHTTPPort=9992;false;){};
if(false) other=1,epHTTPPort=9991;
if(false) config={en_md5:1,login_method:9};foo.config={en_md5:2,login_method:9};
if(false) var page={name:'conditional-program'};
var epHTTPPort=803;var config={login_method:1,en_md5:0};`);
  assert.deepEqual([...parsed.values.get('httpPort')], ['803']);
  assert.deepEqual([...parsed.values.get('loginMethod')], ['1']);
  assert.deepEqual([...parsed.values.get('md5')], ['0']);
  assert.equal(parsed.values.has('programIndex'), false);
  assert.equal(parsed.values.has('note'), false);
});

test('loadConfig overrides static defaults while conflicting protocol ports fail without requests', async () => {
  const { context, requester } = fixture({ script: `${script}var login_method=0;var account_prefix=0;var account_suffix='';` });
  const result = await detectDrcom(profile, context, requester);
  assert.equal(result.mode, 'v4'); assert.equal(result.accountPrefix, ',0,');
  const bad = fixture({ script: `${script}var epHTTPPort=802;` });
  await assert.rejects(detectDrcom(profile, bad.context, bad.requester), { code: 'DRCOM_DETECTION_FAILED' });
  assert.equal(bad.state.calls.some(call => call.url.pathname.endsWith('loadConfig')), false);
});

test('unsupported encoding, captcha and advanced flags cannot be bypassed by overrides', async () => {
  for (const key of ['en_md5', 'custom_perceive', 'no_filter_accandpwd', 'password_cut', 'enable_captcha', 'check_online_method']) {
    const current = fixture({ settings: { ...settings, [key]: 1 } });
    current.context.parameters.apiPort = '801'; current.context.parameters.accountPrefix = ',1,';
    await assert.rejects(detectDrcom(profile, current.context, current.requester), { code: 'DRCOM_UNSUPPORTED' });
  }
  for (const assignment of ["page_data_encrypt='1'", "apg_switch='1'", "port_mode='1'"]) {
    const current = fixture({ script: `${script.replace("var page_data_encrypt='0';", '')}var ${assignment};` });
    await assert.rejects(detectDrcom(profile, current.context, current.requester), { code: 'DRCOM_UNSUPPORTED' });
    assert.equal(current.state.calls.some(call => call.url.pathname.endsWith('loadConfig')), false);
  }
  const captcha = fixture({ page: page.replace('</form>', '<input name="captcha"></form>') });
  await assert.rejects(detectDrcom(profile, captcha.context, captcha.requester), { code: 'DRCOM_UNSUPPORTED' });
});

test('manual ports and prefixes fill explicit missing information without guessing', async () => {
  const current = fixture({ script: script.replace('var epHTTPPort=803;', ''), settings: { ...settings, account_prefix: undefined } });
  await assert.rejects(detectDrcom(profile, current.context, current.requester), { code: 'DRCOM_DETECTION_FAILED' });
  current.context.parameters.apiPort = '801'; current.context.parameters.accountPrefix = 'none';
  const result = await detectDrcom(profile, current.context, current.requester);
  assert.equal(result.apiPort, 801); assert.equal(result.accountPrefix, '');
});

test('explicit carrier selection can proceed without an invented default suffix', async () => {
  const current = fixture({ settings: { ...settings, account_suffix: undefined },
    page: page.replace('</form>', '<select name="ISP_select"><option value="@dx">中国电信</option><option value="@lt">中国联通</option></select></form>') });
  const automatic = await detectDrcom(profile, current.context, current.requester);
  assert.equal(automatic.defaultOperator, null, 'Unknown defaults stay unknown for the login adapter');
  current.context.parameters.operator = 'telecom';
  const detected = await detectDrcom(profile, current.context, current.requester);
  assert.equal(detected.defaultOperator, null);
  assert.deepEqual(detected.suffixes.map(option => option.value), ['@dx', '@lt']);
});

test('unknown R3 mode and inconsistent success fields are not silently accepted', async () => {
  for (const initial of [
    { settings: { ...settings, enable_r3: undefined } },
    { configBody: JSON.stringify({ code: 1, result: 0, data: settings }) },
    { configBody: JSON.stringify({ code: 0, result: 1, data: settings }) },
  ]) {
    const current = fixture(initial);
    await assert.rejects(detectDrcom(profile, current.context, current.requester), { code: 'DRCOM_DETECTION_FAILED' });
  }
});

test('legacy literal configuration uses explicit older Portal endpoint and selected suffix', async () => {
  const current = fixture({ script: `var epHTTPPort=801;var jsVersion='3.3.3';var config={loginMethod:1,accountPrefix:1,accountSuffix:'',enMd5:0,enableR3:0};var endpoint='/eportal/?c=Portal&a=login';`,
    page: page.replace('</form>', '<select name="ISP_select"><option value="">校园网</option><option value="@dx" selected>中国电信</option></select></form>') });
  const result = await detectDrcom(profile, current.context, current.requester);
  assert.equal(result.mode, 'legacy'); assert.equal(result.apiPort, 801); assert.equal(result.accountPrefix, ',0,');
  assert.equal(result.defaultOperator, '@dx'); assert.deepEqual(result.suffixes, [{ label: '校园网', value: '' }, { label: '中国电信', value: '@dx' }]);
  assert.equal(current.state.calls.some(call => call.url.pathname.endsWith('loadConfig')), false);
});

test('local Web method zero uses R3 selection and no account prefix', async () => {
  const current = fixture({ script: `var jsVersion='4.2.1';var config={login_method:0,en_md5:0,enable_r3:1,account_prefix:1};`,
    page: page.replace('</form>', '<label><input type="radio" name="R3" value="1" checked>校园网</label></form>') });
  const result = await detectDrcom(profile, current.context, current.requester);
  assert.equal(result.mode, 'web'); assert.equal(result.apiPort, 80); assert.equal(result.accountPrefix, '');
  assert.equal(result.operatorMode, 'r3'); assert.equal(result.defaultOperator, '1');
});

test('online Web pages without operator controls retain protocol for status and logout', async () => {
  const current = fixture({ script: `var jsVersion='4.2.1';var config={login_method:0,en_md5:0,enable_r3:1};`,
    page: '<html><!--Dr.COMWebLoginID_1.htm--><script src="/a41.js"></script>Online</html>' });
  const result = await detectDrcom(profile, current.context, current.requester);
  assert.equal(result.mode, 'web');
  assert.equal(result.operatorMode, 'r3');
  assert.equal(result.defaultOperator, null);
  assert.deepEqual(result.suffixes, []);
});

test('discovery never follows action, credential or cross-origin entry redirects', async () => {
  for (const target of [`${portal}/drcom/login`, `${portal}/F.htm`, `${portal}/eportal/?c=ACSetting&a=Login`, `${portal}/a79.htm?user_password=secret`,
    `${portal}/eportal/portal/mac/unbind`, `${portal}/eportal/portal/new-action`, `${portal}/a79.htm?action=kick`, 'http://elsewhere.example.invalid/']) {
    const current = fixture({ pageStatus: 302, pageRedirect: target });
    await assert.rejects(detectDrcom(profile, current.context, current.requester), { code: 'DRCOM_DETECTION_FAILED' });
    assert.equal(current.state.calls.length, 1);
  }
});

test('cross-origin scripts are not fetched and script redirects/HTTP errors are not parsed', async () => {
  const current = fixture({ page: page.replace('</html>', '<script src="http://elsewhere.example.invalid/evil.js"></script></html>') });
  await detectDrcom(profile, current.context, current.requester);
  assert.ok(current.state.calls.every(call => call.url.hostname === 'portal.example.invalid'));
  for (const status of [302, 403, 503]) {
    const bad = fixture({ scriptStatus: status, scriptRedirect: 'http://elsewhere.example.invalid/evil.js' });
    await assert.rejects(detectDrcom(profile, bad.context, bad.requester), { code: 'DRCOM_DETECTION_FAILED' });
    assert.equal(bad.state.calls.length, 2);
  }
});

test('unknown HTML, unsupported configuration, missing password mode and script expressions remain unconfirmed', async () => {
  for (const change of [
    { page: '<html>Network is available</html>' },
    { settings: { ...settings, login_method: 14 } },
    { settings: { ...settings, en_md5: undefined } },
    { configBody: 'dr1001({"code":0,"data":{"login_method":1}})' },
    { configBody: '<script>doLogin()</script>' },
    { script: script.replace('var epHTTPPort=803;', 'var epHTTPPort=getPort();') },
  ]) {
    const current = fixture(change);
    await assert.rejects(detectDrcom(profile, current.context, current.requester), error => ['DRCOM_DETECTION_FAILED', 'DRCOM_UNSUPPORTED', 'INVALID_RESPONSE'].includes(error.code));
  }
});

test('read budget prevents oversized responses and excessive script chains', async () => {
  const huge = fixture({ script: ' '.repeat(2 * 1024 * 1024) });
  await assert.rejects(detectDrcom(profile, huge.context, huge.requester), { code: 'DRCOM_DETECTION_FAILED' });
  const links = Array.from({ length: 9 }, (_, i) => `<script src="/extra${i}.js"></script>`).join('');
  const extra = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`/extra${i}.js`, 'var harmless=0;']));
  const many = fixture({ page: page.replace('</html>', `${links}</html>`), extra });
  await assert.rejects(detectDrcom(profile, many.context, many.requester), { code: 'DRCOM_DETECTION_FAILED' });
  assert.ok(many.state.calls.length <= 9);
});
