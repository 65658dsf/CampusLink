'use strict';

// NingMeng123 — read-only Dr.COM discovery. Portal scripts are data, never code.
// Field contracts: GZIST a41/a40 (2c61996486fdca9fcf4fc2e387114395c681a446),
// OUNet (cade50a288daab8d73a0a27e1d734cef972a72e2), and SEU protocol notes.
const { isIP } = require('node:net');
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { discoverPortal } = require('./portal-discovery.cjs');
const { htmlTarget } = require('./ruijie.cjs');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPTS = 8;
const MAX_DURATION = 30000;
const confirmedEntries = new Map();
const SECRET_QUERY = /^(?:user(?:name|account|password|id)?|account|ddddd|upass|pass(?:word|wd)?|pwd|(?:access|refresh)?token|apikey|authorization|cookie|secret|credential)s?$/i;
const ALIASES = {
  epHTTPPort: 'httpPort', ep_http_port: 'httpPort', enHTTPSPort: 'httpsPort', ep_https_port: 'httpsPort',
  enableHttps: 'httpsMode', enable_https: 'httpsMode', domainName: 'domain', domain_name: 'domain',
  accountPrefix: 'accountPrefixFlag', account_prefix: 'accountPrefixFlag',
  accountSuffix: 'accountSuffix', account_suffix: 'accountSuffix', loginMethod: 'loginMethod', login_method: 'loginMethod',
  enMd5: 'md5', en_md5: 'md5', enableR3: 'enableR3', enable_r3: 'enableR3',
  page_data_encrypt: 'dataEncrypt', encrypt: 'dataEncrypt', apg_switch: 'apg', customPerceive: 'customPerceive', custom_perceive: 'customPerceive',
  no_filter_accandpwd: 'base64Credentials', is_base64encode: 'base64Credentials', password_cut: 'passwordCut', enable_captcha: 'captcha', en_captcha: 'captcha',
  check_online_method: 'checkOnlineMethod', port_mode: 'portMode', jsVersion: 'jsVersion',
  program_index: 'programIndex', page_index: 'pageIndex', ac_logout: 'acLogout', register_mode: 'registerMode', lang: 'language',
};
const BLOCKERS = ['md5', 'dataEncrypt', 'apg', 'customPerceive', 'base64Credentials', 'passwordCut', 'captcha', 'checkOnlineMethod', 'portMode'];

