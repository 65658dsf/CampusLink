'use strict';

// Builds the user-triggered diagnostics export: application facts, a network
// overview, the active profile, and this session's already-sanitized logs.
// Account names are masked and no password, cookie or MAC value is included,
// so the export can be shared with whoever helps investigate a problem.

const os = require('node:os');

const MAX_REPORT_BYTES = 1024 * 1024;
const DROP_NOTE = '诊断包超过 1 MiB，已省略最早的日志记录。';

function maskAccount(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(text.length - 2, 6))}`;
}

function interfaceSummary(interfaces = os.networkInterfaces()) {
  const rows = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const address of addresses || []) {
      if (address.internal) continue;
      if (address.family !== 'IPv4' && address.family !== 4) continue;
      rows.push(`${name} ${address.address}/${String(address.netmask || '')}`);
    }
  }
  return rows.sort();
}

function buildDiagnosticsReport(snapshot, { platform = process.platform, release = os.release(), interfaces = os.networkInterfaces(), generatedAt = new Date().toISOString() } = {}) {
  const profiles = Array.isArray(snapshot?.profiles) ? snapshot.profiles : [];
  const activeProfile = profiles.find(profile => profile.id === snapshot?.settings?.profileId);
  const report = {
    format: 'campuslink-diagnostics',
    formatVersion: 1,
    generatedAt,
    app: {
      version: snapshot?.app?.version ?? 'unknown',
      packaged: Boolean(snapshot?.app?.packaged),
      platform,
      release,
      secureStorage: Boolean(snapshot?.app?.secureStorage),
      electron: process.versions.electron ?? '',
      node: process.versions.node,
    },
    network: { interfaces: interfaceSummary(interfaces) },
    profile: activeProfile ? {
      id: activeProfile.id,
      name: activeProfile.name,
      protocol: activeProfile.protocol,
      builtin: Boolean(activeProfile.builtin),
      version: activeProfile.version,
    } : null,
    profileCounts: { total: profiles.length, external: profiles.filter(profile => !profile.builtin).length },
    settings: {
      profileId: snapshot?.settings?.profileId ?? '',
      username: maskAccount(snapshot?.settings?.username),
      rememberPassword: Boolean(snapshot?.settings?.rememberPassword),
      autoLaunch: Boolean(snapshot?.settings?.autoLaunch),
      autoConnect: Boolean(snapshot?.settings?.autoConnect),
      autoReconnect: Boolean(snapshot?.settings?.autoReconnect),
      reconnectIntervalSeconds: snapshot?.settings?.reconnectIntervalSeconds,
      minimizeToTray: Boolean(snapshot?.settings?.minimizeToTray),
      parameters: { ...(snapshot?.settings?.parameters || {}) },
    },
    connection: {
      status: snapshot?.connection?.status ?? 'unknown',
      message: String(snapshot?.connection?.message ?? '').slice(0, 300),
      monitoring: Boolean(snapshot?.connection?.monitoring),
      reconnectPaused: Boolean(snapshot?.connection?.reconnectPaused),
      ip: typeof snapshot?.connection?.ip === 'string' ? snapshot.connection.ip : '',
      portalUrl: typeof snapshot?.connection?.portalUrl === 'string' ? snapshot.connection.portalUrl.slice(0, 300) : '',
      since: typeof snapshot?.connection?.since === 'string' ? snapshot.connection.since : '',
      checkedAt: typeof snapshot?.connection?.checkedAt === 'string' ? snapshot.connection.checkedAt : '',
    },
    logs: Array.isArray(snapshot?.logs) ? [...snapshot.logs] : [],
    logsOmitted: 0,
  };
  let text = JSON.stringify(report, null, 2);
  while (Buffer.byteLength(text, 'utf8') > MAX_REPORT_BYTES && report.logs.length) {
    report.logs.pop();
    report.logsOmitted += 1;
    text = JSON.stringify(report, null, 2);
  }
  if (report.logsOmitted) {
    report.note = DROP_NOTE;
    text = JSON.stringify(report, null, 2);
  }
  return text;
}

module.exports = { buildDiagnosticsReport, maskAccount, interfaceSummary, MAX_REPORT_BYTES };
