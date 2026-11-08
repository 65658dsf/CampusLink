'use strict';

// NingMeng123 — school wire facts are independently transcribed from the
// fixed GitHub commits recorded in docs/university-adapters.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { drcomConfigOperation } = require('../electron/drcom-config.cjs');
const { runOperation } = require('../electron/adapters.cjs');
const { builtinProfiles } = require('../electron/profiles.cjs');

const account = { username: 'student+中文{{literal}}', password: 'secret+&/密{{literal}}' };
const schoolCases = [
  {
    "id": "builtin-hnust",
    "school": "湖南科技大学",
    "mode": "v4",
    "accountPrefix": ",0,",
    "operators": [
      {
        "label": "校园网",
        "value": ""
      },
      {
        "label": "中国电信",
        "value": "@telecom"
      },
      {
        "label": "中国移动",
        "value": "@cmcc"
      },
      {
        "label": "中国联通",
        "value": "@unicom"
      }
    ],
    "defaultOperator": "",
    "operator": "@telecom",
    "jsVersion": "4.X",
    "requireIp": true,
    "macMode": "zero",
    "statusMode": "identity",
    "loginFields": [
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "login_method",
        "value": "1"
      },
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      },
      {
        "key": "wlan_user_ip",
        "value": "{{ip}}"
      },
      {
        "key": "wlan_user_ipv6",
        "value": ""
      },
      {
        "key": "wlan_user_mac",
        "value": "000000000000"
      },
      {
        "key": "wlan_ac_ip",
        "value": ""
      },
      {
        "key": "wlan_ac_name",
        "value": ""
      },
      {
        "key": "jsVersion",
        "value": "4.2.1"
      },
      {
        "key": "terminal_type",
        "value": "1"
      },
      {
        "key": "lang",
        "value": "zh-cn"
      },
      {
        "key": "v",
        "value": "4149"
      },
      {
        "key": "lang",
        "value": "zh"
      }
    ],
    "logoutMode": "v4",
    "logoutFields": []
  },
  {
    "id": "builtin-szu",
    "school": "深圳大学",
    "mode": "v4",
    "accountPrefix": ",1,",
    "operators": [],
    "defaultOperator": "",
    "operator": "auto",
    "jsVersion": "4.X",
    "requireIp": false,
    "macMode": "zero",
    "statusMode": "identity",
    "loginFields": [
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "login_method",
        "value": "1"
      },
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      }
    ],
    "logoutMode": "v4",
    "logoutFields": []
  },
  {
    "id": "builtin-yau",
    "school": "延安大学",
    "mode": "v4",
    "accountPrefix": ",0,",
    "operators": [
      {
        "label": "原始账号",
        "value": ""
      },
      {
        "label": "电信",
        "value": "@dx"
      },
      {
        "label": "联通",
        "value": "@lt"
      }
    ],
    "defaultOperator": "",
    "operator": "@dx",
    "jsVersion": "4.X",
    "requireIp": true,
    "macMode": "portal",
    "statusMode": "result",
    "loginFields": [
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "login_method",
        "value": "1"
      },
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      },
      {
        "key": "wlan_user_ip",
        "value": "{{ip}}"
      },
      {
        "key": "wlan_user_ipv6",
        "value": ""
      },
      {
        "key": "wlan_user_mac",
        "value": "{{mac}}"
      },
      {
        "key": "wlan_ac_ip",
        "value": ""
      },
      {
        "key": "wlan_ac_name",
        "value": ""
      },
      {
        "key": "jsVersion",
        "value": "4.2.1"
      },
      {
        "key": "terminal_type",
        "value": "1"
      },
      {
        "key": "v",
        "value": "8000"
      },
      {
        "key": "lang",
        "value": "zh"
      }
    ],
    "statusFields": [
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "jsVersion",
        "value": "4.X"
      },
      {
        "key": "v",
        "value": "8000"
      },
      {
        "key": "lang",
        "value": "zh"
      }
    ],
    "logoutMode": "v4",
    "logoutFields": []
  },
  {
    "id": "builtin-nufe",
    "school": "南京财经大学",
    "mode": "web",
    "accountPrefix": "",
    "operators": [
      {
        "label": "中国移动",
        "value": "@cmcc"
      },
      {
        "label": "中国电信",
        "value": "@njxy"
      }
    ],
    "defaultOperator": "@cmcc",
    "operator": "@njxy",
    "jsVersion": "4.X",
    "requireIp": false,
    "macMode": "zero",
    "statusMode": "result",
    "loginFields": [
      {
        "key": "callback",
        "value": "campusProbe"
      },
      {
        "key": "DDDDD",
        "value": "{{account}}"
      },
      {
        "key": "upass",
        "value": "{{password}}"
      },
      {
        "key": "0MKKey",
        "value": "123456"
      },
      {
        "key": "R1",
        "value": "0"
      },
      {
        "key": "R3",
        "value": "0"
      },
      {
        "key": "R6",
        "value": "0"
      },
      {
        "key": "para",
        "value": "00"
      },
      {
        "key": "v6ip",
        "value": ""
      }
    ],
    "statusFields": [
      {
        "key": "callback",
        "value": "campusProbe"
      }
    ],
    "logoutMode": "drcom",
    "logoutFields": [
      {
        "key": "callback",
        "value": "campusProbe"
      }
    ]
  },
  {
    "id": "builtin-seu",
    "school": "东南大学",
    "mode": "legacy",
    "accountPrefix": ",0,",
    "operators": [],
    "defaultOperator": "",
    "operator": "auto",
    "jsVersion": "4.X",
    "requireIp": true,
    "macMode": "zero",
    "statusMode": "result",
    "loginFields": [
      {
        "key": "c",
        "value": "Portal"
      },
      {
        "key": "a",
        "value": "login"
      },
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "login_method",
        "value": "1"
      },
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      },
      {
        "key": "wlan_user_ip",
        "value": "{{ip}}"
      }
    ],
    "statusFields": [
      {
        "key": "callback",
        "value": "dr1002"
      }
    ],
    "logoutMode": "drcom",
    "logoutFields": [
      {
        "key": "callback",
        "value": "dr1003"
      }
    ]
  },
  {
    "id": "builtin-cpu",
    "school": "中国药科大学",
    "mode": "legacy",
    "accountPrefix": ",0,",
    "operators": [],
    "defaultOperator": "",
    "operator": "auto",
    "jsVersion": "3.3.3",
    "requireIp": true,
    "macMode": "zero",
    "statusMode": "identity",
    "loginFields": [
      {
        "key": "c",
        "value": "Portal"
      },
      {
        "key": "a",
        "value": "login"
      },
      {
        "key": "callback",
        "value": "dr1004"
      },
      {
        "key": "login_method",
        "value": "1"
      },
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      },
      {
        "key": "wlan_user_ip",
        "value": "{{ip}}"
      },
      {
        "key": "wlan_user_ipv6",
        "value": ""
      },
      {
        "key": "wlan_user_mac",
        "value": "000000000000"
      },
      {
        "key": "wlan_ac_ip",
        "value": ""
      },
      {
        "key": "wlan_ac_name",
        "value": ""
      },
      {
        "key": "jsVersion",
        "value": "3.3.3"
      },
      {
        "key": "v",
        "value": "1954"
      }
    ],
    "statusFields": [
      {
        "key": "callback",
        "value": "dr1002"
      }
    ],
    "logoutMode": "drcom",
    "logoutFields": [
      {
        "key": "callback",
        "value": "dr1003"
      },
      {
        "key": "jsVersion",
        "value": "3.3.3"
      }
    ]
  },
  {
    "id": "builtin-ahnu",
    "school": "安徽师范大学",
    "mode": "v4",
    "accountPrefix": "",
    "operators": [
      {
        "label": "中国移动",
        "value": "@cmcc"
      },
      {
        "label": "中国电信",
        "value": "@telecom"
      },
      {
        "label": "中国联通",
        "value": "@unicom"
      },
      {
        "label": "完整账号 / 模式二",
        "value": ""
      }
    ],
    "defaultOperator": "@cmcc",
    "operator": "@unicom",
    "jsVersion": "4.X",
    "requireIp": false,
    "macMode": "zero",
    "statusMode": "identity",
    "loginFields": [
      {
        "key": "user_account",
        "value": "{{account}}"
      },
      {
        "key": "user_password",
        "value": "{{password}}"
      }
    ],
    "logoutMode": "v4",
    "logoutFields": []
  }
];