function failure(message, evidence = [], unsupported = false) {
  const summary = evidence.length ? ` 已识别：${evidence.join('；')}。` : '';
  throw new CampusError(`${message}${summary} 请打开学校认证页核对；可在通用方案填写认证页地址、接口端口或账号前缀。`, unsupported ? 'DRCOM_UNSUPPORTED' : 'DRCOM_DETECTION_FAILED');
}
function entities(text) {
  return String(text).replace(/&amp;|&#0*38;|&#x0*26;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'");
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), entities(m[2] ?? m[3] ?? m[4])]));
}
function safeEntry(value, base, origin) {
  if (typeof value !== 'string' || value.length > 20000 || /[\u0000-\u0020]/.test(value)) failure('认证页地址无效。');
  let url;
  try { url = new URL(value, base); } catch { failure('认证页地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || origin && url.origin !== origin) failure('认证页跳转超出了当前认证来源。');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { failure('认证页路径无效。'); }
  if (/\/(?:login|logout|logoff|disconnect|bind|unbind|kick|delete|remove)(?:\.|\/|$)/i.test(path) || /^\/F\.htm$/i.test(path) ||
      /^\/eportal\/portal\//i.test(path) && !/^\/eportal\/portal\/page\/loadConfig\/?$/i.test(path) ||
      [...url.searchParams].some(([key, val]) => SECRET_QUERY.test(key.replace(/[^a-z0-9]/gi, '')) || /^(?:a|action|method)$/i.test(key) && /^(?:login|logout|logoff|disconnect|bind|unbind|kick|delete|remove)$/i.test(val))) failure('自动识别不能访问登录、注销、设备操作或带账号密码的地址。');
  return url;
}
function recognizedPage(body) {
  const html = body.replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, '');
  return /<html(?:\s|>)/i.test(html) && (/<!--\s*Dr\.COMWebLoginID_[0-3]\.htm\s*-->/i.test(html) ||
    ['DDDDD', 'upass'].every(name => new RegExp(`<input\\b[^<>]*(?:name|id)\\s*=\\s*["']?${name}(?:["'\\s>])`, 'i').test(html)));
}

// Small bounded lexer: strings/comments cannot masquerade as assignments.
// It reads literals only; expressions, calls and property access are not evaluated.
function tokensOf(source) {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) failure('认证脚本过大。');
  const tokens = [];
  let i = 0, depth = 0, round = 0, square = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i + 2); i = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    // Skip regular-expression literals so braces inside /.../ do not alter
    // nesting depth and create fake top-level configuration assignments.
    if (c === '/' && (!tokens.length || ['=', '(', '[', '{', ',', ':', ';', '!', '&', '|', '?', 'return', 'case'].includes(tokens.at(-1).value))) {
      let inClass = false; i++;
      while (i < source.length) {
        const part = source[i++];
        if (part === '\\') { i++; continue; }
        if (part === '[') inClass = true;
        if (part === ']') inClass = false;
        if (part === '/' && !inClass) break;
      }
      while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
      tokens.push({ type: 'opaque', value: '', depth, round, square }); continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; let value = ''; let valid = quote !== '`'; i++;
      while (i < source.length && source[i] !== quote) {
        let part = source[i++];
        if (part === '\\') {
          if (i >= source.length) { valid = false; break; }
          const escape = source[i++];
          const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
          if (escape === 'x' || escape === 'u') {
            const width = escape === 'x' ? 2 : 4, digits = source.slice(i, i + width);
            if (!new RegExp(`^[0-9a-f]{${width}}$`, 'i').test(digits)) { valid = false; }
            else { part = String.fromCharCode(parseInt(digits, 16)); i += width; }
          } else if (escape === '\n') part = '';
          else if (escape === '\r') { if (source[i] === '\n') i++; part = ''; }
          else part = Object.hasOwn(simple, escape) ? simple[escape] : escape;
        }
        value += part;
      }
      if (source[i] !== quote) valid = false; else i++;
      tokens.push({ type: valid ? 'literal' : 'opaque', value, depth, round, square });
      continue;
    }
    const identifier = source.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (identifier) { tokens.push({ type: 'id', value: identifier, depth, round, square }); i += identifier.length; continue; }
    const number = source.slice(i).match(/^-?\d+(?:\.\d+)?/)?.[0];
    if (number) { tokens.push({ type: 'literal', value: number, depth, round, square }); i += number.length; continue; }
    if (c === '}') depth = Math.max(0, depth - 1);
    if (c === ')') round = Math.max(0, round - 1);
    if (c === ']') square = Math.max(0, square - 1);
    tokens.push({ type: 'punct', value: c, depth, round, square });
    if (c === '{') depth++;
    if (c === '(') round++;
    if (c === '[') square++;
    i++;
  }
  return tokens;
}

function independentAssignment(tokens, index) {
  const token = tokens[index];
  if (!token || token.depth || token.round || token.square) return false;
  const previous = tokens[index - 1]?.value;
  const boundary = [';', '}', undefined];
  return ['var', 'let', 'const'].includes(previous)
    ? boundary.includes(tokens[index - 2]?.value)
    : boundary.includes(previous);
}

