'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnosticsReport, maskAccount, interfaceSummary, MAX_REPORT_BYTES } = require('../electron/diagnostics-export.cjs');

const snapshot = () => ({
  settings: { profileId: 'builtin-demo', username: '202312345678', rememberPassword: true, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 30, minimizeToTray: true, parameters: { operator: '1' } },
  hasPassword: true,
  profiles: [{ id: 'builtin-demo', name: '示例大学', protocol: 'http', builtin: true, version: '1.0.0' }],
  connection: { status: 'connected', message: 'ok', monitoring: true, reconnectPaused: false, ip: '10.1.2.3', portalUrl: 'http://10.1.2.1/' },
  logs: [{ id: 'l1', time: '2026-10-16T00:00:00.000Z', level: 'error', message: '认证失败', details: { code: 'AUTH_REJECTED', requests: [{ method: 'POST', url: 'http://10.1.2.1/login', durationMs: 12, responseBody: 'Bad request(2)', truncated: false }] } }],
  app: { version: '1.1.1', platform: 'win32', packaged: false, secureStorage: true },
});

test('accounts are masked and never appear in exported text', () => {
  assert.equal(maskAccount('202312345678'), '20******');
  assert.equal(maskAccount('ab'), '**');
  assert.equal(maskAccount(' a '), '*');
  assert.equal(maskAccount(''), '');
  assert.equal(maskAccount(undefined), '');
  const text = buildDiagnosticsReport(snapshot(), { interfaces: {}, generatedAt: '2026-10-16T00:00:00.000Z' });
  assert.equal(text.includes('202312345678'), false);
  assert.equal(JSON.parse(text).settings.username, '20******');
});

test('the report carries app facts, network overview, profile and sanitized logs', () => {
  const report = JSON.parse(buildDiagnosticsReport(snapshot(), {
    interfaces: { Ethernet: [{ family: 'IPv4', address: '192.168.1.9', netmask: '255.255.255.0', internal: false }] },
    platform: 'win32', release: '10.0.26100', generatedAt: '2026-10-16T00:00:00.000Z',
  }));
  assert.equal(report.format, 'campuslink-diagnostics');
  assert.equal(report.formatVersion, 1);
  assert.equal(report.app.version, '1.1.1');
  assert.deepEqual(report.network.interfaces, ['Ethernet 192.168.1.9/255.255.255.0']);
  assert.equal(report.profile.name, '示例大学');
  assert.deepEqual(report.profileCounts, { total: 1, external: 0 });
  assert.equal(report.connection.status, 'connected');
  assert.equal(report.connection.ip, '10.1.2.3');
  assert.equal(report.logs.length, 1);
  assert.equal(report.logsOmitted, 0);
  assert.deepEqual(report.settings.parameters, { operator: '[已隐藏]' });
});

test('exports sanitize raw log echoes, device fields and URL credentials at the boundary', () => {
  const value = snapshot();
  const account = value.settings.username;
  const mac = 'A0:01:02:03:04:05';
  const token = 'private-session-token';
  value.settings.parameters = { mac, access_token: token, extraField: 'private-custom-value' };
  value.connection.message = `Denied ${account} ${encodeURIComponent(token)} ${mac}`;
  value.connection.portalUrl = `http://portal-user:portal-pass@10.1.2.1/eportal/index.jsp?token=${token}&mac=${mac}#private-fragment`;
  value.logs = [{
    id: 'raw-log', time: '2026-10-16T00:00:00.000Z', level: 'warning',
    message: `${account} ${Buffer.from(account).toString('base64')} ${token} 0011.2233.4455 aabbccddeeff`,
    password: 'unexpected-private-property',
    details: { code: 'AUTH_REJECTED', cookie: 'unexpected-cookie-property', requests: [{
      method: 'POST', url: `http://log-user:log-pass@10.1.2.1/login?sessionid=log-session#fragment`,
      responseBody: `student=${account} token="${token}"\nSet-Cookie: sid=server-cookie; Path=/\nmac=${mac}`,
      status: 403, statusText: token, contentType: 'text/html', durationMs: 1,
    }] },
  }];
  const text = buildDiagnosticsReport(value, { interfaces: {} });
  for (const secret of [account, Buffer.from(account).toString('base64'), mac, token, 'private-custom-value', 'portal-user', 'portal-pass', 'private-fragment', '0011.2233.4455', 'aabbccddeeff', 'unexpected-private-property', 'unexpected-cookie-property', 'log-user', 'log-pass', 'log-session', 'server-cookie']) {
    assert.equal(text.includes(secret), false, secret);
  }
  const report = JSON.parse(text);
  assert.equal(report.connection.portalUrl, 'http://10.1.2.1/eportal/index.jsp');
  assert.equal(report.logs[0].details.requests[0].url, 'http://10.1.2.1/login');
  assert.equal(report.logs[0].details.requests[0].status, 403);
  assert.deepEqual(report.settings.parameters, { mac: '[已隐藏]', access_token: '[已隐藏]', extraField: '[已隐藏]' });
  assert.equal(value.logs[0].details.requests[0].statusText, token, 'export must not mutate the in-memory log');
});

test('invalid portal URLs are omitted without copying their source text', () => {
  const value = snapshot();
  value.connection.portalUrl = 'javascript:private-url-secret';
  const text = buildDiagnosticsReport(value, { interfaces: {} });
  assert.equal(text.includes('private-url-secret'), false);
  assert.equal(JSON.parse(text).connection.portalUrl, '[无效地址]');
});

test('oversized exports drop the oldest logs first and stay valid JSON', () => {
  const value = snapshot();
  const big = 'x'.repeat(16000);
  for (let index = 0; index < 80; index++) value.logs.push({ id: `big-${index}`, time: '2026-10-16T00:00:00.000Z', level: 'info', message: big });
  const text = buildDiagnosticsReport(value, { interfaces: {} });
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_REPORT_BYTES);
  const report = JSON.parse(text);
  assert.ok(report.logsOmitted > 0);
  assert.ok(report.logs.length < value.logs.length);
  assert.equal(typeof report.note, 'string');
});

test('the omission note is included in the final one MiB budget', () => {
  const value = snapshot();
  value.logs = [{ id: 'latest', time: '', level: 'info', message: '' }];
  const options = { interfaces: {}, generatedAt: '2026-10-16T00:00:00.000Z' };
  const overhead = Buffer.byteLength(buildDiagnosticsReport(value, options));
  value.logs[0].message = 'x'.repeat(MAX_REPORT_BYTES - overhead - 20);
  value.logs.push({ id: 'oldest', time: '', level: 'info', message: 'y'.repeat(200) });
  const text = buildDiagnosticsReport(value, options);
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_REPORT_BYTES);
  assert.ok(JSON.parse(text).logsOmitted > 0);
});

test('interfaceSummary ignores loopback and non-IPv4 entries and sorts rows', () => {
  const rows = interfaceSummary({
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'Wi-Fi': [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.0.2', netmask: '255.255.255.0', internal: false }],
    Ethernet: [{ family: 4, address: '10.0.0.5', netmask: '255.0.0.0', internal: false }],
  });
  assert.deepEqual(rows, ['Ethernet 10.0.0.5/255.0.0.0', 'Wi-Fi 192.168.0.2/255.255.255.0']);
});