async function fixture(t, definition, options = {}) {
  const state = { online: false, calls: [], ip: '192.0.2.84', mac: '02-00-00-00-00-99', verifyLogin: true, verifyLogout: true, ...options };
  async function listen(destination) {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      state.calls.push({ destination, url, method: req.method });
      if (url.pathname === '/drcom/chkstatus') {
        res.end(state.statusBody ?? `dr1003(${JSON.stringify({ result: state.online ? 1 : 0, ss5: state.ip, ss4: state.mac, ...(state.online ? { uid: account.username } : {}) })});`);
      } else if (url.pathname === '/' || url.pathname === '/a79.htm') {
        res.end(`<html><!--Dr.COMWebLoginID_${state.online ? 1 : 0}.htm--></html>`);
      } else if (['/drcom/login', '/eportal/portal/login'].includes(url.pathname) || url.pathname === '/eportal/' && url.searchParams.get('a') === 'login') {
        if (state.verifyLogin) state.online = true;
        res.end(state.loginBody ?? 'dr1003({"result":1});');
      } else if (['/drcom/logout', '/eportal/portal/logout'].includes(url.pathname) || url.pathname === '/eportal/' && url.searchParams.get('a') === 'logout') {
        if (state.verifyLogout) state.online = false;
        res.end('dr1003({"result":1});');
      } else {
        res.writeHead(404); res.end('Unknown fixture path');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const homepage = await listen('portal');
  const gateway = await listen('api');
  const profile = {
    id: definition.id, protocol: 'drcom-config', homepage: `${homepage}/`, timeoutMs: 1000,
    drcomConfig: { ...structuredClone(definition), apiPort: Number(new URL(gateway).port), operatorMode: definition.operators.length ? 'suffix' : 'none' },
  };
  return { profile, state, homepage, gateway };
}

for (const definition of schoolCases) {
  test(`${definition.school} sends its explicit login fields and independently verifies status and logout`, async t => {
    const { profile, state, homepage, gateway } = await fixture(t, definition);
    const before = JSON.stringify(profile);
    const context = { ...account, parameters: { operator: definition.operator } };
    assert.equal((await drcomConfigOperation(profile, 'login', context)).online, true);
    const login = state.calls.find(call => call.url.pathname.endsWith('/login') || call.url.searchParams.get('a') === 'login');
    assert.equal(login.url.origin, definition.mode === 'web' ? homepage : gateway);
    assert.deepEqual([...login.url.searchParams.keys()], definition.loginFields.map(field => field.key));
    const operator = definition.operator === 'auto' ? '' : definition.operator;
    const values = { account: definition.accountPrefix + account.username + operator, password: account.password, ip: state.ip, mac: definition.macMode === 'portal' ? '020000000099' : '000000000000' };
    const expected = definition.loginFields.map(({ key, value }) => [key, value.replace(/\{\{(account|password|ip|mac)\}\}/g, (_match, name) => values[name])]);
    assert.deepEqual([...login.url.searchParams], expected);
    if (definition.id === 'builtin-yau') assert.deepEqual(login.url.searchParams.getAll('lang'), ['zh']);
    if (definition.id === 'builtin-hnust') assert.deepEqual(login.url.searchParams.getAll('lang'), ['zh-cn', 'zh']);
    assert.equal((await drcomConfigOperation(profile, 'logout', context)).online, false);
    const logout = state.calls.find(call => call.url.pathname.endsWith('/logout') || call.url.searchParams.get('a') === 'logout');
    assert.equal(logout.url.origin, definition.logoutMode === 'drcom' ? homepage : gateway);
    assert.equal(logout.url.searchParams.has('user_password'), false);
    assert.equal(logout.url.searchParams.has('upass'), false);
    assert.ok(state.calls.every(call => call.method === 'GET' && !call.url.pathname.includes('unbind')));
    assert.ok(state.calls.filter(call => call.url.pathname === '/drcom/chkstatus').every(call => !call.url.searchParams.has('user_account') && !call.url.searchParams.has('DDDDD')));
    if (definition.statusFields) assert.deepEqual([...state.calls[0].url.searchParams.keys()], definition.statusFields.map(field => field.key));
    assert.equal(JSON.stringify(profile), before);
  });
}

test('minimal v4 definitions do not require or invent device, callback or version fields', async t => {
  const definition = schoolCases.find(item => item.id === 'builtin-ahnu');
  const { profile, state } = await fixture(t, definition, { ip: '' });
  assert.equal((await drcomConfigOperation(profile, 'login', { ...account, parameters: { operator: '@unicom' } })).online, true);
  const login = state.calls.find(call => call.url.pathname.endsWith('/login'));
  assert.deepEqual([...login.url.searchParams.keys()], ['user_account', 'user_password']);
});

test('portal MAC is refreshed for each login while zero MAC definitions stay zero', async t => {
  for (const id of ['builtin-yau', 'builtin-hnust']) {
    const definition = schoolCases.find(item => item.id === id);
    const { profile, state } = await fixture(t, definition);
    const context = { ...account, parameters: { operator: definition.operator } };
    await drcomConfigOperation(profile, 'login', context);
    state.online = false; state.ip = '192.0.2.85'; state.mac = '02:00:00:00:00:ab';
    await drcomConfigOperation(profile, 'login', context);
    const logins = state.calls.filter(call => call.url.pathname.endsWith('/login'));
    assert.equal(logins.at(-1).url.searchParams.get('wlan_user_ip'), state.ip);
    assert.equal(logins.at(-1).url.searchParams.get('wlan_user_mac'), id === 'builtin-yau' ? '0200000000ab' : '000000000000');
  }
});

test('declared fields cannot add unknown variables or transmit credentials during status and logout', async t => {
  for (const [key, fields] of [
    ['loginFields', [{ key: 'user_password', value: '{{eval}}' }]],
    ['loginFields', [{ key: 'url', value: 'http://outside.invalid/' }]],
    ['loginFields', [{ key: 'a', value: 'logout' }]],
    ['logoutFields', [{ key: 'user_password', value: '{{password}}' }]],
    ['statusFields', [{ key: 'callback', value: '{{account}}' }]],
    ['statusFields', [{ key: 'user_password', value: 'value' }]],
  ]) {
    const definition = schoolCases.find(item => item.id === 'builtin-hnust');
    const { profile, state } = await fixture(t, definition);
    profile.drcomConfig[key] = fields;
    await assert.rejects(drcomConfigOperation(profile, 'login', account), { code: 'INVALID_PROFILE' });
    assert.equal(state.calls.length, 0);
  }
});

test('accepted responses require a matching independent post-operation status', async t => {
  const definition = schoolCases.find(item => item.id === 'builtin-hnust');
  const { profile, state } = await fixture(t, definition, { verifyLogin: false });
  await assert.rejects(drcomConfigOperation(profile, 'login', account), { code: 'VERIFY_FAILED' });
  state.verifyLogin = true;
  await drcomConfigOperation(profile, 'login', account);
  state.verifyLogout = false;
  await assert.rejects(drcomConfigOperation(profile, 'logout', account), { code: 'VERIFY_FAILED' });
});

test('source-confirmed result status is explicit while identity mode keeps IP-only states unconfirmed', async t => {
  const definition = schoolCases.find(item => item.id === 'builtin-ahnu');
  const { profile, state } = await fixture(t, definition, { statusBody: 'dr1003({"result":1,"ss5":"192.0.2.84"})' });
  assert.equal((await drcomConfigOperation(profile, 'status', {})).online, false, 'The actual fresh page is offline');
  profile.drcomConfig.statusMode = 'result';
  assert.equal((await drcomConfigOperation(profile, 'status', {})).online, true);
  state.statusBody = 'dr1003({"result":"maintenance"})';
  await assert.rejects(drcomConfigOperation(profile, 'status', {}), { code: 'UNKNOWN_RESPONSE' });
});

test('all seven shipped university profiles execute their source-defined fields through runOperation', async t => {
  for (const definition of schoolCases) {
    const shipped = builtinProfiles.find(profile => profile.id === definition.id);
    assert.ok(shipped, `${definition.school} must be present in the shipped catalog`);
    assert.equal(shipped.protocol, 'drcom-config');
    const local = await fixture(t, definition);
    const profile = {
      ...structuredClone(shipped),
      homepage: `${local.homepage}/`,
      drcomConfig: { ...structuredClone(shipped.drcomConfig), apiPort: Number(new URL(local.gateway).port) },
    };
    delete profile.portalDiscovery;
    const context = { ...account, parameters: { operator: definition.operator } };
    assert.equal((await runOperation(profile, 'login', context)).online, true, definition.school);
    const login = local.state.calls.find(call => call.url.pathname.endsWith('/login') || call.url.searchParams.get('a') === 'login');
    const suffix = definition.operator === 'auto' ? '' : definition.operator;
    const variables = { account: definition.accountPrefix + account.username + suffix, password: account.password, ip: local.state.ip, mac: definition.macMode === 'portal' ? '020000000099' : '000000000000' };
    const expected = definition.loginFields.map(({ key, value }) => [key, value.replace(/\{\{(account|password|ip|mac)\}\}/g, (_match, name) => variables[name])]);
    const normalized = fields => fields.map(([key, value]) => [key, key === 'v' && /^\d+$/.test(value) ? '<nonce>' : value]);
    assert.deepEqual(normalized([...login.url.searchParams]), normalized(expected), definition.school);
    assert.equal((await runOperation(profile, 'status', context)).online, true, definition.school);
    assert.equal((await runOperation(profile, 'logout', context)).online, false, definition.school);
    assert.equal(local.state.calls.filter(call => call.url.pathname.endsWith('/login') || call.url.searchParams.get('a') === 'login').length, 1, 'Each school transmits one authentication request');
  }
});