function parseStatic(source) {
  const tokens = tokensOf(source), values = new Map(), literals = [], stack = [];
  const add = (key, value) => { if (!values.has(key)) values.set(key, new Set()); values.get(key).add(String(value)); };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'literal') literals.push(token.value);
    if (token.value === '{') {
      const before = tokens[i - 1], name = before?.value === '=' && independentAssignment(tokens, i - 2) ? tokens[i - 2]?.value : '';
      stack.push(name || '');
    } else if (token.value === '}') stack.pop();
    if (!['id', 'literal'].includes(token.type) || !['=', ':'].includes(tokens[i + 1]?.value) || tokens[i + 2]?.type !== 'literal') continue;
    if (![';', ',', '}', undefined].includes(tokens[i + 3]?.value)) continue;
    // Vendor page/term objects contain defaults later overwritten by loadConfig.
    // Only actual top-level assignments and explicit configuration objects count.
    const explicitConfig = token.depth === 1 && !token.round && !token.square && ['config', 'pageConfig', 'portalConfig'].includes(stack[0]);
    if (token.depth === 1 && stack[0] === 'page' && token.value === 'name' && tokens[i + 2].value) add('programIndex', tokens[i + 2].value);
    if (token.depth !== 0 && !explicitConfig) continue;
    if (!explicitConfig && !independentAssignment(tokens, i)) continue;
    const name = token.value, value = tokens[i + 2].value;
    if (Object.hasOwn(ALIASES, name)) add(ALIASES[name], value);
    if (['v46ip', 'ss5', 'v4ip', 'ss4', 'vlanid', 'carrier'].includes(name)) add(name, value);
  }
  return { values, literals };
}
function mergedStatic(parts) {
  const values = new Map(), literals = [];
  for (const part of parts) {
    literals.push(...part.literals);
    for (const [key, list] of part.values) {
      if (!values.has(key)) values.set(key, new Set());
      for (const item of list) values.get(key).add(item);
    }
  }
  return { values, literals };
}
function single(parsed, key, evidence = []) {
  const values = parsed.values.get(key);
  if (!values?.size) return undefined;
  if (values.size !== 1) failure(`认证配置 ${key} 存在冲突。`, evidence);
  return [...values][0];
}
function scalar(value) { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
function configValues(data) {
  const result = {};
  for (const [key, alias] of Object.entries(ALIASES)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = scalar(data[key]);
    if (value === undefined || value.length > 500 || /[\u0000-\u001f]/.test(value)) failure(`服务器配置 ${key} 无效。`);
    if (Object.hasOwn(result, alias) && result[alias] !== value) failure(`服务器配置 ${key} 存在冲突。`);
    result[alias] = value;
  }
  return result;
}
function checkBlockers(parsed, config = {}, evidence = []) {
  for (const key of BLOCKERS) {
    const staticValue = single(parsed, key, evidence), current = config[key];
    // Global transport encryption cannot be disabled by a loadConfig override.
    const values = ['dataEncrypt', 'apg', 'portMode'].includes(key) ? [staticValue, current] : [current ?? staticValue];
    if (values.some(value => value !== undefined && value !== '0')) failure(`当前门户启用了尚未支持的 ${key} 认证分支，未提交账号密码。`, evidence, true);
  }
}
function validPort(value, evidence) {
  if (!/^\d{1,5}$/.test(String(value ?? '')) || Number(value) < 1 || Number(value) > 65535) failure('未能确认认证接口端口。请填写接口端口后重试。', evidence);
  return Number(value);
}
function htmlOptions(html, operatorMode) {
  const options = [];
  let selected;
  const append = (label, value, chosen) => {
    if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f]/.test(value) || value === '-1') return;
    label = entities(label.replace(/<[^>]*>/g, '')).trim().slice(0, 80);
    if (!label) label = value || '校园网';
    if (!options.some(item => item.value === value)) options.push({ label, value });
    if (chosen) { if (selected !== undefined && selected !== value) failure('运营商默认选项存在冲突。'); selected = value; }
  };
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attr = attributes(match[1]);
    if (!['ISP_select', 'R3'].includes(attr.name)) continue;
    for (const option of match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const attr = attributes(option[1]);
      append(option[2], attr.value, /\bselected(?:\s|=|$)/i.test(option[1]));
    }
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attr = attributes(match[1]);
    if (!(attr.type === 'radio' && ['network', 'R3'].includes(attr.name))) continue;
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 160);
    append(after.split(/<input|<br|<\/label|<\/div/i)[0], attr.value, /\bchecked(?:\s|=|$)/i.test(match[1]));
  }
  if (options.length > 20) failure('运营商选项过多。');
  if (operatorMode === 'suffix' && options.some(item => item.value && !/^@[A-Za-z0-9._-]{1,80}$/.test(item.value))) failure('运营商选项不符合账号后缀格式，无法安全自动识别。');
  return { options, selected };
}

