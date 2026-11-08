'use strict';

// NingMeng123 — independently implemented SRun BX1 wire protocol.
// Protocol references and fixed vectors are recorded in the school source catalog.
const { createHmac, createHash } = require('node:crypto');
const { isIP } = require('node:net');
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { htmlTarget } = require('./ruijie.cjs');

const NORMAL_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SRUN_BASE64 = 'LVoJPiCN2R8G90yg+hmFHuacZ1OWMnrsSTXkYpUq/3dlbfKwv6xztjI7DeBE45QA';
const cachedAcIds = new Map();
const validIp = value => typeof value === 'string' && isIP(value) === 4 && value !== '0.0.0.0' && value !== '255.255.255.255';
const validAcId = value => typeof value === 'string' && /^\d{1,6}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function xencode(message, challenge) {
  if (!message.length) return Buffer.alloc(0);
  const bytes = Buffer.from(message, 'utf8');
  const words = Array.from({ length: Math.ceil(bytes.length / 4) }, (_, index) => {
    const padded = Buffer.alloc(4);
    bytes.copy(padded, 0, index * 4, index * 4 + 4);
    return padded.readUInt32LE();
  });
  words.push(bytes.length);
  const keyBytes = Buffer.alloc(16);
  Buffer.from(challenge, 'utf8').copy(keyBytes, 0, 0, 16);
  const key = Array.from({ length: 4 }, (_, index) => keyBytes.readUInt32LE(index * 4));
  let sum = 0;
  let previous = words[words.length - 1];
  const rounds = Math.floor(6 + 52 / words.length);
  for (let round = 0; round < rounds; round++) {
    sum = (sum + 0x9e3779b9) >>> 0;
    const selector = sum >>> 2 & 3;
    for (let index = 0; index < words.length; index++) {
      const next = words[(index + 1) % words.length];
      const mixed = (previous >>> 5 ^ next << 2)
        + ((next >>> 3 ^ previous << 4) ^ (sum ^ next))
        + (key[(index & 3) ^ selector] ^ previous);
      previous = words[index] = (words[index] + mixed) >>> 0;
    }
  }
  const encoded = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => encoded.writeUInt32LE(word, index * 4));
  return encoded;
}

function loginArtifacts(username, password, ip, acId, challenge, hmacMode) {
  // ASCII JSON escapes also preserve non-ASCII account/password characters in
  // gateways whose original xencode helper packs bytes rather than UTF-8 text.
  const json = JSON.stringify({ username, password, ip, acid: acId, enc_ver: 'srun_bx1' })
    .replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const encoded = xencode(json, challenge).toString('base64')
    .replace(/[A-Za-z0-9+/]/g, character => SRUN_BASE64[NORMAL_BASE64.indexOf(character)]);
  const info = `{SRBX1}${encoded}`;
  const digest = createHmac('md5', challenge).update(hmacMode === 'empty' ? '' : password, 'utf8').digest('hex');
  const checksumInput = [username, digest, acId, ip, '200', '1', info].map(value => challenge + value).join('');
  return { password: `{MD5}${digest}`, info, chksum: createHash('sha1').update(checksumInput, 'utf8').digest('hex') };
}

function apiUrl(homepage, path, parameters) {
  const url = new URL(path, homepage);
  url.search = new URLSearchParams({ callback: 'jQuery', ...parameters, _: String(Date.now()) }).toString();
  return url;
}

