'use strict';

// NingMeng123 — independently implemented from the documented JCU wire fields.
// No portal JavaScript or third-party automation script is executed.
const { isIP } = require('node:net');
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { htmlTarget } = require('./ruijie.cjs');

const MAX_HOPS = 6;
const PRIVATE_QUERY = /^(?:username|user|userid|useraccount|userpassword|account|accountname|accountid|loginname|ddddd|upass|password|passwd|pwd|token|accesstoken|refreshtoken|secret|authorization|cookie|credential|credentials)$/i;

function entryUrl(value, base, origin) {
  let url;
  try { url = new URL(value, base); } catch { throw new CampusError('Dr.COM 认证页返回了无效地址。', 'PORTAL_REDIRECT'); }
  if (url.href.length > 20000 || url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /[\u0000-\u0020]/.test(String(value))) throw new CampusError('Dr.COM 认证页跳转到了未允许的地址，请核对认证入口。', 'PORTAL_REDIRECT');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new CampusError('Dr.COM 认证页返回了无效地址。', 'PORTAL_REDIRECT'); }
  const actionPath = /\/(?:login|logout|logoff|disconnect)(?:\/|\.|$)/i.test(pathname) || /^\/F\.htm$/i.test(pathname);
  const actionQuery = [...url.searchParams].some(([key, val]) => PRIVATE_QUERY.test(key.replace(/[^a-z0-9]/gi, '')) || /^(?:a|action|method)$/i.test(key) && /^(?:login|logout|logoff|disconnect)$/i.test(val));
  if (actionPath || actionQuery) throw new CampusError('认证页发现过程不允许访问登录或注销操作地址。', 'PORTAL_REDIRECT');
  return url;
}

function pageHtml(body) {
  return String(body).replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, '');
}

