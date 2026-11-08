'use strict';

const MAX_PROFILE_BYTES = 64 * 1024;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const BASE_VARIABLES = ['username', 'password', 'ip', 'mac', 'acIp', 'acName'];
const DEFAULT_PORTAL_DISCOVERY_URL = 'http://www.msftconnecttest.com/redirect';
const DRCOM_EPORTAL_OPERATORS = ['telecom', 'cmcc', 'unicom', 'xyw', 'raw'];
const PROFILE_KEYS = ['schemaVersion', 'id', 'name', 'description', 'version', 'author', 'homepage', 'protocol', 'timeoutMs', 'fields', 'operations', 'ruijie', 'drcomEportal', 'drcomConfig', 'srun', 'portalDiscovery'];
const DRCOM_WIRE_KEYS = new Set(['callback', 'c', 'a', 'login_method', 'user_account', 'user_password', 'DDDDD', 'upass', '0MKKey', 'R1', 'R2', 'R3', 'R6', 'para', 'v4ip', 'v6ip', 'wlan_user_ip', 'wlan_user_ipv6', 'wlan_user_mac', 'wlan_ac_ip', 'wlan_ac_name', 'wlan_vlan_id', 'terminal_type', 'term_type', 'term_ua', 'jsVersion', 'v', 'lang', 'authex_enable', 'captcha', 'ac_logout', 'register_mode', 'program_index', 'page_index']);
const DRCOM_WIRE_VARIABLES = new Set(['account', 'password', 'ip', 'mac', 'acIp', 'acName', 'operator', 'nonce']);

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
  keys(value, ['discoveryUrl', 'redirectOrigins', 'publicKey', 'publicKeySource', 'passwordMode', 'passwordEncoding', 'serviceEncoding', 'passwordWithMac', 'serviceOptional', 'valueEncoding', 'queryEncoding'], 'ruijie');
  if (value.discoveryUrl !== undefined && safeUrl(value.discoveryUrl, '锐捷发现地址').origin !== homepage.origin) fail('锐捷发现地址必须与认证页同源');
  if (value.redirectOrigins !== undefined) {
    if (!Array.isArray(value.redirectOrigins) || value.redirectOrigins.length > 8) fail('锐捷跳转来源最多 8 项');
    for (const origin of value.redirectOrigins) {
      const parsed = safeUrl(origin, '锐捷跳转来源');
      if (origin !== parsed.origin) fail('锐捷跳转来源必须是完整 origin，不可包含路径、查询参数或尾部斜杠');
    }
    if (new Set(value.redirectOrigins).size !== value.redirectOrigins.length) fail('锐捷跳转来源不可重复');
  }
  if (value.publicKeySource !== undefined && !['static', 'page-info'].includes(value.publicKeySource)) fail('publicKeySource 必须为 static 或 page-info');
  if (value.passwordMode !== undefined && !['rsa', 'plain'].includes(value.passwordMode)) fail('passwordMode 必须为 rsa 或 plain');
  if (value.passwordEncoding !== undefined && !['legacy', 'utf8'].includes(value.passwordEncoding)) fail('passwordEncoding 必须为 legacy 或 utf8');
  if (value.passwordMode === 'plain' && (['publicKey', 'publicKeySource', 'passwordEncoding'].some(key => Object.hasOwn(value, key)) || value.passwordWithMac === true)) fail('明文锐捷方案不使用 RSA 公钥或密码变换配置');
  if (value.publicKeySource === 'page-info' && Object.hasOwn(value, 'publicKey')) fail('动态公钥方案不可同时声明静态 publicKey');
  if (value.passwordMode !== 'plain' && value.publicKeySource !== 'page-info') {
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
  }
  if (value.serviceEncoding !== undefined && !['plain', 'percent'].includes(value.serviceEncoding)) fail('serviceEncoding 必须为 plain 或 percent');
  if (value.passwordWithMac !== undefined && typeof value.passwordWithMac !== 'boolean') fail('passwordWithMac 必须为布尔值');
  if (value.serviceOptional !== undefined && typeof value.serviceOptional !== 'boolean') fail('serviceOptional 必须为布尔值');
  if (value.valueEncoding !== undefined && !['plain', 'percent'].includes(value.valueEncoding)) fail('valueEncoding 必须为 plain 或 percent');
  if (value.queryEncoding !== undefined && !['plain', 'percent', 'jmu', 'upc'].includes(value.queryEncoding)) fail('queryEncoding 必须为 plain / percent / jmu / upc');
  const service = fields?.find(field => field.key === 'service');
  if (value.serviceOptional === true) {
    if (service?.options?.some(option => !option.value.trim())) fail('锐捷服务名称不得为空');
  } else {
    if (!service || (service.default === undefined && !service.options)) fail('锐捷方案必须声明 service 字符串字段，并提供默认值或选项');
    if ((service.default !== undefined && !service.default.trim()) || service.options?.some(option => !option.value.trim())) fail('锐捷服务名称不得为空');
  }
}
function validateWireFields(fields, label, operation = 'login') {
  if (!Array.isArray(fields) || fields.length > 50) fail(`${label} 必须是最多 50 项的参数数组`);
  for (const field of fields) {
    keys(field, ['key', 'value'], label);
    if (!DRCOM_WIRE_KEYS.has(field.key)) fail(`${label} 包含不支持的参数`);
    validateTemplate(field.value, DRCOM_WIRE_VARIABLES, label);
    if (/[\u0000-\u001f\u007f]/.test(field.value)) fail(`${label} 包含无效控制字符`);
    if (field.key === 'c' && field.value !== 'Portal' || field.key === 'a' && field.value.toLowerCase() !== operation) fail('Dr.COM 操作参数与请求类型不一致');
    if (field.value.includes('{{password}}') && (operation !== 'login' || !['upass', 'user_password'].includes(field.key))) fail('密码只可用于登录密码字段');
    if (field.value.includes('{{account}}') && (operation !== 'login' || !['DDDDD', 'user_account'].includes(field.key))) fail('账号只可用于登录账号字段');
    if (operation !== 'login' && ['DDDDD', 'upass', 'user_account', 'user_password'].includes(field.key)) fail('状态与注销参数不发送账号密码');
    if (operation === 'status') {
      if (!['callback', 'jsVersion', 'v', 'lang'].includes(field.key)) fail('Dr.COM 状态查询仅支持元数据参数');
      validateTemplate(field.value, new Set(['nonce']), label);
    }
  }
}
function validateDrcomConfig(value) {
  keys(value, ['mode', 'apiPort', 'accountPrefix', 'jsVersion', 'operatorMode', 'operators', 'defaultOperator', 'loginFields', 'requireIp', 'macMode', 'statusMode', 'statusFields', 'logoutMode', 'logoutFields'], 'Dr.COM 学校参数');
  if (!['web', 'legacy', 'v4'].includes(value.mode)) fail('Dr.COM 认证方式无效');
  if (!Number.isInteger(value.apiPort) || value.apiPort < 1 || value.apiPort > 65535) fail('Dr.COM 接口端口无效');
  if (typeof value.accountPrefix !== 'string' || !/^(?:,[a-z0-9],)?$/i.test(value.accountPrefix)) fail('Dr.COM 账号前缀无效');
  if (typeof value.jsVersion !== 'string' || !/^[a-z0-9._-]{1,32}$/i.test(value.jsVersion)) fail('Dr.COM 状态协议版本无效');
  if (!['suffix', 'r3', 'none'].includes(value.operatorMode)) fail('Dr.COM 服务类型无效');
  if (!Array.isArray(value.operators) || value.operators.length > 20) fail('Dr.COM 服务最多 20 项');
  const seen = new Set();
  for (const operator of value.operators) {
    keys(operator, ['label', 'value'], 'Dr.COM 服务');
    string(operator.label, '服务名称', 80);
    if (typeof operator.value !== 'string' || operator.value.length > 100 || /[\u0000-\u0020]/.test(operator.value) || seen.has(operator.value)) fail('Dr.COM 服务值无效或重复');
    if (value.operatorMode === 'suffix' && operator.value && !/^@[a-z0-9._-]{1,80}$/i.test(operator.value)) fail('Dr.COM 账号后缀无效');
    seen.add(operator.value);
  }
  if (value.defaultOperator !== null && (typeof value.defaultOperator !== 'string' || value.operatorMode !== 'none' && !seen.has(value.defaultOperator))) fail('Dr.COM 默认服务无效');
  if (typeof value.requireIp !== 'boolean' || !['zero', 'portal'].includes(value.macMode) || !['result', 'identity'].includes(value.statusMode) || !['drcom', 'v4', 'legacy'].includes(value.logoutMode)) fail('Dr.COM 设备或状态设置无效');
  validateWireFields(value.loginFields, 'Dr.COM 登录参数');
  const accountKey = value.mode === 'web' ? 'DDDDD' : 'user_account';
  const passwordKey = value.mode === 'web' ? 'upass' : 'user_password';
  for (const [key, template] of [[accountKey, '{{account}}'], [passwordKey, '{{password}}']]) {
    const matches = value.loginFields.filter(field => field.key === key);
    if (matches.length !== 1 || matches[0].value !== template) fail('Dr.COM 登录须明确包含账号与密码模板');
  }
  if (value.logoutFields !== undefined) validateWireFields(value.logoutFields, 'Dr.COM 注销参数', 'logout');
  if (value.statusFields !== undefined) validateWireFields(value.statusFields, 'Dr.COM 状态参数', 'status');
}
function validateSrun(value, fields) {
  keys(value, ['acId', 'hmacMode', 'usernameSuffix'], '深澜配置');
  if (value.acId !== 'auto' && (typeof value.acId !== 'string' || !/^\d{1,6}$/.test(value.acId))) fail('深澜 acId 必须为数字字符串或 auto');
  if (!['empty', 'password'].includes(value.hmacMode)) fail('深澜 hmacMode 必须为 empty 或 password');
  if (value.usernameSuffix !== undefined && (typeof value.usernameSuffix !== 'string' || !/^@[a-z0-9._-]{1,80}$/i.test(value.usernameSuffix))) fail('深澜账号后缀无效');
  const suffix = fields?.find(field => field.key === 'suffix');
  if (suffix) {
    const values = [suffix.default, ...(suffix.options || []).map(option => option.value)].filter(item => item !== undefined);
    if (!values.length || values.some(item => item !== '' && !/^@[a-z0-9._-]{1,80}$/i.test(item))) fail('深澜服务后缀无效');
    if (value.usernameSuffix !== undefined) fail('深澜固定后缀与服务后缀只可设置一种');
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
  if (!['drcom', 'http', 'ruijie', 'drcom-eportal', 'drcom-auto', 'drcom-config', 'srun', 'sangfor'].includes(value.protocol)) fail('protocol 不在支持的认证类型之中');
  if (value.protocol !== 'drcom-config' && Object.hasOwn(value, 'drcomConfig')) fail('仅 Dr.COM 学校方案可声明 drcomConfig');
  if (value.protocol !== 'srun' && Object.hasOwn(value, 'srun')) fail('仅深澜方案可声明 srun');
  if (value.protocol !== 'ruijie' && Object.hasOwn(value, 'ruijie')) fail('仅锐捷方案可声明 ruijie 配置');
  if (Object.hasOwn(value, 'drcomEportal')) {
    if (value.protocol !== 'drcom-eportal') fail('仅 Dr.COM ePortal 方案可声明 drcomEportal 配置');
    keys(value.drcomEportal, ['variant', 'apiPort', 'dialect'], 'drcomEportal');
    if (value.drcomEportal.variant !== 'portal-v4') fail('drcomEportal.variant 必须为 portal-v4');
    if (!Number.isInteger(value.drcomEportal.apiPort) || value.drcomEportal.apiPort < 1 || value.drcomEportal.apiPort > 65535) fail('drcomEportal.apiPort 必须为 1–65535 的整数');
    if (value.drcomEportal.dialect !== undefined && value.drcomEportal.dialect !== 'cqu') fail('drcomEportal.dialect 仅支持 cqu');
  }
  if (Object.hasOwn(value, 'portalDiscovery')) {
    if (!['drcom', 'ruijie', 'drcom-eportal', 'drcom-auto', 'drcom-config'].includes(value.protocol)) fail('portalDiscovery 仅支持 drcom / ruijie / drcom-eportal / drcom-auto / drcom-config 方案');
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
  } else if (Object.hasOwn(value, 'operations')) fail('drcom / ruijie / drcom-eportal / drcom-auto 方案不允许覆写 operations 请求');
  if (value.protocol === 'drcom') {
    const operator = value.fields?.find(field => field.key === 'operator');
    if (operator) {
      if (operator.default === undefined && !operator.options) fail('Dr.COM operator 字段须提供默认值或选项');
      const values = [operator.default, ...(operator.options || []).map(option => option.value)].filter(item => item !== undefined);
      if (values.some(item => !item.trim() || /[\r\n\u0000]/.test(item))) fail('Dr.COM operator 默认值和选项必须为非空单行字符串');
    }
  }
  if (value.protocol === 'ruijie') validateRuijie(value.ruijie, homepage, value.fields);
  if (value.protocol === 'drcom-config') validateDrcomConfig(value.drcomConfig);
  if (value.protocol === 'srun') validateSrun(value.srun, value.fields);
  if (value.drcomEportal?.variant === 'portal-v4') {
    const operator = value.fields?.find(field => field.key === 'operator');
    if (value.drcomEportal.dialect === 'cqu' && operator) fail('重庆大学方案使用完整账号，不支持 operator 字段');
    if (operator) {
      if (operator.default === undefined && !operator.options) fail('Dr.COM ePortal operator 字段须提供默认值或选项');
      const values = [operator.default, ...(operator.options || []).map(option => option.value)].filter(item => item !== undefined);
      if (values.some(item => !DRCOM_EPORTAL_OPERATORS.includes(item))) fail('Dr.COM ePortal operator 仅支持 telecom / cmcc / unicom / xyw / raw');
    }
  }
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
    if (profile.drcomEportal?.variant === 'portal-v4' && field.key === 'operator' && !DRCOM_EPORTAL_OPERATORS.includes(value)) fail(`${field.label} 仅支持 telecom / cmcc / unicom / xyw / raw`);
    result[field.key] = value;
  }
  for (const key of Object.keys(input)) if (!(profile.fields || []).some(x => x.key === key)) fail('连接参数含有未声明字段');
  return result;
}

// NingMeng123 — one declarative catalog for desktop and browser preview.
const builtinProfiles = require('./builtin-profiles.json').map(profile => validateProfile(profile, { builtin: true }));
if (new Set(builtinProfiles.map(profile => profile.id)).size !== builtinProfiles.length) fail('内置方案 ID 不可重复');
const [builtinProfile, builtinRuijieProfile, builtinCdutYibinProfile, builtinJdztcProfile] = builtinProfiles;
module.exports = { MAX_PROFILE_BYTES, BASE_VARIABLES, DEFAULT_PORTAL_DISCOVERY_URL, builtinProfile, builtinRuijieProfile, builtinCdutYibinProfile, builtinJdztcProfile, builtinProfiles, validateProfile, parseProfile, publicProfile, exportProfile, exportProfileJson, profileParameters, safeUrl, keys };
