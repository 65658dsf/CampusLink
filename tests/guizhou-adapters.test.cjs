'use strict';

// NingMeng123 — source-backed Guizhou profiles use the normal application entry points.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinProfiles, parseProfile, exportProfileJson, profileParameters } = require('../electron/profiles.cjs');
const { CampusService } = require('../electron/service.cjs');
const { runOperation } = require('../electron/adapters.cjs');
const sources = require('../docs/guizhou-sources.json');

const ids = ['builtin-gzqy', 'builtin-gznu-sangfor', 'builtin-gzmu-drcom-auto'];

test('Guizhou retains the existing school and restores both source-backed additions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-guizhou-'));
  const services = [];
  const create = () => {
    const service = new CampusService({ directory, operation: async () => { throw new Error('Catalog operations must not authenticate'); } });
    services.push(service);
    return service;
  };
  t.after(() => {
    services.forEach(service => service.dispose());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let service = create();
  assert.equal(builtinProfiles.length, 29);
  assert.deepEqual(sources.integrated.map(school => school.id), ids);
  assert.equal(sources.schools.length, 80);
  assert.equal(new Set(sources.schools.map(school => school.schoolCode)).size, 80);
  assert.ok(sources.schools.every(school => school.queries.length > 0));
  for (const id of ids) {
    const profile = builtinProfiles.find(item => item.id === id);
    assert.ok(profile, id);
    assert.equal(profile.author, 'NingMeng123');
    const text = exportProfileJson(profile);
    const copy = parseProfile(text);
    assert.deepEqual({ ...copy, id }, profile);
    service.importProfile(text);
    service.saveSettings({ profileId: copy.id });
    service.dispose();
    service = create();
    assert.deepEqual(service.profile(), copy);
    assert.deepEqual(service.settings.parameters, profileParameters(profile));
  }
  assert.equal(service.externalProfiles.length, ids.length);
});

test('Guizhou Minzu reads the current DrCOM portal before choosing the wire dialect and carrier', async () => {
  const profile = builtinProfiles.find(item => item.id === 'builtin-gzmu-drcom-auto');
  const context = {
    username: 'synthetic-student', password: 'synthetic+password&',
    parameters: profileParameters(profile, { portalUrl: 'http://portal.example.invalid/a79.htm', operator: 'cmcc' }),
  };
  const calls = [];
  let online = false;
  // Synthetic portal data, not a captured Guizhou page. The script confirms
  // form names and carrier values, while current wire configuration is read.
  const requester = async (value, options) => {
    const url = new URL(value);
    calls.push({ url, options });
    assert.equal(url.origin, 'http://portal.example.invalid');
    if (url.pathname === '/a79.htm') return `<html><!--Dr.COMWebLoginID_${online ? 1 : 0}.htm-->
      <input name="DDDDD"><input name="upass"><input type="radio" name="network" value="@xyw">办公网
      <input type="radio" name="network" value="" checked>学生内网
      <input type="radio" name="network" value="@yd">中国移动
      <input type="radio" name="network" value="@lt">按当前页面显示的服务
      <script>var login_method=0;var en_md5=0;var enable_r3=0;var jsVersion='4.2.1';</script></html>`;
    if (url.pathname === '/drcom/chkstatus') return `dr1003(${JSON.stringify(online ? { result: 1, uid: context.username, v46ip: '192.0.2.80' } : { result: 0 })})`;
    if (url.pathname === '/drcom/login') {
      online = true;
      return 'dr1003({"result":1})';
    }
    if (url.pathname === '/drcom/logout') {
      online = false;
      return 'dr1003({"result":1})';
    }
    throw new Error(`Unexpected synthetic request ${url.pathname}`);
  };
  assert.equal((await runOperation(profile, 'login', context, requester)).online, true);
  const login = calls.find(call => call.url.pathname === '/drcom/login');
  assert.equal(login.url.searchParams.get('DDDDD'), `${context.username}@yd`);
  assert.equal(login.url.searchParams.get('upass'), context.password);
  assert.equal(login.url.searchParams.get('R3'), '0');
  assert.equal(calls.at(-1).url.pathname, '/drcom/chkstatus');
  assert.equal((await runOperation(profile, 'status', context, requester)).online, true);
  assert.equal((await runOperation(profile, 'logout', context, requester)).online, false);
  const logout = calls.find(call => call.url.pathname === '/drcom/logout');
  assert.equal(logout.url.searchParams.has('DDDDD'), false);
  assert.equal(logout.url.searchParams.has('upass'), false);
  assert.equal(calls.at(-1).url.pathname, '/drcom/chkstatus');
  for (const [operator, suffix] of [['campus', ''], ['office', '@xyw']]) {
    context.parameters.operator = operator;
    assert.equal((await runOperation(profile, 'login', context, requester)).online, true);
    const request = calls.filter(call => call.url.pathname === '/drcom/login').at(-1);
    assert.equal(request.url.searchParams.get('DDDDD'), `${context.username}${suffix}`);
    assert.equal((await runOperation(profile, 'logout', context, requester)).online, false);
  }
});