async function detectDrcom(profile, context = {}, requester = portalRequest) {
  const parameters = context.parameters || {}, evidence = [], deadline = Date.now() + MAX_DURATION;
  const cacheKey = JSON.stringify([profile.id || '', profile.homepage, profile.portalDiscovery?.url || '',
    parameters.portalUrl || '', parameters.apiPort || '', parameters.accountPrefix || 'auto']);
  let totalBytes = 0;
  const read = async (url, options = {}, timeout = 5000) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) failure('自动识别已达到 30 秒时限。', evidence);
    const body = await requester(url, options, Math.max(1, Math.min(timeout, 5000, remaining)));
    if (typeof body !== 'string') failure('认证服务器响应无效。', evidence);
    totalBytes += Buffer.byteLength(body, 'utf8');
    if (totalBytes > MAX_BYTES) failure('自动识别读取内容超过 2 MiB。', evidence);
    return body;
  };
  const get = async (url, allowRedirect = false) => {
    let metadata = { status: 200, location: '' };
    const body = await read(url, { method: 'GET', allowRedirect, headers: { Accept: '*/*', 'Cache-Control': 'no-cache' }, onResponse: info => { metadata = info; } });
    if (metadata.status >= 300 && metadata.status < 400 && allowRedirect) return { ...metadata, body };
    if (!Number.isInteger(metadata.status) || metadata.status < 200 || metadata.status >= 300) failure('认证服务器返回非成功状态，无法确认配置。', evidence);
    return { ...metadata, body };
  };

  let entry;
  if (parameters.portalUrl?.trim()) entry = safeEntry(parameters.portalUrl.trim());
  else {
    const found = await discoverPortal({ ...profile, protocol: 'drcom-eportal', portalDiscovery: { url: profile.portalDiscovery?.url || profile.homepage } }, read);
    const previous = confirmedEntries.get(cacheKey);
    if (found) entry = safeEntry(found.entryUrl);
    else if (previous) entry = safeEntry(previous.url);
    else failure('未发现 Dr.COM 认证页，请连接校园网或填写浏览器中的认证页地址。');
  }
  let current = entry, body = '', visited = new Set();
  const origin = entry.origin;
  for (let hop = 0; hop < 6; hop++) {
    if (visited.has(current.href)) failure('认证页发生循环跳转。');
    visited.add(current.href);
    const response = await get(current, true);
    if (response.status >= 300 && response.status < 400) { current = safeEntry(response.location, current, origin); continue; }
    body = response.body;
    if (recognizedPage(body)) break;
    const target = htmlTarget(body);
    if (!target) failure('当前页面不是可识别的 Dr.COM 认证页。');
    current = safeEntry(target, current, origin);
  }
  if (!recognizedPage(body)) failure('认证页跳转次数过多。');
  evidence.push(`认证页 ${current.origin}${current.pathname}`);
  if (/<input\b[^>]*name\s*=\s*["']?(?:captcha|verifycode|validcode)(?:["'\s>])/i.test(body)) failure('认证页要求验证码，未提交账号密码。', evidence, true);

  const parts = [], queue = [], seenScripts = new Set();
  for (const tag of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attr = attributes(tag[1]);
    if (attr.src) queue.push(attr.src);
    else parts.push(parseStatic(tag[2]));
  }
  const addReferencedScripts = parsed => {
    for (const literal of parsed.literals) if (/^(?:\.?\/?[^\s?#]*)?a4[0-4]\.js(?:\?[^\s#]*)?$/i.test(literal)) queue.push(literal);
  };
  for (const part of parts) addReferencedScripts(part);
  while (queue.length) {
    const candidate = queue.shift(); let url;
    try { url = safeEntry(candidate, current, origin); } catch { continue; }
    if (!/\.js$/i.test(url.pathname) || seenScripts.has(url.href)) continue;
    if (seenScripts.size >= MAX_SCRIPTS) failure('认证页引用的脚本过多，无法在识别预算内完成。', evidence);
    seenScripts.add(url.href);
    const script = (await get(url)).body;
    const parsed = parseStatic(script); parts.push(parsed); addReferencedScripts(parsed);
    checkBlockers(mergedStatic(parts), {}, evidence);
  }
  const parsed = mergedStatic(parts);
  checkBlockers(parsed, {}, evidence);
  const domain = single(parsed, 'domain');
  if (domain && domain.toLowerCase() !== current.hostname.toLowerCase()) failure('门户要求切换认证域名；请先用浏览器打开学校认证页，将最终地址填入通用方案。', evidence);
  const httpsMode = single(parsed, 'httpsMode');
  if (httpsMode === '1' && current.protocol !== 'https:') failure('门户要求 HTTPS，请填写浏览器最终显示的 HTTPS 认证页地址。', evidence);

  const device = { ip: '', mac: '', acIp: '', acName: '' };
  for (const [key, names] of Object.entries({ ip: ['userip', 'wlanuserip', 'wlan_user_ip', 'ip'], mac: ['mac', 'wlan_user_mac'], acIp: ['wlanacip', 'wlan_ac_ip', 'nasip'], acName: ['wlanacname', 'wlan_ac_name'] })) {
    for (const name of names) { const value = current.searchParams.get(name) ?? entry.searchParams.get(name); if (value) { device[key] = value; break; } }
  }
  if (!device.ip) device.ip = single(parsed, 'v46ip') || single(parsed, 'ss5') || single(parsed, 'v4ip') || '';
  if (!device.mac) device.mac = single(parsed, 'ss4') || '';
  device.ip = device.ip.trim(); if (isIP(device.ip) !== 4) device.ip = '';
  device.mac = device.mac.replace(/[:-]/g, ''); if (!/^[a-f0-9]{12}$/i.test(device.mac)) device.mac = '';
  if (device.acIp && isIP(device.acIp) !== 4) failure('认证页中的 AC 地址无效。', evidence);
  if (device.acName.length > 200 || /[\u0000-\u001f]/.test(device.acName)) failure('认证页中的 AC 名称无效。', evidence);

  const endpointLiterals = parsed.literals.filter(value => /(?:\/eportal\/(?:portal\/)?|\/drcom\/)(?:login)?$|\/eportal\/\?c=Portal&a=login/i.test(value));
  const hasV4 = endpointLiterals.some(value => /\/eportal\/portal\/(?:login)?$/i.test(value));
  const hasLegacy = endpointLiterals.some(value => /\/eportal\/(?:\?c=Portal&a=login)?$/i.test(value));
  let portValue = parameters.apiPort?.trim() || single(parsed, current.protocol === 'https:' ? 'httpsPort' : 'httpPort');
  if (!portValue) {
    const ports = new Set();
    for (const literal of endpointLiterals) {
      if (!/^https?:\/\//.test(literal)) continue;
      const endpoint = new URL(literal);
      if (endpoint.hostname !== current.hostname || endpoint.protocol !== current.protocol) failure('认证脚本指定了不同的认证主机或协议，请核对最终认证页地址。', evidence);
      if (endpoint.port) ports.add(endpoint.port);
    }
    if (ports.size > 1) failure('认证脚本的接口端口存在冲突。', evidence);
    portValue = [...ports][0];
  }
  let config = {}, apiPort;
  const hasLoadConfig = parsed.literals.some(value => /(?:^|\/)page\/loadConfig$/.test(value));
  if (portValue !== undefined && (hasLoadConfig || hasV4)) {
    apiPort = validPort(portValue, evidence);
    const url = new URL('/eportal/portal/page/loadConfig', current); url.port = String(apiPort);
    url.search = new URLSearchParams({ callback: 'dr1001', program_index: single(parsed, 'programIndex') || '', wlan_vlan_id: single(parsed, 'vlanid') || '0',
      wlan_user_ip: Buffer.from(device.ip).toString('base64'), wlan_user_ipv6: '', wlan_user_ssid: '', wlan_user_areaid: '',
      wlan_ac_ip: Buffer.from(device.acIp).toString('base64'), wlan_ap_mac: '000000000000', gw_id: '000000000000', jsVersion: single(parsed, 'jsVersion') || '4.X' }).toString();
    const data = parseJsonOrJsonp((await get(url)).body);
    // Dr.COM getPageInfo explicitly treats code=0 as failure (a41.js).
    // Check both flags independently; a successful flag cannot mask rejection.
    const rejected = key => Object.hasOwn(data || {}, key) && !['1', 'ok', 'success'].includes(String(data[key]));
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.data || typeof data.data !== 'object' || Array.isArray(data.data) || rejected('code') || rejected('result')) failure('认证页面配置加载失败，未使用默认参数尝试登录。', evidence);
    config = configValues(data.data); evidence.push('已读取学校页面配置');
  }
  const value = key => config[key] ?? single(parsed, key, evidence);
  checkBlockers(parsed, config, evidence);
  if (value('md5') === undefined) failure('尚未确认学校密码编码方式，未提交账号密码。', evidence);
  const method = value('loginMethod');
  if (!['0', '1', '9'].includes(method)) failure('未能确认受支持的 Dr.COM 认证方式（0、1、9）。', evidence, method !== undefined);
  const mode = method === '0' ? 'web' : hasV4 ? 'v4' : hasLegacy ? 'legacy' : null;
  if (!mode) failure('尚未确认新版或旧版 ePortal 接口路径。', evidence);
  if (mode === 'web') apiPort = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
  else apiPort = validPort(parameters.apiPort?.trim() || value(current.protocol === 'https:' ? 'httpsPort' : 'httpPort') || portValue, evidence);
  evidence.push(`${mode} 接口端口 ${apiPort}`);
  let accountPrefix = '';
  const override = parameters.accountPrefix || 'auto';
  if (override !== 'auto') {
    accountPrefix = override === 'none' ? '' : override;
    if (!/^(?:,[a-z0-9],)?$/i.test(accountPrefix)) failure('账号前缀须为 none 或逗号包围的单个字母/数字，例如 ,0,。', evidence);
  } else if (mode !== 'web') {
    if (!['0', '1'].includes(value('accountPrefixFlag'))) failure('尚未确认账号前缀，请填写账号前缀后重试。', evidence);
    accountPrefix = value('accountPrefixFlag') === '1' ? ',0,' : '';
  }
  const enableR3 = value('enableR3');
  if (!['0', '1'].includes(enableR3)) failure('尚未确认运营商选项是账号后缀还是 R3 服务，未提交账号密码。', evidence);
  const operatorMode = enableR3 === '1' ? mode === 'web' ? 'r3' : null : 'suffix';
  if (!operatorMode) failure('门户使用运营商旁路扩展，当前通用方案不能自动组合参数。', evidence, true);
  const options = htmlOptions(body, operatorMode), suffixes = options.options;
  let defaultOperator = options.selected;
  if (operatorMode === 'suffix') {
    const suffix = value('accountSuffix');
    if (suffix !== undefined && suffix !== '' && !/^@[A-Za-z0-9._-]{1,80}$/.test(suffix)) failure('服务器账号后缀格式无效。', evidence);
    if (defaultOperator === undefined && suffix !== undefined) defaultOperator = suffix;
    if (defaultOperator === undefined && suffixes.length === 1) defaultOperator = suffixes[0].value;
    if (defaultOperator !== undefined && !suffixes.some(item => item.value === defaultOperator)) suffixes.push({ label: defaultOperator || '校园网', value: defaultOperator });
  } else if (defaultOperator === undefined) {
    if (suffixes.length === 1) defaultOperator = suffixes[0].value;
  }
  // Online pages may omit operator controls. Status/logout need only the
  // verified protocol; the login adapter must reject an unknown default.
  if (defaultOperator === undefined) defaultOperator = null;
  const jsVersion = value('jsVersion');
  if (typeof jsVersion !== 'string' || !/^\d+(?:\.[\dXx]+){1,3}$/.test(jsVersion)) failure('尚未确认门户 jsVersion 协议版本。', evidence);
  const loginParams = { login_method: method };
  for (const [key, alias] of Object.entries({ enable_r3: 'enableR3', program_index: 'programIndex', page_index: 'pageIndex', ac_logout: 'acLogout', register_mode: 'registerMode', lang: 'language' })) {
    if (value(alias) !== undefined) loginParams[key] = value(alias);
  }
  if (loginParams.lang !== undefined && !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(loginParams.lang)) failure('门户语言字段无效。', evidence);
  const vlan = single(parsed, 'vlanid'); if (vlan !== undefined && /^\d{1,4}$/.test(vlan) && Number(vlan) <= 4095) loginParams.wlan_vlan_id = vlan;
  evidence.push(accountPrefix ? '已确认账号前缀' : '账号不添加前缀');
  const cleanEntry = `${current.origin}${current.pathname}`;
  confirmedEntries.delete(cacheKey);
  if (confirmedEntries.size >= 32) confirmedEntries.delete(confirmedEntries.keys().next().value);
  // Keep only a bounded process-local entry path, with no device query or
  // configuration. Every use rereads the portal, including long online sessions.
  confirmedEntries.set(cacheKey, { url: cleanEntry });
  return { homepage: cleanEntry, entryUrl: current.href, mode, apiPort, accountPrefix, jsVersion, suffixes, operatorMode,
    defaultOperator, loginParams, device, evidence, logoutMode: mode === 'v4' ? 'v4' : 'drcom' };
}

module.exports = { detectDrcom, parseStatic };
