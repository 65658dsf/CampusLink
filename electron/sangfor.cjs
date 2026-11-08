'use strict';

// NingMeng123 — Sangfor AC password authentication, independently implemented
// from the public campus portal sources recorded in the university catalog.
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { htmlTarget } = require('./ruijie.cjs');

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const PAGE_PATH = /^(?:\/|\/homepage\/(?:index|login)\.html|\/ac_portal\/(?:[A-Za-z0-9_-]+\/)?(?:pc|mobile|needauth|proxy)\.html)$/i;

function encryptPassword(password, key) {
  // The portal operates on trimmed UTF-16 code units, including characters
  // above byte range. Node's UTF-8 RC4 cipher would produce a different wire.
  const source = password.trim();
  if (!key) throw new CampusError('深信服认证时间参数无效。', 'INVALID_PARAMETERS');
  const state = Array.from({ length: 256 }, (_, index) => index);
  let swapIndex = 0;
  for (let index = 0; index < state.length; index++) {
    swapIndex = (swapIndex + state[index] + key.charCodeAt(index % key.length)) % 256;
    [state[index], state[swapIndex]] = [state[swapIndex], state[index]];
  }
  let left = 0, right = 0;
  const output = [];
  for (let index = 0; index < source.length; index++) {
    left = (left + 1) % 256;
    right = (right + state[left]) % 256;
    [state[left], state[right]] = [state[right], state[left]];
    const mask = state[(state[left] + state[right]) % 256];
    output.push((source.charCodeAt(index) ^ mask).toString(16).padStart(2, '0'));
  }
  return output.join('');
}

