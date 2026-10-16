'use strict';

// NingMeng123 — controlled ePortal Web adapter. Protocol reference and original
// RSA test vector: LFWQSP2641/scu_net_auto_login (see assets/licenses).
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const MAX_HOPS = 6;
const MAX_QUERY = 16384;
const PATHS = { login: '/eportal/index.jsp', online: '/eportal/success.jsp', api: '/eportal/InterFace.do' };

function rsaEncrypt(value, publicKey) {
  const exponent = BigInt(`0x${publicKey.exponent}`);
  const modulus = BigInt(`0x${publicKey.modulus}`);
  const bits = modulus.toString(2).length;
  if (bits < 512 || bits > 4096 || !(modulus & 1n) || exponent < 3n || exponent > 0xffffffffn || !(exponent & 1n)) throw new CampusError('锐捷 RSA 公钥配置无效。', 'INVALID_PROFILE');
  // This legacy browser protocol packs UTF-16 code units into little-endian
  // words. Reversing code units is intentional; UTF-8/OAEP would not match it.
  const input = String(value).split('').reverse().map(character => character.charCodeAt(0));
  const chunkSize = 2 * Math.ceil(bits / 16);
  while (input.length % chunkSize) input.push(0);
  const parts = [];
  for (let start = 0; start < input.length; start += chunkSize) {
    let block = 0n;
    for (let offset = 0; offset < chunkSize; offset += 2) block |= BigInt(input[start + offset] | (input[start + offset + 1] << 8)) << BigInt(offset * 8);
    let power = exponent, factor = block % modulus, encrypted = 1n;
    while (power) {
      if (power & 1n) encrypted = encrypted * factor % modulus;
      factor = factor * factor % modulus;
      power >>= 1n;
    }
    parts.push(encrypted.toString(16).padStart(Math.ceil(bits / 4), '0'));
  }
  return parts.join(' ');
}

function encryptPassword(password, mac, publicKey) {
  // The SCU-style reference packs `password>mac`; some deployments (for
  // example CDUT-Yibin) encrypt the reversed password alone via rsaEncrypt.
  return rsaEncrypt(`${password}>${mac}`, publicKey);
}

function allowedUrl(value, base, profile) {
  let url;
  try { url = new URL(value, base); } catch { throw new CampusError('锐捷认证页返回了无效跳转地址。', 'PORTAL_REDIRECT'); }
  const origins = new Set([new URL(profile.homepage).origin, ...(profile.ruijie.redirectOrigins || [])]);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !origins.has(url.origin)) throw new CampusError('锐捷认证页跳转到了方案未允许的地址，请核对认证入口和允许的跳转源。', 'PORTAL_REDIRECT');
  return url;
}

function queryContext(url, requireMac = true) {
  const queryString = url.search.slice(1);
  const mac = url.searchParams.get('mac') || '';
  // Profiles that encrypt the reversed password alone do not need the device
  // identifier, but the query string itself must still be present.
  if (!queryString || queryString.length > MAX_QUERY || (requireMac && (!mac || mac.length > 256 || /[\s\u0000-\u001f]/.test(mac)))) throw new CampusError('锐捷认证页缺少有效的设备参数，请连接校园网络后打开认证页检查。', 'PORTAL_PARAMETERS');
  return { queryString, mac };
}

