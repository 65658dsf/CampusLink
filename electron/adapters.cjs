'use strict';

const { request, parseJsonOrJsonp, CampusError } = require('./transport.cjs');
const { createDiagnostic, sanitizeText } = require('./diagnostics.cjs');
const { ruijieOperation } = require('./ruijie.cjs');
const { drcomEportalOperation } = require('./drcom-eportal.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { discoverPortal } = require('./portal-discovery.cjs');

// Only endpoint origins are retained for the lifetime of this process. Device
// query strings and cookies never enter settings, public profiles or the cache.
const discoveredPortals = new Map();
async function resolvePortalProfile(profile, requester) {
  if (!profile.portalDiscovery) return profile;
  const key = JSON.stringify([profile.id, profile.homepage, profile.protocol, profile.portalDiscovery.url]);
  const found = await discoverPortal(profile, requester);
  if (found) {
    if (discoveredPortals.size >= 32) discoveredPortals.delete(discoveredPortals.keys().next().value);
    discoveredPortals.set(key, { homepage: found.homepage, redirectOrigins: found.redirectOrigins });
  }
  const endpoint = found || discoveredPortals.get(key);
  if (!endpoint) return profile;
  return {
    ...profile, homepage: endpoint.homepage,
    ...(profile.protocol === 'drcom-eportal' ? {
      // Keep the configured landing path, but never cache a device query.
      homepage: new URL(new URL(profile.homepage).pathname, endpoint.homepage).href,
      ...(found ? { discoveredEntry: found.entryUrl } : {}),
    } : {}),
    ...(profile.protocol === 'ruijie' ? {
      ruijie: { ...profile.ruijie, discoveryUrl: endpoint.homepage, redirectOrigins: [...new Set([...(profile.ruijie.redirectOrigins || []), ...endpoint.redirectOrigins])] },
      ...(found ? { discoveredEntry: found.entryUrl } : {}),
    } : {}),
  };
}

function renderTemplate(value, variables) {
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key) => String(variables[key] ?? ''));
}
function matches(rule, text, data) {
  if (rule.type === 'text') return text.includes(rule.includes);
  let value = data;
  for (const key of rule.path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = value[key];
  }
  return value === rule.equals;
}
async function genericOperation(profile, operation, context, requester = request) {
  const op = profile.operations[operation];
  if (!op) throw new CampusError(operation === 'status' ? '此连接方案未提供状态查询，请打开认证页确认。' : '此连接方案未提供断开操作，请在认证页注销。', 'UNSUPPORTED_OPERATION');
  const variables = { ip: '', mac: '', acIp: '', acName: '', ...context.parameters, username: context.username || '', password: context.password || '' };
  const values = Object.fromEntries(Object.entries(op.data).map(([key, val]) => [key, renderTemplate(val, variables)]));
  const url = new URL(op.url);
  const options = { method: op.method, headers: { Accept: 'application/json, text/plain, */*', ...op.headers } };
  if (op.method === 'GET') for (const [key, val] of Object.entries(values)) url.searchParams.set(key, val);
  else if (op.encoding === 'json') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(values);
  } else {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(values).toString();
  }
  const text = await requester(url, options, profile.timeoutMs || 10000);
  let data = null;
  if (op.success.type === 'json' || op.failure.type === 'json') {
    try { data = parseJsonOrJsonp(text); } catch { /* A text rule can intentionally match a non-JSON response. */ }
  }
  const success = matches(op.success, text, data);
  const failure = matches(op.failure, text, data);
  if (success && failure) throw new CampusError('成功与失败规则同时匹配，请检查连接方案。', 'AMBIGUOUS_RESPONSE');
  if (success) return { online: operation !== 'logout', message: operation === 'logout' ? '已退出校园网认证。' : '校园网认证成功。' };
  if (failure && operation === 'status') return { online: false, message: '当前尚未通过校园网认证。' };
  if (failure) throw new CampusError(operation === 'login' ? '认证被服务器拒绝，请检查账号、密码和连接参数。' : '注销未成功，请打开认证页确认。', 'AUTH_REJECTED');
  throw new CampusError('响应未匹配成功或失败规则，请检查连接方案。', 'UNKNOWN_RESPONSE');
}