function pageStatus(body) {
  const html = pageHtml(body);
  if (!/<html(?:\s|>)/i.test(html)) throw new CampusError('无法识别 Dr.COM 在线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  const markers = [...html.matchAll(/<!--\s*Dr\.COMWebLoginID_(\d+)\.htm\s*-->/g)];
  if (markers.length !== 1 || !['0', '1', '2', '3'].includes(markers[0][1])) throw new CampusError('无法识别 Dr.COM 在线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  return statusResult(['1', '3'].includes(markers[0][1]));
}

function isLoginPage(body) {
  const html = pageHtml(body);
  return /<html(?:\s|>)/i.test(html) && ['DDDDD', 'upass'].every(name => new RegExp(`<input\\b[^<>]*(?:name|id)\\s*=\\s*["']?${name}(?:["'\\s>])`, 'i').test(html));
}

function statusResult(online, data = {}) {
  const rawIp = data.v46ip || data.ss5 || data.v4ip || data.online_ip || data.client_ip;
  return { online, ...(typeof rawIp === 'string' && isIP(rawIp) ? { ip: rawIp } : {}), message: online ? '已通过校园网认证。' : '当前尚未通过校园网认证。' };
}

function apiUrl(homepage, pathname, entries = []) {
  const url = new URL(pathname, homepage);
  // encodeURIComponent matches the portal's query-value encoding, including
  // literal '+' in credentials and '%20' for spaces.
  url.search = entries.map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`).join('&');
  return url;
}

function resultAccepted(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CampusError('Dr.COM 认证响应无法识别。', 'INVALID_RESPONSE');
  const flags = [];
  if (Object.hasOwn(data, 'result')) {
    if ([1, '1', 'ok'].includes(data.result)) flags.push(true);
    else if ([0, '0', 'fail', 'failed', 'error'].includes(data.result)) flags.push(false);
    else throw new CampusError('Dr.COM 认证响应缺少可确认的结果。', 'UNKNOWN_RESPONSE');
  }
  for (const key of ['resCode', 'rescode']) {
    if (!Object.hasOwn(data, key)) continue;
    if (!(typeof data[key] === 'number' && Number.isFinite(data[key])) && !(typeof data[key] === 'string' && /^-?\d+$/.test(data[key]))) throw new CampusError('Dr.COM 认证响应缺少可确认的结果。', 'UNKNOWN_RESPONSE');
    flags.push(Number(data[key]) === 0);
  }
  if (!flags.length) throw new CampusError('Dr.COM 认证响应缺少可确认的结果。', 'UNKNOWN_RESPONSE');
  if (flags.includes(true) && flags.includes(false)) throw new CampusError('Dr.COM 认证响应的结果相互矛盾。', 'AMBIGUOUS_RESPONSE');
  return flags[0];
}

async function drcomEportalOperation(profile, operation, context = {}, requester = portalRequest, registerSecret = () => {}) {
  if (!['login', 'logout', 'status'].includes(operation)) throw new CampusError('不支持的 Dr.COM ePortal 操作。', 'UNSUPPORTED_OPERATION');
  const origin = new URL(profile.homepage).origin;
  const secrets = [];
  const remember = value => { if (typeof value === 'string' && value && !secrets.includes(value)) { secrets.push(value); registerSecret(value); } };
  remember(context.username); remember(context.password);

  async function send(url, options = {}) {
    let metadata = { status: 200, location: '' };
    try {
      const body = await requester(url, {
        method: 'GET', ...options,
        headers: { Accept: '*/*', 'Cache-Control': 'no-cache', Referer: profile.homepage, ...options.headers },
        diagnosticSecrets: secrets,
        onResponse: value => { metadata = value; },
      }, profile.timeoutMs || 10000);
      if (metadata.status >= 300 && metadata.status < 400 && options.allowRedirect !== true) throw new CampusError('Dr.COM 接口返回了未允许的跳转。', 'PORTAL_REDIRECT');
      if (metadata.status < 200 || metadata.status >= 400) throw new CampusError('Dr.COM 认证服务器暂时不可用。', 'HTTP_ERROR');
      return { ...metadata, body };
    } catch (error) {
      if (error instanceof CampusError && !error.portalStatus) error.portalStatus = metadata.status;
      throw error;
    }
  }

  async function landing(useDiscoveredEntry = false) {
    let current = entryUrl(useDiscoveredEntry && profile.discoveredEntry || profile.homepage, profile.homepage, origin);
    const visited = new Set();
    const device = { ip: '', acIp: '', acName: '' };
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (visited.has(current.href)) throw new CampusError('Dr.COM 认证页发生循环跳转。', 'PORTAL_REDIRECT');
      visited.add(current.href);
      for (const [query, key] of [['userip', 'ip'], ['wlanacip', 'acIp'], ['wlanacname', 'acName']]) {
        const value = current.searchParams.get(query);
        if (value === null) continue;
        if (value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new CampusError('Dr.COM 认证页设备参数无效。', 'PORTAL_PARAMETERS');
        device[key] = value; remember(value);
      }
      const response = await send(current, { allowRedirect: true });
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) throw new CampusError('Dr.COM 认证页缺少跳转目标。', 'PORTAL_REDIRECT');
        current = entryUrl(response.location, current, origin);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new CampusError('Dr.COM 认证页暂时不可用。', 'HTTP_ERROR');
      // An identified portal document is authoritative. Its scripts can contain
      // navigation helpers for login, logout and refresh which must never run
      // merely because discovery encountered their URL literals.
      let identified = isLoginPage(response.body);
      if (!identified) { try { pageStatus(response.body); identified = true; } catch { /* A redirect shell need not carry a status marker. */ } }
      if (identified) return { ...device, body: response.body };
      let target;
      try { target = htmlTarget(response.body); }
      catch { throw new CampusError('Dr.COM 认证页包含多个跳转目标。', 'UNKNOWN_RESPONSE'); }
      if (target) {
        const next = entryUrl(target, current, origin);
        if (next.pathname !== current.pathname || next.search && next.search !== current.search) { current = next; continue; }
      }
      return { ...device, body: response.body };
    }
    throw new CampusError('Dr.COM 认证页跳转次数过多。', 'PORTAL_REDIRECT');
  }

  async function status() {
    const url = apiUrl(profile.homepage, '/drcom/chkstatus', [['callback', 'dr1003'], ['jsVersion', '3.3.2'], ['v', Date.now()]]);
    let response;
    try { response = await send(url); }
    catch (error) {
      const code = error.diagnostics?.find(item => item.status)?.status || error.portalStatus;
      if (!(error instanceof CampusError) || error.code !== 'HTTP_ERROR' || ![404, 405, 501].includes(code)) throw error;
      return pageStatus((await landing()).body);
    }
    if (/<(?:!doctype\b|html(?:\s|>))/i.test(response.body)) return pageStatus((await landing()).body);
    const data = parseJsonOrJsonp(response.body);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'result')) throw new CampusError('无法确认 Dr.COM 在线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
    if ([1, '1'].includes(data.result)) return statusResult(true, data);
    if ([0, '0'].includes(data.result)) return statusResult(false);
    throw new CampusError('无法确认 Dr.COM 在线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  }

  if (operation === 'status') return status();
  let url;
  if (operation === 'login') {
    if (!context.username || !context.password || typeof context.username !== 'string' || typeof context.password !== 'string') throw new CampusError('请填写校园网账号和密码。', 'INVALID_PARAMETERS');
    const page = await landing(true);
    let currentStatus;
    try { currentStatus = pageStatus(page.body); }
    catch {
      // A plain login form may omit legacy markers. Conflicting or unknown
      // markers are an explicit unknown state, even if inputs remain visible.
      if (/<!--\s*Dr\.COMWebLoginID_/i.test(pageHtml(page.body)) || !isLoginPage(page.body)) throw new CampusError('无法识别 Dr.COM 登录页面，未提交账号密码。', 'UNKNOWN_RESPONSE');
    }
    if (currentStatus?.online) return { ...currentStatus, message: '当前设备已通过校园网认证，无需重复登录。' };
    const account = `,0,${context.username}`;
    remember(account);
    url = apiUrl(profile.homepage, '/eportal/', [
      ['c', 'Portal'], ['a', 'login'], ['callback', 'dr1003'], ['login_method', '1'],
      ['user_account', account], ['user_password', context.password],
      ['wlan_user_ip', page.ip], ['wlan_user_ipv6', ''], ['wlan_user_mac', '000000000000'],
      ['wlan_ac_ip', page.acIp], ['wlan_ac_name', page.acName], ['jsVersion', '3.3.2'], ['v', Date.now()],
    ]);
  } else {
    // JCU's reference does not publish an ePortal logout request. Reuse the
    // existing Dr.COM endpoint and independently verify the resulting state.
    url = apiUrl(profile.homepage, '/drcom/logout', [['callback', 'dr1003'], ['jsVersion', '3.3.2'], ['v', Date.now()]]);
  }
  const data = parseJsonOrJsonp((await send(url)).body);
  if (!resultAccepted(data)) {
    const detail = [data.msg, data.msga, data.message].find(value => typeof value === 'string')?.slice(0, 300);
    throw new CampusError(`${operation === 'login' ? '校园网认证被拒绝，请检查账号、密码或账号状态。' : '校园网注销未成功，请打开认证页确认。'}${detail ? ` 服务器提示：${detail}` : ''}`, 'AUTH_REJECTED');
  }
  let verified;
  try { verified = await status(); }
  catch { throw new CampusError('服务器已接受请求，但无法确认校园网状态，请检测状态或打开认证页。', 'VERIFY_FAILED'); }
  if (verified.online !== (operation === 'login')) throw new CampusError(operation === 'login' ? '服务器已接受认证请求，但尚未确认在线，请打开认证页检查。' : '服务器已接受注销请求，但状态仍为在线，请打开认证页检查。', 'VERIFY_FAILED');
  return { ...verified, message: operation === 'login' ? '已通过校园网认证。' : '已退出校园网认证。' };
}

module.exports = { drcomEportalOperation };