function htmlTarget(text) {
  // Read URL literals only. Never execute portal JavaScript, even if a page
  // returns a script instead of an HTTP Location header.
  const html = text.replace(/<!--[\s\S]*?-->/g, '').replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');
  const urls = new Set();
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]);
  for (const script of scripts) {
    for (const match of script.matchAll(/\blocation(?:\.href)?\s*=\s*(["'])([^"'\r\n<>]+)\1\s*(?:;|$)/g)) urls.add(match[2]);
    for (const match of script.matchAll(/\blocation\.(?:replace|assign)\s*\(\s*(["'])([^"'\r\n<>]+)\1\s*\)\s*(?:;|$)/g)) urls.add(match[2]);
  }
  for (const match of html.matchAll(/<meta\b[^<>]*>/gi)) {
    const attributes = new Map([...match[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(attr => [attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]]));
    if (attributes.get('http-equiv')?.toLowerCase() !== 'refresh') continue;
    const target = attributes.get('content')?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(.*?)\s*$/i)?.[1]?.replace(/^(["'])(.*?)\1$/, '$2');
    if (target) urls.add(target);
  }
  if (urls.size > 1) throw new CampusError('锐捷页面包含多个认证目标，无法确认当前设备状态。', 'UNKNOWN_RESPONSE');
  return [...urls][0];
}

function userIndexFrom(url, text = '') {
  const value = url.searchParams.get('userIndex') || text.match(/\buserIndex["']?\s*[=:]\s*["']([^"'\r\n]{1,512})["']/i)?.[1] || '';
  return value.length <= 512 && !/[\u0000-\u0020]/.test(value) ? value : '';
}

function createPortalSession(profile, requester, onSecret) {
  const cookies = new Map();
  let discoveredEntry = profile.discoveredEntry;
  const secrets = [];
  const remember = value => { if (typeof value === 'string' && value && !secrets.includes(value)) { secrets.push(value); onSecret(value); } };
  function acceptCookies(url, values = []) {
    const jar = cookies.get(url.origin) || new Map();
    for (const header of values.slice(0, 32)) {
      if (typeof header !== 'string' || header.length > 4096) continue;
      const [pair, ...attributes] = header.split(';');
      const split = pair.indexOf('=');
      const name = pair.slice(0, split).trim(), value = pair.slice(split + 1).trim();
      if (split < 1 || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n\u0000-\u001f]/.test(value)) continue;
      const attrs = new Map(attributes.map(part => { const n = part.indexOf('='); return n < 0 ? [part.trim().toLowerCase(), ''] : [part.slice(0, n).trim().toLowerCase(), part.slice(n + 1).trim()]; }));
      const path = attrs.get('path')?.startsWith('/') ? attrs.get('path') : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
      const key = `${name}\n${path}`;
      const expired = attrs.has('max-age') ? Number(attrs.get('max-age')) <= 0 : attrs.has('expires') && Date.parse(attrs.get('expires')) <= Date.now();
      if (expired) jar.delete(key);
      else if (jar.size < 32 || jar.has(key)) jar.set(key, { name, value, path, secure: attrs.has('secure') });
      remember(value);
    }
    // Origin partitioning intentionally never forwards a portal's cookie to a
    // separately allowed discovery host, regardless of its Domain attribute.
    cookies.set(url.origin, jar);
  }
  async function send(url, options = {}) {
    const jar = cookies.get(url.origin);
    const cookie = [...(jar?.values() || [])].filter(item => (!item.secure || url.protocol === 'https:') && (url.pathname === item.path || url.pathname.startsWith(item.path.endsWith('/') ? item.path : `${item.path}/`))).map(item => `${item.name}=${item.value}`).join('; ');
    let response = { status: 200, location: '', setCookies: [] };
    const body = await requester(url, {
      ...options,
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT, ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
      diagnosticSecrets: secrets,
      onResponse: info => { response = info; },
    }, profile.timeoutMs || 10000);
    acceptCookies(url, response.setCookies);
    return { ...response, body };
  }
  async function discover() {
    let current = allowedUrl(discoveredEntry || profile.ruijie.discoveryUrl || profile.homepage, profile.homepage, profile);
    discoveredEntry = undefined;
    const visited = new Set();
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (visited.has(current.href)) throw new CampusError('锐捷认证页发生循环跳转，请打开认证页检查。', 'PORTAL_REDIRECT');
      visited.add(current.href);
      const response = await send(current, { method: 'GET', allowRedirect: true });
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) throw new CampusError('锐捷认证页未提供跳转目标。', 'PORTAL_REDIRECT');
        current = allowedUrl(response.location, current, profile);
        continue;
      }
      const target = htmlTarget(response.body);
      if (target) {
        const next = allowedUrl(target, current, profile);
        // Portals ship literal self-navigation inside helper functions (for
        // example the success page's `window.location="./success.jsp"`).
        // Keep the current document when the target has the same origin and
        // path so a page refresh is not mistaken for a redirect loop.
        if (next.origin !== current.origin || next.pathname !== current.pathname) {
          current = next;
          continue;
        }
      }
      // An approved discovery host can supply a URL, but only the configured
      // authentication origin's actual success page confirms an online session.
      if (current.origin === new URL(profile.homepage).origin && current.pathname.toLowerCase() === PATHS.online) {
        const userIndex = userIndexFrom(current, response.body);
        remember(userIndex);
        return { online: true, userIndex, message: '已通过锐捷校园网认证。' };
      }
      if (current.origin === new URL(profile.homepage).origin && current.pathname.toLowerCase() === PATHS.login) {
        const context = queryContext(current, profile.ruijie.passwordWithMac !== false);
        remember(context.queryString); remember(context.mac);
        return { online: false, ...context, message: '当前尚未通过锐捷校园网认证。' };
      }
      throw new CampusError('无法识别锐捷认证页面，未将未知状态视为离线，请打开认证页检查。', 'UNKNOWN_RESPONSE');
    }
    throw new CampusError('锐捷认证页跳转次数过多，请打开认证页检查。', 'PORTAL_REDIRECT');
  }
  async function api(method, values) {
    const url = new URL(PATHS.api, profile.homepage);
    url.searchParams.set('method', method);
    const response = await send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: profile.homepage },
      body: new URLSearchParams(values).toString(),
    });
    const data = parseJsonOrJsonp(response.body);
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.result !== 'string') throw new CampusError('锐捷认证服务器返回了无法识别的结果。', 'INVALID_RESPONSE');
    remember(data.userIndex);
    return data;
  }
  return { discover, api, remember };
}

// 服务器拒绝文案 → 可操作提示（含成都理工大学宜宾校区实测样本与常见锐捷文案）。
const REJECTION_HINTS = [
  [/用户名或密码错误|用户名或者密码错误|账号或密码错误|密码错误/, '账号或密码未被服务器接受：请确认使用完整账号（例如学号加运营商后缀，如 @ct），并可在学校自助服务平台核对或找回密码后重试。'],
  [/同时在线上限|在线设备|设备.{0,8}(?:上限|超限)|超出.{0,8}(?:限制|数量)/, '账号在线设备数可能已达上限：请打开学校自助服务平台下线其它设备后重试。'],
  [/欠费|余额|停机|欠款|已过期|到期|套餐/, '账号状态可能异常（欠费或套餐到期）：请到学校自助服务平台处理后再试。'],
  [/不存在|无此用户|未注册|未开通|未绑定/, '账号可能尚未开通或未绑定校园网：请先在自助服务平台完成绑定后再试。'],
];

function rejected(data, operation) {
  const detail = typeof data.message === 'string' ? data.message.slice(0, 300) : '';
  if (/验证码|captcha/i.test(detail)) throw new CampusError('锐捷认证需要验证码，请打开认证页完成验证后再检测状态。', 'CAPTCHA_REQUIRED');
  const hint = REJECTION_HINTS.find(([pattern]) => pattern.test(detail))?.[1] || '';
  if (operation === 'logout') {
    throw new CampusError(`锐捷注销未成功。${hint ? ` ${hint}` : ''}${detail ? ` 服务器提示：${detail}` : ''}`, 'AUTH_REJECTED');
  }
  throw new CampusError(`${hint || '锐捷认证被拒绝，请检查账号、密码和网络服务。'}${detail ? ` 服务器提示：${detail}` : ''}`, 'AUTH_REJECTED');
}

async function ruijieOperation(profile, operation, context, requester, onSecret = () => {}) {
  const portal = createPortalSession(profile, requester, onSecret);
  const status = await portal.discover();
  if (operation === 'status') return { online: status.online, message: status.message };
  if (operation === 'login' && status.online) return { online: true, message: '当前设备已通过锐捷校园网认证，无需重复登录。' };
  if (operation === 'logout' && !status.online) return { online: false, message: '当前设备已退出锐捷校园网认证。' };
  if (!['login', 'logout'].includes(operation)) throw new CampusError('不支持的锐捷操作。', 'UNSUPPORTED_OPERATION');
  let data;
  if (operation === 'login') {
    const service = context.parameters?.service ?? profile.fields?.find(field => field.key === 'service')?.default ?? '';
    const serviceRequired = profile.ruijie.serviceOptional !== true;
    if ((serviceRequired && !service) || !context.username || !context.password) throw new CampusError(serviceRequired ? '请填写校园网账号、密码并选择网络服务。' : '请填写校园网账号和密码。', 'INVALID_PARAMETERS');
    // Deployments differ: SCU packs `password>mac` into the legacy transform,
    // CDUT-Yibin encrypts the reversed password alone.
    const password = profile.ruijie.passwordWithMac === false
      ? rsaEncrypt(context.password, profile.ruijie.publicKey)
      : encryptPassword(context.password, status.mac, profile.ruijie.publicKey);
    portal.remember(password);
    // CDUT-Yibin pre-encodes the account and query string once before the
    // portal form is serialized, so both appear double-encoded on the wire.
    const encodeValue = value => profile.ruijie.valueEncoding === 'percent' ? encodeURIComponent(value) : value;
    data = await portal.api('login', {
      userId: encodeValue(context.username), password,
      service: profile.ruijie.serviceEncoding === 'percent' ? encodeURIComponent(service) : service,
      queryString: encodeValue(status.queryString), operatorPwd: '', operatorUserId: '', validcode: '', passwordEncrypt: 'true',
    });
  } else {
    // SCU's own Go implementation uses an empty logout body; deployments which
    // issue userIndex on their success page receive that identifier as well.
    data = await portal.api('logout', status.userIndex ? { userIndex: status.userIndex } : {});
  }
  if (data.result.toLowerCase() !== 'success' && !(operation === 'logout' && typeof data.message === 'string' && data.message.includes('用户已不在线'))) rejected(data, operation);
  let verified;
  try { verified = await portal.discover(); }
  catch { throw new CampusError('锐捷服务器已接受请求，但暂时无法确认认证状态，请检测网络或打开认证页。', 'VERIFY_FAILED'); }
  if (verified.online !== (operation === 'login')) throw new CampusError(operation === 'login' ? '锐捷服务器已接受登录，但尚未确认在线，请检测网络或打开认证页。' : '锐捷服务器已接受注销，但状态仍显示在线，请检测网络或打开认证页。', 'VERIFY_FAILED');
  return { online: verified.online, message: operation === 'login' ? '锐捷校园网认证成功。' : '已退出锐捷校园网认证。' };
}

module.exports = { ruijieOperation, encryptPassword, rsaEncrypt, allowedUrl, queryContext, htmlTarget };