async function sangforOperation(profile, operation, context = {}, requester = portalRequest, registerSecret = () => {}) {
  if (!['login', 'logout', 'status'].includes(operation)) throw new CampusError('不支持的深信服认证操作。', 'UNSUPPORTED_OPERATION');
  const customEntry = context.parameters?.portalUrl;
  if (customEntry !== undefined && typeof customEntry !== 'string') throw new CampusError('请填写有效的深信服认证入口。', 'INVALID_PARAMETERS');
  let homepage;
  try { homepage = new URL(customEntry?.trim() || profile.homepage); }
  catch { throw new CampusError('深信服认证入口无效。', 'INVALID_PARAMETERS'); }
  if (!['http:', 'https:'].includes(homepage.protocol) || homepage.username || homepage.password || homepage.hash) throw new CampusError('深信服认证入口无效。', 'INVALID_PARAMETERS');
  const origin = homepage.origin;
  const secrets = [];
  const remember = value => {
    if (typeof value === 'string' && value && !secrets.includes(value)) { secrets.push(value); registerSecret(value); }
  };
  remember(context.username); remember(context.password);
  if (typeof context.password === 'string') remember(context.password.trim());
  for (const [name, value] of homepage.searchParams) if (/^(?:mac|ip|userip|username|session|token|ticket)$/i.test(name)) remember(value);
  const cookies = new Map();
  function acceptCookies(url, values = []) {
    for (const header of values.slice(0, 32)) {
      if (typeof header !== 'string' || header.length > 4096) continue;
      const [pair, ...attributes] = header.split(';');
      const split = pair.indexOf('=');
      const name = pair.slice(0, split).trim(), value = pair.slice(split + 1).trim();
      if (split < 1 || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\u0000-\u001f\u007f]/.test(value)) continue;
      const attrs = new Map(attributes.map(part => {
        const equals = part.indexOf('=');
        return equals < 0 ? [part.trim().toLowerCase(), ''] : [part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim()];
      }));
      const path = attrs.get('path')?.startsWith('/') ? attrs.get('path') : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
      const key = `${name}\n${path}`;
      const expired = attrs.has('max-age') ? Number(attrs.get('max-age')) <= 0 : attrs.has('expires') && Date.parse(attrs.get('expires')) <= Date.now();
      if (expired) cookies.delete(key);
      else if (cookies.size < 32 || cookies.has(key)) cookies.set(key, { name, value, path, secure: attrs.has('secure') });
      remember(value);
    }
  }
  function pageUrl(value, base = homepage) {
    let url;
    try { url = new URL(value, base); }
    catch { throw new CampusError('深信服认证页跳转地址无效。', 'PORTAL_REDIRECT'); }
    if (url.origin !== origin || url.username || url.password || url.hash || !PAGE_PATH.test(url.pathname)
      || [...url.searchParams].some(([name]) => /^(?:opr|action|username|password|pwd|auth_tag|token|ticket)$/i.test(name))) {
      throw new CampusError('深信服认证页超出了已配置的来源或页面范围。', 'PORTAL_REDIRECT');
    }
    return url;
  }
  async function send(url, options = {}) {
    if (url.origin !== origin) throw new CampusError('深信服认证请求超出了已配置的来源。', 'PORTAL_REDIRECT');
    const cookie = [...cookies.values()].filter(item => (!item.secure || url.protocol === 'https:') && (url.pathname === item.path || url.pathname.startsWith(item.path.endsWith('/') ? item.path : `${item.path}/`))).map(item => `${item.name}=${item.value}`).join('; ');
    let response = { status: 200, location: '', setCookies: [] };
    const body = await requester(url, {
      ...options,
      headers: {
        Accept: '*/*', 'Cache-Control': 'no-cache', Origin: origin, Referer: homepage.href,
        'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}), ...options.headers,
      },
      diagnosticSecrets: secrets, onResponse: metadata => { response = metadata; },
    }, profile.timeoutMs || 10000);
    acceptCookies(url, response.setCookies);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 400) throw new CampusError('深信服认证服务器暂时不可用。', 'HTTP_ERROR');
    if (response.status >= 300 && !options.allowRedirect) throw new CampusError('深信服接口返回了未允许的跳转。', 'PORTAL_REDIRECT');
    return { ...response, body };
  }
  async function json(path, parameters) {
    const response = await send(new URL(path, origin), parameters ? {
      method: 'POST', body: new URLSearchParams(parameters), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    } : { method: 'GET' });
    const data = parseJsonOrJsonp(response.body);
    if (!record(data)) throw new CampusError('深信服认证接口返回内容无法识别。', 'UNKNOWN_RESPONSE');
    return data;
  }
  // Every operation starts a fresh, origin-scoped session. Visiting the landing
  // page lets a gateway recover the device's current AUTHSESSID before info or
  // logout, while cookies stay local to this operation.
  let page = pageUrl(homepage.href);
  const visited = new Set();
  let passwordPage = false;
  for (let hop = 0; hop < 6; hop++) {
    if (visited.has(page.href)) throw new CampusError('深信服认证页发生循环跳转。', 'PORTAL_REDIRECT');
    visited.add(page.href);
    const response = await send(page, { method: 'GET', allowRedirect: true });
    const html = response.body.replace(/<!--[\s\S]*?-->/g, '');
    const controls = html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, '');
    const inputIds = [...controls.matchAll(/<input\b[^>]*\s+id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)].map(match => match[1] ?? match[2] ?? match[3]);
    passwordPage = inputIds.includes('password_name') && inputIds.includes('password_pwd');
    const destination = response.status >= 300 ? response.location : passwordPage ? undefined : htmlTarget(html);
    if (!destination) {
      if (response.status >= 300) throw new CampusError('深信服认证页缺少跳转目标。', 'PORTAL_REDIRECT');
      homepage = page;
      break;
    }
    if (hop === 5) throw new CampusError('深信服认证页跳转次数过多。', 'PORTAL_REDIRECT');
    page = pageUrl(destination, page);
  }
  async function status() {
    const data = await json('/homepage/info.php', { opr: 'list' });
    const username = data.data?.basic?.name;
    if (data.success === true && typeof username === 'string' && username.trim() && username.length <= 500 && !/[\u0000-\u001f\u007f]/.test(username)) {
      remember(username);
      return { online: true, username };
    }
    if (data.success === false && typeof data.location === 'string') {
      const target = pageUrl(data.location);
      if (target.pathname === '/ac_portal/needauth.html' || target.pathname === '/homepage/login.html') return { online: false };
    }
    throw new CampusError('深信服未返回明确的在线或离线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  }
  const result = current => ({ online: current.online, portalUrl: homepage.href, message: current.online ? '已通过深信服校园网认证。' : '当前未通过深信服校园网认证。' });
  if (operation === 'status') return result(await status());

  let current;
  try { current = await status(); }
  catch (error) { if (operation !== 'login' || !['INVALID_RESPONSE', 'UNKNOWN_RESPONSE'].includes(error.code)) throw error; }
  if (operation === 'login' && current?.online || operation === 'logout' && current && !current.online) return result(current);

  if (operation === 'login') {
    if (typeof context.username !== 'string' || !context.username.trim() || context.username.length > 256 || /[\u0000-\u001f\u007f]/.test(context.username)
      || typeof context.password !== 'string' || !context.password.trim() || context.password.length > 256 || /[\u0000-\u001f\u007f]/.test(context.password)) throw new CampusError('请填写有效的校园网账号和密码。', 'INVALID_PARAMETERS');
    if (!passwordPage) throw new CampusError('当前入口未显示深信服账号密码认证表单，请打开认证页检查。', 'PORTAL_PARAMETERS');
    const username = context.username.trim();
    const tag = String(Date.now());
    const password = encryptPassword(context.password, tag);
    remember(username); remember(tag); remember(password);
    const data = await json('/ac_portal/login.php', { opr: 'pwdLogin', userName: username, pwd: password, auth_tag: tag, rememberPwd: '0' });
    if (data.success !== true) throw new CampusError('深信服认证被拒绝，请检查账号、密码或打开认证页完成验证。', 'AUTH_REJECTED');
    let verified;
    try { verified = await status(); }
    catch { throw new CampusError('深信服已接受认证请求，但暂时无法确认会话状态，请重新检测。', 'VERIFY_FAILED'); }
    if (!verified.online || verified.username !== username) throw new CampusError('深信服会话尚未与当前账号一致，请打开认证页检查。', 'VERIFY_FAILED');
    return result(verified);
  }

  const data = await json('/homepage/logout');
  if (data.success !== true) throw new CampusError('深信服注销未成功，请打开认证页检查。', 'AUTH_REJECTED');
  let verified;
  try { verified = await status(); }
  catch { throw new CampusError('深信服已接受注销请求，但暂时无法确认会话状态，请重新检测。', 'VERIFY_FAILED'); }
  if (verified.online) throw new CampusError('深信服注销后会话仍在线，请打开认证页检查。', 'VERIFY_FAILED');
  return result(verified);
}

module.exports = { sangforOperation, encryptPassword };
