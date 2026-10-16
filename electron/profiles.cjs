'use strict';

const MAX_PROFILE_BYTES = 64 * 1024;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const BASE_VARIABLES = ['username', 'password', 'ip', 'mac', 'acIp', 'acName'];
const DEFAULT_PORTAL_DISCOVERY_URL = 'http://www.msftconnecttest.com/redirect';
const PROFILE_KEYS = ['schemaVersion', 'id', 'name', 'description', 'version', 'author', 'homepage', 'protocol', 'timeoutMs', 'fields', 'operations', 'ruijie', 'portalDiscovery'];

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`);
  for (const key of Object.keys(value)) if (RESERVED.has(key)) fail('配置含有不安全的属性');
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} 包含不支持的字段：${key}`);
}
function string(value, label, max = 500, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${label} 必须为有效字符串`);
}
function safeUrl(value, label = '网址') {
  string(value, label, 2048);
  let url;
  try { url = new URL(value); } catch { fail(`${label} 格式无效`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || value.includes('{{')) fail(`${label} 仅支持不含凭据的 HTTP / HTTPS 地址`);
  return url;
}
function validateTemplate(value, variables, label) {
  if (typeof value !== 'string' || value.length > 2048) fail(`${label} 必须是长度不超过 2048 的字符串`);
  const stripped = value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key) => {
    if (!variables.has(key)) fail(`${label} 使用了未声明的模板变量：${key}`);
    return '';
  });
  if (stripped.includes('{{') || stripped.includes('}}')) fail(`${label} 模板格式无效`);
}
function validateRule(rule) {
  keys(rule, ['type', 'path', 'equals', 'includes'], '判断规则');
  if (rule.type === 'json') {
    string(rule.path, 'JSON 路径', 200);
    if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(rule.path) || rule.path.split('.').some(x => RESERVED.has(x))) fail('JSON 路径无效');
    if (!Object.hasOwn(rule, 'equals') || !['string', 'number', 'boolean'].includes(typeof rule.equals) || (typeof rule.equals === 'string' && rule.equals.length > 500) || Object.hasOwn(rule, 'includes')) fail('JSON 判断需要 equals 标量值');
  } else if (rule.type === 'text') {
    string(rule.includes, '文本判断', 500);
    if (Object.hasOwn(rule, 'path') || Object.hasOwn(rule, 'equals')) fail('文本判断仅支持 includes');
  } else fail('判断规则 type 必须为 json 或 text');
}
function validateOperation(op, name, origin, variables) {
  keys(op, ['url', 'method', 'encoding', 'headers', 'data', 'success', 'failure'], `${name} 请求`);
  const endpoint = safeUrl(op.url, `${name} 请求地址`);
  if (endpoint.origin !== origin) fail('HTTP 请求必须与认证页使用相同源（协议、主机和端口）');
  if (!['GET', 'POST'].includes(op.method)) fail('仅支持 GET / POST 请求');
  if (name === 'status' && op.method !== 'GET') fail('状态查询必须是只读 GET 请求');
  if (!['form', 'json'].includes(op.encoding)) fail('encoding 必须为 form 或 json');
  if (op.method === 'GET' && op.encoding !== 'form') fail('GET 请求使用 form 查询参数编码');
  if (op.headers !== undefined) {
    object(op.headers, '请求头');
    for (const [key, val] of Object.entries(op.headers)) {
      if (!['accept', 'x-requested-with'].includes(key.toLowerCase()) || typeof val !== 'string' || val.length > 300 || /[\r\n]/.test(val)) fail('仅支持 Accept / X-Requested-With 请求头');
    }
  }
  object(op.data, '请求参数');
  if (Object.keys(op.data).length > 50) fail('请求参数过多');
  for (const [key, value] of Object.entries(op.data)) {
    string(key, '参数名', 100);
    validateTemplate(value, variables, `参数 ${key}`);
    if (name === 'status' && value.includes('{{password}}')) fail('状态查询不得包含密码');
  }
  validateRule(op.success);
  validateRule(op.failure);
  if (JSON.stringify(op.success) === JSON.stringify(op.failure)) fail('成功与失败判断不可相同');
}
function validateRuijie(value, homepage, fields) {
  keys(value, ['discoveryUrl', 'redirectOrigins', 'publicKey', 'serviceEncoding', 'passwordWithMac', 'serviceOptional', 'valueEncoding'], 'ruijie');
  if (value.discoveryUrl !== undefined && safeUrl(value.discoveryUrl, '锐捷发现地址').origin !== homepage.origin) fail('锐捷发现地址必须与认证页同源');
  if (value.redirectOrigins !== undefined) {
    if (!Array.isArray(value.redirectOrigins) || value.redirectOrigins.length > 8) fail('锐捷跳转来源最多 8 项');
    for (const origin of value.redirectOrigins) {
      const parsed = safeUrl(origin, '锐捷跳转来源');
      if (origin !== parsed.origin) fail('锐捷跳转来源必须是完整 origin，不可包含路径、查询参数或尾部斜杠');
    }
    if (new Set(value.redirectOrigins).size !== value.redirectOrigins.length) fail('锐捷跳转来源不可重复');
  }
  keys(value.publicKey, ['modulus', 'exponent'], '锐捷 RSA 公钥');
  const { modulus, exponent } = value.publicKey;
  // Bound input before BigInt conversion: imported files must not create expensive integers.
  if (typeof modulus !== 'string' || modulus.length > 1024 || !/^[0-9a-f]+$/i.test(modulus)) fail('RSA 模数必须为不超过 1024 位的十六进制字符串');
  const modulusValue = BigInt(`0x${modulus}`);
  const bits = modulusValue.toString(2).length;
  if (bits < 512 || bits > 4096 || modulusValue % 2n !== 1n) fail('RSA 模数必须为 512–4096 bit 的奇数');
  if (typeof exponent !== 'string' || exponent.length > 8 || !/^[0-9a-f]+$/i.test(exponent)) fail('RSA 指数必须为不超过 8 位的十六进制字符串');
  const exponentValue = BigInt(`0x${exponent}`);
  if (exponentValue < 3n || exponentValue > 0xffffffffn || exponentValue % 2n !== 1n) fail('RSA 指数必须为 3–0xffffffff 的奇数');
  if (value.serviceEncoding !== undefined && !['plain', 'percent'].includes(value.serviceEncoding)) fail('serviceEncoding 必须为 plain 或 percent');
  if (value.passwordWithMac !== undefined && typeof value.passwordWithMac !== 'boolean') fail('passwordWithMac 必须为布尔值');
  if (value.serviceOptional !== undefined && typeof value.serviceOptional !== 'boolean') fail('serviceOptional 必须为布尔值');
  if (value.valueEncoding !== undefined && !['plain', 'percent'].includes(value.valueEncoding)) fail('valueEncoding 必须为 plain 或 percent');
  const service = fields?.find(field => field.key === 'service');
  if (value.serviceOptional === true) {
    if (service?.options?.some(option => !option.value.trim())) fail('锐捷服务名称不得为空');
  } else {
    if (!service || (service.default === undefined && !service.options)) fail('锐捷方案必须声明 service 字符串字段，并提供默认值或选项');
    if ((service.default !== undefined && !service.default.trim()) || service.options?.some(option => !option.value.trim())) fail('锐捷服务名称不得为空');
  }
}
function validateProfile(value, { builtin = false } = {}) {
  keys(value, PROFILE_KEYS, '连接方案');
  if (value.schemaVersion !== 1) fail('仅支持 schemaVersion: 1');
  string(value.id, '方案 ID', 64);
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(value.id) || (!builtin && value.id.startsWith('builtin-'))) fail('方案 ID 必须为小写字母、数字和连字符，且不能占用 builtin- 前缀');
  string(value.name, '方案名称', 80);
  string(value.description, '说明', 800, true);
  string(value.version, '版本', 32);
  string(value.author, '作者', 80, true);
  const homepage = safeUrl(value.homepage, '认证页地址');
  if (!['drcom', 'http', 'ruijie'].includes(value.protocol)) fail('protocol 仅支持 drcom / http / ruijie');
  if (value.protocol !== 'ruijie' && Object.hasOwn(value, 'ruijie')) fail('仅锐捷方案可声明 ruijie 配置');
  if (Object.hasOwn(value, 'portalDiscovery')) {
    if (!['drcom', 'ruijie'].includes(value.protocol)) fail('portalDiscovery 仅支持 drcom / ruijie 方案');
    keys(value.portalDiscovery, ['url'], '认证页自动发现');
    safeUrl(value.portalDiscovery.url, '认证页发现地址');
  }
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 30000)) fail('timeoutMs 必须在 1000–30000 毫秒之间');
  const variables = new Set(BASE_VARIABLES);
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 12) fail('fields 最多 12 项');
    const seen = new Set();
    for (const field of value.fields) {
      keys(field, ['key', 'label', 'default', 'placeholder', 'options'], '自定义字段');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(field.key) || RESERVED.has(field.key) || ['username', 'password'].includes(field.key) || seen.has(field.key)) fail('自定义字段 key 无效或重复');
      seen.add(field.key); variables.add(field.key);
      string(field.label, '字段名称', 80);
      if (field.default !== undefined && (typeof field.default !== 'string' || field.default.length > 500)) fail('字段默认值无效');
      string(field.placeholder, '字段提示', 160, true);
      if (field.options !== undefined) {
        if (!Array.isArray(field.options) || !field.options.length || field.options.length > 20) fail('选项数量必须为 1–20');
        for (const option of field.options) {
          keys(option, ['label', 'value'], '字段选项');
          string(option.label, '选项名称', 80);
          if (typeof option.value !== 'string' || option.value.length > 100) fail('选项值无效');
        }
        if (field.default !== undefined && !field.options.some(x => x.value === field.default)) fail('默认值必须在选项之中');
      }
    }
  }
  if (value.protocol === 'http') {
    keys(value.operations, ['login', 'logout', 'status'], 'operations');
    for (const name of ['login', 'logout', 'status']) if (!value.operations[name]) fail(`缺少 ${name} 请求；v1 方案须完整提供登录、注销与只读状态查询`);
    for (const name of Object.keys(value.operations)) validateOperation(value.operations[name], name, homepage.origin, variables);
  } else if (Object.hasOwn(value, 'operations')) fail('drcom / ruijie 方案不允许覆写 operations 请求');
  if (value.protocol === 'drcom') {
    const operator = value.fields?.find(field => field.key === 'operator');
    if (operator) {
      if (operator.default === undefined && !operator.options) fail('Dr.COM operator 字段须提供默认值或选项');
      const values = [operator.default, ...(operator.options || []).map(option => option.value)].filter(item => item !== undefined);
      if (values.some(item => !item.trim() || /[\r\n\u0000]/.test(item))) fail('Dr.COM operator 默认值和选项必须为非空单行字符串');
    }
  }
  if (value.protocol === 'ruijie') validateRuijie(value.ruijie, homepage, value.fields);
  const result = JSON.parse(JSON.stringify(value));
  if (result.protocol === 'ruijie') {
    result.ruijie.discoveryUrl ??= result.homepage;
    result.ruijie.redirectOrigins ??= [];
    result.ruijie.serviceEncoding ??= 'plain';
  }
  return result;
}
function parseProfile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) fail('连接方案文件不能超过 64 KB');
  let value;
  try { value = JSON.parse(text); } catch { fail('连接方案必须是有效 JSON 文件'); }
  return validateProfile(value);
}
function publicProfile(profile, builtin = false) {
  const { id, name, description = '', version, author = '', homepage, protocol, fields = [], portalDiscovery } = profile;
  return { id, name, description, version, author, homepage, protocol, fields, builtin, ...(portalDiscovery ? { portalDiscovery } : {}) };
}
function exportProfile(profile) {
  // Export the stored definition, never a connection snapshot or a resolved
  // portal profile: runtime endpoints and credentials are not configuration.
  object(profile, '连接方案');
  const result = Object.fromEntries(PROFILE_KEYS.filter(key => Object.hasOwn(profile, key)).map(key => [key, profile[key]]));
  if (typeof result.id === 'string' && result.id.startsWith('builtin-')) {
    const base = result.id.slice('builtin-'.length);
    result.id = `${/^[a-z]/.test(base) ? base : `campus-${base}`}`.slice(0, 59) + '-copy';
  }
  // The import parser provides a deep copy, enforces the 64 KB limit and keeps
  // the exported Dr.COM, HTTP and ePortal definitions directly importable.
  return parseProfile(JSON.stringify(result));
}
function exportProfileJson(profile) {
  const portable = exportProfile(profile);
  const readable = `${JSON.stringify(portable, null, 2)}\n`;
  // Whitespace counts toward the import limit. Preserve a valid near-limit
  // definition by falling back to compact JSON rather than exporting a file
  // which this application cannot import again.
  return Buffer.byteLength(readable, 'utf8') <= MAX_PROFILE_BYTES ? readable : JSON.stringify(portable);
}
function profileParameters(profile, input = {}) {
  object(input, '连接参数');
  const result = {};
  for (const field of profile.fields || []) {
    const value = input[field.key] ?? field.default ?? field.options?.[0]?.value ?? '';
    if (typeof value !== 'string' || value.length > 500 || /[\r\n\u0000]/.test(value)) fail(`${field.label} 无效`);
    if (field.options && !field.options.some(x => x.value === value)) fail(`${field.label} 不在可选范围内`);
    result[field.key] = value;
  }
  for (const key of Object.keys(input)) if (!(profile.fields || []).some(x => x.key === key)) fail('连接参数含有未声明字段');
  return result;
}

const builtinProfile = validateProfile({
  schemaVersion: 1,
  id: 'builtin-gzqy',
  name: '贵州轻工职业大学',
  description: '内置 Dr.COM 校园网认证 · 请先连接校园 Wi-Fi 或有线网络',
  version: '1.0.0', author: 'NingMeng123', homepage: 'http://10.151.253.10/',
  protocol: 'drcom', timeoutMs: 10000,
  portalDiscovery: { url: DEFAULT_PORTAL_DISCOVERY_URL },
  fields: [{ key: 'operator', label: '网络类型', default: '1', options: [{ label: '校园网', value: '1' }] }],
}, { builtin: true });

const builtinRuijieProfile = validateProfile({
  schemaVersion: 1,
  id: 'builtin-scu-ruijie',
  name: '四川大学 · 锐捷 ePortal',
  description: '参考四川大学锐捷 ePortal 认证流程；请先连接对应校园网络，并选择账号开通的服务。其他学校请导入匹配的锐捷方案。',
  version: '1.0.0', author: 'NingMeng123', homepage: 'http://192.168.2.135/',
  protocol: 'ruijie', timeoutMs: 10000,
  portalDiscovery: { url: DEFAULT_PORTAL_DISCOVERY_URL },
  fields: [{ key: 'service', label: '网络服务', default: 'internet', options: [
    { label: '校园网（internet）', value: 'internet' },
    { label: '电信出口', value: '电信出口' },
    { label: '移动出口', value: '移动出口' },
    { label: '联通出口', value: '联通出口' },
  ] }],
  ruijie: {
    discoveryUrl: 'http://192.168.2.135/',
    redirectOrigins: ['http://123.123.123.123'],
    publicKey: {
      modulus: '94dd2a8675fb779e6b9f7103698634cd400f27a154afa67af6166a43fc26417222a79506d34cacc7641946abda1785b7acf9910ad6a0978c91ec84d40b71d2891379af19ffb333e7517e390bd26ac312fe940c340466b4a5d4af1d65c3b5944078f96a1a51a5a53e4bc302818b7c9f63c4a1b07bd7d874cef1c3d4b2f5eb7871',
      exponent: '10001',
    },
    serviceEncoding: 'percent',
  },
}, { builtin: true });

// Verified 2026-10-16 against a real capture and the live portal of
// 成都理工大学（宜宾校区）: same default 1024-bit Ruijie RSA key and the same
// `password>mac` RSA input as SCU, but the portal submits an empty service
// and double-encodes the account and query string in the login form.
const builtinCdutYibinProfile = validateProfile({
  schemaVersion: 1,
  id: 'builtin-cdut-yibin-ruijie',
  name: '成都理工大学（宜宾校区）· 锐捷 ePortal',
  description: '成都理工大学宜宾校区锐捷 ePortal 认证（2026-10-16 依据真实抓包核验）；请先连接 CDUTYB-WEB 无线或校园有线网络。登录不选择网络服务，使用学校统一认证账号。',
  version: '1.0.0', author: 'NingMeng123', homepage: 'http://10.26.30.253/',
  protocol: 'ruijie', timeoutMs: 10000,
  portalDiscovery: { url: DEFAULT_PORTAL_DISCOVERY_URL },
  ruijie: {
    discoveryUrl: 'http://10.26.30.253/',
    redirectOrigins: [],
    publicKey: {
      modulus: '94dd2a8675fb779e6b9f7103698634cd400f27a154afa67af6166a43fc26417222a79506d34cacc7641946abda1785b7acf9910ad6a0978c91ec84d40b71d2891379af19ffb333e7517e390bd26ac312fe940c340466b4a5d4af1d65c3b5944078f96a1a51a5a53e4bc302818b7c9f63c4a1b07bd7d874cef1c3d4b2f5eb7871',
      exponent: '10001',
    },
    serviceOptional: true,
    valueEncoding: 'percent',
  },
}, { builtin: true });

const builtinProfiles = [builtinProfile, builtinRuijieProfile, builtinCdutYibinProfile];
module.exports = { MAX_PROFILE_BYTES, BASE_VARIABLES, DEFAULT_PORTAL_DISCOVERY_URL, builtinProfile, builtinRuijieProfile, builtinCdutYibinProfile, builtinProfiles, validateProfile, parseProfile, publicProfile, exportProfile, exportProfileJson, profileParameters, safeUrl, keys };