function drcomUrl(profile, path, fields = []) {
  const url = new URL(path, profile.homepage);
  // This gateway parses parameters in the same order as its own JSONP helper.
  // Keep callback first, then business fields (including lang), then metadata.
  // The duplicate lang is intentional and matches the user's successful capture.
  const entries = [['callback', 'dr1003'], ...fields, ['jsVersion', '4.2.1'], ['v', String(Math.floor(Math.random() * 10000 + 500))], ['lang', 'en']];
  url.search = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return url;
}
function drcomResult(data, operation) {
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'result')) throw new CampusError('认证页返回了无法识别的结果，请打开认证页检查。', 'INVALID_RESPONSE');
  const success = data.result === 1 || data.result === '1' || (operation !== 'status' && data.result === 'ok');
  if (success) {
    const rawIp = data.v46ip || data.ss5 || data.v4ip || data.online_ip || data.client_ip || '';
    const ip = typeof rawIp === 'string' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(rawIp) ? rawIp : undefined;
    return { online: operation !== 'logout', ip, message: operation === 'logout' ? '已退出校园网认证。' : '已通过校园网认证。' };
  }
  if (operation === 'status' && (data.result === 0 || data.result === '0')) return { online: false, message: '当前尚未通过校园网认证。' };
  if (operation === 'status') throw new CampusError('暂时无法确认校园网登录状态，请稍后检测或打开认证页。', 'UNKNOWN_RESPONSE');
  // runOperation redacts request credentials from both this message and details.
  const serverMessage = typeof data.msga === 'string' ? data.msga : '';
  const message = operation === 'login' ? '认证失败，请检查校园网账号、密码或账号使用状态。' : '注销未成功，请打开认证页确认。';
  throw new CampusError(serverMessage ? `${message} 服务器提示：${serverMessage.slice(0, 300)}` : message, 'AUTH_REJECTED');
}
function drcomPageStatus(text) {
  // The observed Dr.COM portal identifies its current page with an HTML
  // comment: _1 is the online/logout page, _3 is authentication success, and
  // _2 is authentication failure. Its scripts also contain all of these names
  // as template references, so scanning the entire response would be unsafe.
  if (!/<html(?:\s|>)/i.test(text)) throw new CampusError('暂时无法确认校园网登录状态，请稍后检测或打开认证页。', 'UNKNOWN_RESPONSE');
  const html = text.replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, '');
  const markers = [...html.matchAll(/<!--\s*Dr\.COMWebLoginID_(\d+)\.htm\s*-->/g)];
  if (markers.length !== 1 || !['1', '2', '3'].includes(markers[0][1])) throw new CampusError('暂时无法确认校园网登录状态，请稍后检测或打开认证页。', 'UNKNOWN_RESPONSE');
  const online = markers[0][1] !== '2';
  return { online, message: online ? '已通过校园网认证。' : '当前尚未通过校园网认证。' };
}
async function drcomStatus(profile, requester) {
  const options = { method: 'GET', headers: { Accept: '*/*', Referer: profile.homepage } };
  try {
    const text = await requester(drcomUrl(profile, '/drcom/chkstatus'), options, profile.timeoutMs || 10000);
    return drcomResult(parseJsonOrJsonp(text), 'status');
  } catch (error) {
    if (!(error instanceof CampusError)) throw error;
    // A read-only fresh homepage is an independent status source when the
    // JSONP endpoint is unavailable or returns a portal HTML page instead.
    const homepage = new URL('/', profile.homepage);
    const text = await requester(homepage, options, profile.timeoutMs || 10000);
    return drcomPageStatus(text);
  }
}
async function drcomOperation(profile, operation, context, requester = request) {
  if (operation === 'status') return drcomStatus(profile, requester);
  const fields = [];
  if (operation === 'login') {
    const values = { DDDDD: context.username || '', upass: context.password || '', '0MKKey': '123456', R1: '0', R2: '', R3: context.parameters?.operator ?? '1', R6: '0', para: '00', v6ip: '', terminal_type: '1', lang: 'en' };
    fields.push(...Object.entries(values));
  }
  const url = drcomUrl(profile, `/drcom/${operation}`, fields);
  const text = await requester(url, { method: 'GET', headers: { Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7', Referer: profile.homepage } }, profile.timeoutMs || 10000);
  const badRequest = text.match(/Error code:\s*(\d{3})\s+Bad request(?:\(\d+\))?/i);
  if (badRequest) throw new CampusError(`认证服务器拒绝了请求（${badRequest[0]}），请查看响应详情。`, 'PORTAL_BAD_REQUEST');
  const result = drcomResult(parseJsonOrJsonp(text), operation);
  let verified;
  try { verified = await drcomOperation(profile, 'status', {}, requester); }
  catch { throw new CampusError('认证服务器已接受请求，但暂时无法确认状态，请检查状态或打开认证页。', 'VERIFY_FAILED'); }
  if (verified.online !== (operation === 'login')) throw new CampusError(operation === 'login' ? '认证请求已被接受，但尚未确认在线，请检查状态或打开认证页。' : '注销请求已被接受，但状态仍显示在线，请检查状态或打开认证页。', 'VERIFY_FAILED');
  return { ...result, ip: verified.ip };
}
async function runOperation(profile, operation, context = {}, requester) {
  const diagnostics = [];
  const secrets = [context.username, context.password].filter(value => typeof value === 'string' && value.length);
  const observedRequest = async (url, options, timeout) => {
    for (const value of options.diagnosticSecrets || []) if (typeof value === 'string' && value && !secrets.includes(value)) secrets.push(value);
    const started = Date.now();
    let captured = false;
    const observedOptions = { ...options, diagnosticSecrets: secrets, onDiagnostic: detail => { captured = true; diagnostics.push(detail); } };
    try {
      const transport = requester || (['ruijie', 'drcom-eportal'].includes(profile.protocol) || options.allowRedirect ? portalRequest : request);
      const text = await transport(url, observedOptions, timeout);
      // Custom/mock transports can keep returning text; still provide useful context.
      if (!captured) diagnostics.push(createDiagnostic(url, observedOptions, { responseBody: text, durationMs: Date.now() - started }));
      return text;
    } catch (error) {
      if (!captured) diagnostics.push(createDiagnostic(url, observedOptions, { durationMs: Date.now() - started }));
      throw error;
    }
  };
  try {
    const effectiveProfile = await resolvePortalProfile(profile, observedRequest);
    const adapter = profile.protocol === 'drcom' ? drcomOperation : profile.protocol === 'ruijie' ? ruijieOperation : profile.protocol === 'drcom-eportal' ? drcomEportalOperation : genericOperation;
    const result = await adapter(effectiveProfile, operation, context, observedRequest, value => { if (!secrets.includes(value)) secrets.push(value); });
    return { ...result, portalUrl: new URL(effectiveProfile.homepage).origin + '/' };
  } catch (error) {
    const safeError = error instanceof CampusError ? error : new CampusError('操作未完成，请检查校园网络或打开认证页重试。');
    safeError.message = sanitizeText(safeError.message, secrets);
    // A later discovery response may identify a session token that appeared in
    // an earlier HTML response. Reapply the final secret set before publishing.
    safeError.diagnostics = diagnostics.slice(-6).map(detail => createDiagnostic(detail.url, { method: detail.method, diagnosticSecrets: secrets }, detail));
    throw safeError;
  }
}
module.exports = { runOperation, genericOperation, drcomOperation, renderTemplate, matches, drcomResult, drcomPageStatus };