async function srunOperation(profile, operation, context = {}, requester = portalRequest, registerSecret = () => {}) {
  if (!['login', 'logout', 'status'].includes(operation)) throw new CampusError('不支持的深澜认证操作。', 'UNSUPPORTED_OPERATION');
  const settings = profile.srun;
  if (!record(settings) || settings.acId !== 'auto' && !validAcId(settings.acId) || !['empty', 'password'].includes(settings.hmacMode)) {
    throw new CampusError('深澜方案的接入控制器或密码模式无效。', 'INVALID_PROFILE');
  }
  const homepage = new URL(profile.homepage);
  if (!['http:', 'https:'].includes(homepage.protocol) || homepage.username || homepage.password || homepage.hash) throw new CampusError('深澜认证入口无效。', 'INVALID_PROFILE');
  const origin = homepage.origin;
  const secrets = [];
  const remember = value => {
    if (typeof value === 'string' && value && !secrets.includes(value)) { secrets.push(value); registerSecret(value); }
  };
  remember(context.username); remember(context.password);
  async function send(url, allowRedirect = false) {
    if (url.origin !== origin) throw new CampusError('深澜认证请求超出了已配置的来源。', 'PORTAL_REDIRECT');
    let response = { status: 200, location: '' };
    const body = await requester(url, {
      method: 'GET', allowRedirect,
      headers: { Accept: '*/*', 'Cache-Control': 'no-cache', Referer: `${origin}/` },
      diagnosticSecrets: secrets, onResponse: metadata => { response = metadata; },
    }, profile.timeoutMs || 10000);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 400) throw new CampusError('深澜认证服务器暂时不可用。', 'HTTP_ERROR');
    if (response.status >= 300 && !allowRedirect) throw new CampusError('深澜接口返回了未允许的跳转。', 'PORTAL_REDIRECT');
    return { ...response, body };
  }
  async function json(path, parameters) {
    const response = await send(apiUrl(homepage, path, parameters));
    const data = parseJsonOrJsonp(response.body);
    if (!record(data)) throw new CampusError('深澜认证接口返回内容无法识别。', 'INVALID_RESPONSE');
    return data;
  }
  async function status() {
    const response = await send(apiUrl(homepage, '/cgi-bin/rad_user_info', {}));
    if (response.body.trim() === 'not_online_error') return { online: false };
    const data = parseJsonOrJsonp(response.body);
    if (!record(data)) throw new CampusError('深澜在线状态无法识别。', 'UNKNOWN_RESPONSE');
    const identity = data.user_name ?? data.username;
    if (identity !== undefined && (typeof identity !== 'string' || identity.length > 500 || /[\u0000-\u001f\u007f]/.test(identity))) throw new CampusError('深澜会话信息无效。', 'UNKNOWN_RESPONSE');
    const username = typeof identity === 'string' ? identity.trim() : '';
    const ip = [data.online_ip, data.client_ip].find(validIp);
    remember(username); remember(ip);
    if (data.error === 'not_online_error' && !username) return { online: false, ip };
    if (data.error === 'ok' && username && ip) return { online: true, ip, username };
    throw new CampusError('深澜未返回明确的在线或离线状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  }
  const result = value => ({ online: value.online, ...(value.ip ? { ip: value.ip } : {}), portalUrl: `${origin}/`, message: value.online ? '已通过深澜校园网认证。' : '当前未通过深澜校园网认证。' });
  let current = await status();
  if (operation === 'status' || operation === 'login' && current.online || operation === 'logout' && !current.online) return result(current);

  async function acId() {
    if (settings.acId !== 'auto') return settings.acId;
    const key = JSON.stringify([profile.id, origin, homepage.pathname]);
    const landing = value => {
      let url;
      try { url = new URL(value); } catch { throw new CampusError('深澜认证页跳转地址无效。', 'PORTAL_REDIRECT'); }
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { throw new CampusError('深澜认证页路径无效。', 'PORTAL_REDIRECT'); }
      const actionKeys = /^(?:action|a|method)$/i;
      const actions = /^(?:login|logout|logoff|disconnect|unbind|bind|kick|delete|remove)$/i;
      if (url.origin !== origin || url.username || url.password || url.hash || /^\/cgi-bin\//i.test(path)
        || [...url.searchParams].some(([name, value]) => actionKeys.test(name) && actions.test(value) || /^(?:username|password|token|ticket|secret)$/i.test(name))) {
        throw new CampusError('深澜认证页包含未允许的跳转。', 'PORTAL_REDIRECT');
      }
      return url;
    };
    let currentPage = landing(homepage.href);
    const visited = new Set();
    const candidates = new Set();
    for (let hop = 0; hop < 6; hop++) {
      if (visited.has(currentPage.href)) throw new CampusError('深澜认证页发生循环跳转。', 'PORTAL_REDIRECT');
      visited.add(currentPage.href);
      for (const name of ['ac_id', 'acid']) {
        const value = currentPage.searchParams.get(name);
        if (value !== null) { if (!validAcId(value)) throw new CampusError('深澜页面返回了无效的接入控制器编号。', 'PORTAL_PARAMETERS'); candidates.add(value); }
      }
      const response = await send(currentPage, true);
      const html = response.body.replace(/<!--[\s\S]*?-->/g, '');
      for (const config of html.matchAll(/\b(?:var|let|const)\s+CONFIG\s*=\s*\{([^{}]*)\}/g)) {
        for (const field of config[1].matchAll(/(?:^|,)\s*(?:ac_id|acid)\s*:\s*(?:["'](\d{1,6})["']|(\d{1,6}))\s*(?=,|$)/g)) candidates.add(field[1] ?? field[2]);
      }
      if (candidates.size > 1) throw new CampusError('深澜接入控制器编号存在冲突。', 'PORTAL_PARAMETERS');
      if (response.status >= 300 && !response.location) throw new CampusError('深澜认证页缺少跳转目标。', 'PORTAL_REDIRECT');
      const destination = response.status >= 300 ? response.location : htmlTarget(response.body);
      if (!destination) break;
      if (hop === 5) throw new CampusError('深澜认证页跳转次数过多。', 'PORTAL_REDIRECT');
      try { currentPage = landing(new URL(destination, currentPage).href); }
      catch (error) { if (error instanceof CampusError) throw error; throw new CampusError('深澜认证页跳转地址无效。', 'PORTAL_REDIRECT'); }
    }
    if (candidates.size === 1) {
      const discovered = [...candidates][0];
      cachedAcIds.delete(key);
      if (cachedAcIds.size >= 32) cachedAcIds.delete(cachedAcIds.keys().next().value);
      cachedAcIds.set(key, discovered);
      return discovered;
    }
    if (operation === 'logout' && cachedAcIds.has(key)) return cachedAcIds.get(key);
    throw new CampusError('未能读取深澜接入控制器编号，请打开认证页或选择匹配校区的方案。', 'PORTAL_PARAMETERS');
  }
  const controller = await acId();
  let data, expectedUsername;
  if (operation === 'logout') {
    data = await json('/cgi-bin/srun_portal', { action: 'logout', ac_id: controller, ip: current.ip, username: current.username });
  } else {
    if (typeof context.username !== 'string' || !context.username || context.username.length > 256 || /[\u0000-\u001f\u007f]/.test(context.username)
      || typeof context.password !== 'string' || !context.password || context.password.length > 256 || /[\u0000-\u001f\u007f]/.test(context.password)) throw new CampusError('请填写有效的校园网账号和密码。', 'INVALID_PARAMETERS');
    const suffixField = profile.fields?.find(field => field.key === 'suffix');
    const suffix = context.parameters?.suffix ?? suffixField?.default ?? settings.usernameSuffix ?? '';
    if (typeof suffix !== 'string' || !/^(?:@[A-Za-z0-9._-]{1,80})?$/.test(suffix) || suffixField?.options && !suffixField.options.some(option => option.value === suffix)) throw new CampusError('请选择方案支持的校园网服务。', 'INVALID_PARAMETERS');
    let username = context.username;
    if (suffix) {
      if (username.includes('@') && !username.toLowerCase().endsWith(suffix.toLowerCase())) throw new CampusError('账号后缀与所选服务不一致，请更正账号或选择完整账号。', 'INVALID_PARAMETERS');
      if (!username.toLowerCase().endsWith(suffix.toLowerCase())) username += suffix;
    }
    remember(username);
    expectedUsername = username;
    const challenge = await json('/cgi-bin/get_challenge', { username, ip: current.ip || '' });
    if (typeof challenge.challenge === 'string' && challenge.challenge.length <= 1000) remember(challenge.challenge);
    if (Object.hasOwn(challenge, 'error') && challenge.error !== 'ok' || Object.hasOwn(challenge, 'res') && challenge.res !== 'ok'
      || typeof challenge.challenge !== 'string' || !/^[A-Za-z0-9]{16,128}$/.test(challenge.challenge)) throw new CampusError('深澜未提供有效认证挑战，请稍后重新检测。', 'UNKNOWN_RESPONSE');
    if (Object.hasOwn(challenge, 'client_ip') && !validIp(challenge.client_ip)) throw new CampusError('深澜挑战返回了无效设备 IPv4。', 'PORTAL_PARAMETERS');
    const ip = [challenge.client_ip, challenge.online_ip, current.ip].find(validIp);
    if (!ip) throw new CampusError('未能确认当前设备 IPv4，无法完成深澜认证。', 'PORTAL_PARAMETERS');
    remember(ip);
    current = { ...current, ip };
    const artifacts = loginArtifacts(username, context.password, ip, controller, challenge.challenge, settings.hmacMode);
    Object.values(artifacts).forEach(remember);
    remember(artifacts.password.slice(5)); remember(artifacts.info.slice(7));
    data = await json('/cgi-bin/srun_portal', { action: 'login', username, ...artifacts, ac_id: controller, ip, n: '200', type: '1', os: 'Windows 10', name: 'Windows', double_stack: '0' });
  }
  const accepted = operation === 'login' ? ['ok', 'up_pwd_alert'] : ['ok'];
  if (!accepted.includes(data.error) || Object.hasOwn(data, 'res') && !accepted.includes(data.res)) {
    const detail = [data.error_msg, data.suc_msg, data.error].find(value => typeof value === 'string');
    if (detail && /验证码|captcha/i.test(detail)) throw new CampusError('深澜认证要求验证码，请打开学校认证页完成验证。', 'CAPTCHA_REQUIRED');
    throw new CampusError(`深澜${operation === 'login' ? '认证' : '注销'}未成功。${detail ? ` ${detail.slice(0, 300)}` : ''}`, 'AUTH_REJECTED');
  }
  let verified;
  try { verified = await status(); }
  catch { throw new CampusError('深澜服务器已接受请求，但暂时无法确认会话状态，请重新检测。', 'VERIFY_FAILED'); }
  if (verified.online !== (operation === 'login') || operation === 'login' && (verified.ip !== current.ip || verified.username !== expectedUsername)) throw new CampusError('深澜服务器已接受请求，但会话状态尚未符合预期，请打开认证页检查。', 'VERIFY_FAILED');
  const verifiedResult = result(verified);
  if (operation === 'login' && data.error === 'up_pwd_alert') verifiedResult.message += ' 学校提示更新密码，请在认证页查看。';
  return verifiedResult;
}

module.exports = { srunOperation, xencode, loginArtifacts };
