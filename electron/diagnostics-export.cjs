'use strict';

// NingMeng123 — user-triggered diagnostics export: application facts, a network
// overview, the active profile, and this session's logs, sanitized again at
// the export boundary so a new logging call cannot accidentally share secrets.
// Account names are masked and no password, cookie or MAC value is included,
// so the export can be shared with whoever helps investigate a problem.

const os = require('node:os');
const { collectSecrets, createDiagnostic, sanitizeText } = require('./diagnostics.cjs');

const MAX_REPORT_BYTES = 1024 * 1024;
const DROP_NOTE = '诊断包超过 1 MiB，已省略最早的日志记录。';
const REDACTED = '[已隐藏]';
const MAC_ADDRESS = /\b(?:(?:[a-f\d]{2}[:-]){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4}|[a-f\d]{12})\b/gi;

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
  const parameters = snapshot?.settings?.parameters || {};
  const logs = Array.isArray(snapshot?.logs) ? snapshot.logs : [];
  const urls = [snapshot?.connection?.portalUrl, ...logs.flatMap(entry => Array.isArray(entry?.details?.requests) ? entry.details.requests.map(request => request?.url) : [])];
  const secrets = [...new Set([
    snapshot?.settings?.username,
    ...collectSecrets('http://diagnostics.invalid/', { body: parameters }),
    ...urls.flatMap(url => collectSecrets(url)),
  ].filter(value => typeof value === 'string' && value))];
  const redact = value => sanitizeText(value, secrets).replace(MAC_ADDRESS, REDACTED);
  const safeUrl = value => {
    if (typeof value !== 'string' || !value) return '';
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '[无效地址]';
      return redact(`${parsed.origin}${parsed.pathname}`);
    } catch { return '[无效地址]'; }
  };
  const safeLogs = logs.map(entry => ({
    id: redact(entry?.id),
    time: redact(entry?.time),
    level: redact(entry?.level),
    message: redact(entry?.message),
    ...(entry?.details ? { details: {
      code: redact(entry.details.code),
      requests: Array.isArray(entry.details.requests) ? entry.details.requests.map(request => {
        const detail = createDiagnostic(request?.url, { method: request?.method, diagnosticSecrets: secrets }, request || {});
        return { ...detail, url: safeUrl(request?.url), responseBody: redact(detail.responseBody), ...(detail.statusText ? { statusText: redact(detail.statusText) } : {}), ...(detail.contentType ? { contentType: redact(detail.contentType) } : {}) };
      }) : [],
    } } : {}),
  }));
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
    network: { interfaces: interfaceSummary(interfaces).map(redact) },
    profile: activeProfile ? {
      id: redact(activeProfile.id),
      name: redact(activeProfile.name),
      protocol: activeProfile.protocol,
      builtin: Boolean(activeProfile.builtin),
      version: redact(activeProfile.version),
    } : null,
    profileCounts: { total: profiles.length, external: profiles.filter(profile => !profile.builtin).length },
    settings: {
      profileId: redact(snapshot?.settings?.profileId),
      username: maskAccount(snapshot?.settings?.username),
      rememberPassword: Boolean(snapshot?.settings?.rememberPassword),
      autoLaunch: Boolean(snapshot?.settings?.autoLaunch),
      autoConnect: Boolean(snapshot?.settings?.autoConnect),
      autoReconnect: Boolean(snapshot?.settings?.autoReconnect),
      reconnectIntervalSeconds: snapshot?.settings?.reconnectIntervalSeconds,
      minimizeToTray: Boolean(snapshot?.settings?.minimizeToTray),
      // Imported fields may contain a device identifier or a second secret;
      // their names are useful for support, but their values are unnecessary.
      parameters: Object.fromEntries(Object.keys(parameters).map(key => [key, REDACTED])),
    },
    connection: {
      status: snapshot?.connection?.status ?? 'unknown',
      message: redact(snapshot?.connection?.message).slice(0, 300),
      monitoring: Boolean(snapshot?.connection?.monitoring),
      reconnectPaused: Boolean(snapshot?.connection?.reconnectPaused),
      ip: typeof snapshot?.connection?.ip === 'string' ? snapshot.connection.ip : '',
      portalUrl: safeUrl(snapshot?.connection?.portalUrl).slice(0, 300),
      since: typeof snapshot?.connection?.since === 'string' ? snapshot.connection.since : '',
      checkedAt: typeof snapshot?.connection?.checkedAt === 'string' ? snapshot.connection.checkedAt : '',
    },
    logs: safeLogs,
    logsOmitted: 0,
  };
  let text = JSON.stringify(report, null, 2);
  while (Buffer.byteLength(text, 'utf8') > MAX_REPORT_BYTES && report.logs.length) {
    report.logs.pop();
    report.logsOmitted += 1;
    report.note = DROP_NOTE;
    text = JSON.stringify(report, null, 2);
  }
  return text;
}

module.exports = { buildDiagnosticsReport, maskAccount, interfaceSummary, MAX_REPORT_BYTES };
