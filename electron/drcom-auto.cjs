'use strict';

// NingMeng123 — execute only the single Dr.COM dialect established by the
// read-only detector. Detection results and device identities remain in memory.
const { isIP } = require('node:net');
const { CampusError, parseJsonOrJsonp } = require('./transport.cjs');
const { portalRequest } = require('./portal-transport.cjs');
const { htmlTarget } = require('./ruijie.cjs');
const { sanitizeText } = require('./diagnostics.cjs');

const STATIC_FIELDS = new Set(['login_method', 'enable_r3', 'wlan_vlan_id', 'program_index', 'page_index', 'ac_logout', 'register_mode', 'lang']);
const WIRE_FIELDS = new Set(['callback', 'c', 'a', 'login_method', 'user_account', 'user_password', 'DDDDD', 'upass', '0MKKey', 'R1', 'R2', 'R3', 'R6', 'para', 'v4ip', 'v6ip', 'wlan_user_ip', 'wlan_user_ipv6', 'wlan_user_mac', 'wlan_ac_ip', 'wlan_ac_name', 'wlan_vlan_id', 'terminal_type', 'term_type', 'term_ua', 'jsVersion', 'v', 'lang', 'program_index', 'page_index', 'authex_enable', 'captcha', 'ac_logout', 'register_mode']);
const WIRE_VARIABLES = new Set(['account', 'password', 'ip', 'mac', 'acIp', 'acName', 'operator', 'nonce']);
const CARRIERS = {
  campus: /校园|校内|学生内网|教育网|campus|cernet/i,
  office: /办公网|教工网|教职工网/i,
  telecom: /电信|telecom|ctcc|chinanet/i,
  cmcc: /移动|cmcc|cmnet/i,
  unicom: /联通|unicom|cucc/i,
};
const validIp = value => typeof value === 'string' && isIP(value) === 4 && !['0.0.0.0', '255.255.255.255'].includes(value);
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function apiUrl(base, path, entries = []) {
  const url = new URL(path, base);
  url.search = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return url;
}

function pageStatus(body) {
  const html = String(body).replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  if (!/<html(?:\s|>)/i.test(html)) throw new CampusError('认证页没有明确在线状态，请打开认证页确认。', 'UNKNOWN_RESPONSE');
  const markers = [...html.matchAll(/<!--\s*Dr\.COMWebLoginID_(\d+)\.htm\s*-->/g)];
  if (markers.length !== 1 || !['0', '1', '2', '3'].includes(markers[0][1])) throw new CampusError('认证页状态标记缺失或冲突，请打开认证页确认。', 'UNKNOWN_RESPONSE');
  return ['1', '3'].includes(markers[0][1]);
}

function accepted(data) {
  if (!object(data)) throw new CampusError('认证接口返回了无法识别的结果。', 'INVALID_RESPONSE');
  const flags = [];
  if (Object.hasOwn(data, 'result')) {
    if ([1, '1', 'ok'].includes(data.result)) flags.push(true);
    else if ([0, '0', 'fail', 'failed', 'error'].includes(data.result)) flags.push(false);
    else throw new CampusError('认证接口的结果未知，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  }
  for (const key of ['resCode', 'rescode']) {
    if (!Object.hasOwn(data, key)) continue;
    if (!(typeof data[key] === 'number' && Number.isInteger(data[key])) && !(typeof data[key] === 'string' && /^-?\d+$/.test(data[key]))) throw new CampusError('认证接口的结果未知，请打开认证页检查。', 'UNKNOWN_RESPONSE');
    flags.push(Number(data[key]) === 0);
  }
  if (!flags.length) throw new CampusError('认证接口缺少结果字段，请打开认证页检查。', 'UNKNOWN_RESPONSE');
  if (flags.includes(true) && flags.includes(false)) throw new CampusError('认证接口的成功与失败结果相互矛盾。', 'AMBIGUOUS_RESPONSE');
  return flags[0];
}

function operatorValue(detected, selected, username) {
  if (detected.loginFields && detected.suffixes.some(option => option.value === selected)) return selected;
  if (!['auto', 'raw', 'campus', 'office', 'telecom', 'cmcc', 'unicom'].includes(selected)) throw new CampusError('请选择支持的运营商或完整账号模式。', 'INVALID_PARAMETERS');
  if (detected.operatorMode === 'none') {
    if (!['auto', 'raw', 'campus'].includes(selected)) throw new CampusError('页面没有提供所选运营商，请选择自动或完整账号模式。', 'OPERATOR_UNKNOWN');
    return '';
  }
  if (detected.operatorMode === 'suffix' && selected === 'raw') return '';
  if (selected === 'raw') throw new CampusError('当前页面通过 R3 选择服务，请选择运营商或自动模式。', 'OPERATOR_UNKNOWN');
  const options = detected.suffixes;
  let candidates;
  if (selected === 'auto' && detected.operatorMode === 'suffix' && username.includes('@')) {
    candidates = options.filter(option => option.value && username.toLowerCase().endsWith(option.value.toLowerCase()));
  } else if (selected === 'auto') {
    if (detected.defaultOperator === null) throw new CampusError('认证页未提供默认运营商，请选择已开通的运营商或完整账号模式。', 'OPERATOR_UNKNOWN');
    candidates = options.filter(option => option.value === detected.defaultOperator);
    if (!candidates.length && options.length === 1) candidates = options;
  } else {
    candidates = options.filter(option => CARRIERS[selected].test(option.label) || CARRIERS[selected].test(option.value));
  }
  const values = [...new Set(candidates.map(option => option.value))];
  if (values.length !== 1) throw new CampusError('无法唯一确定所选运营商，请先在认证页核对服务；完整账号可选择“其他 / 完整账号”。', 'OPERATOR_UNKNOWN');
  return values[0];
}

function renderWireFields(fields, variables, operation) {
  if (!Array.isArray(fields) || fields.length > 50 || operation === 'login' && fields.length === 0) throw new CampusError('声明式认证字段不完整。', 'INVALID_PROFILE');
  return fields.map(field => {
    if (!object(field) || !WIRE_FIELDS.has(field.key) || typeof field.value !== 'string' || field.value.length > 2048 || /[\u0000-\u001f\u007f]/.test(field.value)) throw new CampusError('声明式认证字段无效。', 'INVALID_PROFILE');
    if (operation === 'logout' && (['DDDDD', 'upass', 'user_account', 'user_password'].includes(field.key) || /\{\{(?:password|account)\}\}/.test(field.value))) throw new CampusError('注销不得提交账号密码。', 'INVALID_PROFILE');
    if (operation === 'status' && (!['callback', 'jsVersion', 'v', 'lang'].includes(field.key) || /\{\{(?!nonce\}\})/.test(field.value))) throw new CampusError('状态查询只能声明只读元数据。', 'INVALID_PROFILE');
    const pattern = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
    const templateText = field.value.replace(pattern, (_match, name) => {
      if (!WIRE_VARIABLES.has(name)) throw new CampusError('声明式认证字段含未知变量。', 'INVALID_PROFILE');
      return '';
    });
    if (templateText.includes('{{') || templateText.includes('}}')) throw new CampusError('声明式认证字段模板无效。', 'INVALID_PROFILE');
    const value = field.value.replace(pattern, (_match, name) => String(variables[name] ?? ''));
    if (field.key === 'c' && value !== 'Portal' || field.key === 'a' && value.toLowerCase() !== operation) throw new CampusError('声明式认证操作字段无效。', 'INVALID_PROFILE');
    return [field.key, value];
  });
}

async function drcomAutoOperation(profile, operation, context = {}, requester = portalRequest, registerSecret = () => {}, detector = require('./drcom-detect.cjs').detectDrcom) {
  if (!['login', 'logout', 'status'].includes(operation)) throw new CampusError('不支持的 Dr.COM 操作。', 'UNSUPPORTED_OPERATION');
  const secrets = [];
  const remember = value => {
    if (typeof value === 'string' && value && !secrets.includes(value)) { secrets.push(value); registerSecret(value); }
  };
  remember(context.username); remember(context.password);
  const observe = (url, options = {}, timeout = profile.timeoutMs || 10000) => requester(url, {
    ...options, diagnosticSecrets: [...new Set([...secrets, ...(options.diagnosticSecrets || [])])],
  }, timeout);
  let summary = '';
  try {
    const detected = await detector(profile, context, observe);
    if (!object(detected) || !['web', 'legacy', 'v4'].includes(detected.mode)
      || !['suffix', 'r3', 'none'].includes(detected.operatorMode)
      || !['drcom', 'v4', 'legacy'].includes(detected.logoutMode)
      || typeof detected.accountPrefix !== 'string' || !/^(?:,[a-z0-9],)?$/i.test(detected.accountPrefix)
      || typeof detected.jsVersion !== 'string' || !/^[a-z0-9._-]{1,32}$/i.test(detected.jsVersion)
      || !Number.isInteger(detected.apiPort) || detected.apiPort < 1 || detected.apiPort > 65535
      || !Array.isArray(detected.suffixes) || detected.suffixes.length > 20
      || detected.suffixes.some(option => !object(option) || typeof option.label !== 'string' || option.label.length > 100 || typeof option.value !== 'string' || option.value.length > 100 || /[\u0000-\u001f\u007f]/.test(option.value))
      || detected.defaultOperator !== null && typeof detected.defaultOperator !== 'string' || !object(detected.device) || !object(detected.loginParams)) {
      throw new CampusError('认证页面信息不足，请打开认证页核对协议、接口端口和账号前缀。', 'DRCOM_DETECTION_INCOMPLETE');
    }
    const homepage = new URL(detected.homepage);
    if (!['http:', 'https:'].includes(homepage.protocol) || homepage.username || homepage.password || homepage.hash) throw new CampusError('认证入口地址无效，请手动填写认证页地址。', 'DRCOM_DETECTION_INCOMPLETE');
    const origin = homepage.origin;
    const gateway = new URL('/', homepage);
    gateway.port = String(detected.apiPort);
    if (detected.loginFields !== undefined) renderWireFields(detected.loginFields, {}, 'login');
    if (detected.logoutFields !== undefined) renderWireFields(detected.logoutFields, {}, 'logout');
    if (detected.statusFields !== undefined) renderWireFields(detected.statusFields, {}, 'status');
    summary = `已识别 Dr.COM ${detected.mode === 'web' ? 'Web' : detected.mode === 'legacy' ? 'ePortal 旧版' : 'ePortal v4'}，接口端口 ${detected.mode === 'web' ? homepage.port || (homepage.protocol === 'https:' ? 443 : 80) : detected.apiPort}，账号前缀 ${detected.accountPrefix || '无'}`;
    for (const value of Object.values(detected.device)) remember(value);
    for (const [key, value] of Object.entries(detected.loginParams)) {
      if (!STATIC_FIELDS.has(key) || typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new CampusError('页面包含不支持的认证参数，请使用学校专用方案。', 'DRCOM_DETECTION_INCOMPLETE');
    }
    const safeLanding = value => {
      const url = new URL(value, homepage);
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { throw new CampusError('认证页跳转地址无效。', 'PORTAL_REDIRECT'); }
      if (url.origin !== origin || url.username || url.password || url.hash
        || /\/(?:login|logout|logoff|disconnect|bind|unbind|kick)(?:\/|\.|$)|^\/F\.htm$/i.test(path)
        || /^\/eportal\/portal\//i.test(path) && !/^\/eportal\/portal\/page\/loadConfig\/?$/i.test(path)
        || [...url.searchParams].some(([key, val]) => /(?:password|passwd|upass|username|useraccount|ddddd|token|secret|credential)|^(?:pwd|pass|user|userid|account|authorization|cookie)$/i.test(key.replace(/[^a-z0-9]/gi, '')) || /^(?:a|action|method)$/i.test(key) && /^(?:login|logout|logoff|disconnect|bind|unbind|kick|delete|remove)$/i.test(val))) {
        throw new CampusError('状态查询遇到未允许的跳转，请打开认证页检查。', 'PORTAL_REDIRECT');
      }
      return url;
    };
    async function send(url, allowRedirect = false) {
      if (![origin, gateway.origin].includes(url.origin)) throw new CampusError('认证请求地址与已识别入口不一致。', 'PORTAL_REDIRECT');
      let metadata = { status: 200, location: '' };
      const body = await observe(url, {
        method: 'GET', allowRedirect,
        headers: { Accept: '*/*', Referer: `${origin}/`, 'Cache-Control': 'no-cache' },
        onResponse: value => { metadata = value; },
      });
      if (metadata.status >= 300 && metadata.status < 400 && !allowRedirect) throw new CampusError('认证接口返回了未允许的跳转。', 'PORTAL_REDIRECT');
      if (metadata.status < 200 || metadata.status >= 400) throw new CampusError('认证服务器暂时不可用。', 'HTTP_ERROR');
      return { ...metadata, body };
    }
    async function landingStatus() {
      const entry = safeLanding(detected.entryUrl || homepage);
      let current = safeLanding(new URL(entry.pathname, homepage));
      const visited = new Set();
      for (let hop = 0; hop < 6; hop++) {
        if (visited.has(current.href)) throw new CampusError('认证页发生循环跳转。', 'PORTAL_REDIRECT');
        visited.add(current.href);
        const response = await send(current, true);
        if (response.status >= 300 && response.status < 400) { current = safeLanding(new URL(response.location, current)); continue; }
        try { return pageStatus(response.body); }
        catch (error) {
          // Identified documents with missing/conflicting markers must never
          // execute login/logout navigation helpers embedded in their scripts.
          if (/<!--\s*Dr\.COMWebLoginID_/i.test(response.body)) throw error;
          const target = htmlTarget(response.body);
          if (!target) throw error;
          current = safeLanding(new URL(target, current));
        }
      }
      throw new CampusError('认证页跳转次数过多。', 'PORTAL_REDIRECT');
    }
    async function status() {
      let data, body;
      try {
        const fields = detected.statusFields ? renderWireFields(detected.statusFields, { nonce: Date.now() }, 'status') : [['callback', 'dr1003'], ['jsVersion', detected.jsVersion], ['v', Date.now()], ['lang', 'zh']];
        body = (await send(apiUrl(homepage, '/drcom/chkstatus', fields))).body;
      } catch (error) {
        const code = error.diagnostics?.find(item => item.status)?.status;
        if (error.code !== 'HTTP_ERROR' || ![404, 405, 501].includes(code)) throw error;
        return { online: await landingStatus(), ip: validIp(detected.device.ip) ? detected.device.ip : undefined };
      }
      if (/<(?:!doctype\b|html(?:\s|>))/i.test(body)) return { online: await landingStatus(), ip: validIp(detected.device.ip) ? detected.device.ip : undefined };
      data = parseJsonOrJsonp(body);
      if (!object(data) || Object.hasOwn(data, 'result') && ![0, '0', 1, '1'].includes(data.result)
        || ['resCode', 'rescode'].some(key => Object.hasOwn(data, key) && ![0, '0'].includes(data[key]))
        || Object.hasOwn(data, 'uid') && (typeof data.uid !== 'string' || /[\u0000-\u001f\u007f]/.test(data.uid))) throw new CampusError('认证服务器返回了未知状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
      const ip = [data.v46ip, data.ss5, data.v4ip, data.lip].find(validIp);
      const rawMac = [data.ss4, data.olmac].find(value => typeof value === 'string' && /^[a-f0-9]{12}$/i.test(value.replace(/[:-]/g, '')));
      const mac = rawMac?.replace(/[:-]/g, '');
      const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
      remember(ip); remember(data.uid); remember(rawMac); remember(mac);
      if (mac && /^[a-f0-9]{12}$/i.test(mac) && detected.macMode === 'portal') detected.device.mac = mac;
      if (uid && [0, '0'].includes(data.result)) throw new CampusError('认证状态与会话信息冲突。', 'AMBIGUOUS_RESPONSE');
      if (detected.statusMode === 'result' && [0, '0', 1, '1'].includes(data.result)) return { online: [1, '1'].includes(data.result), ip };
      if (uid && ip) return { online: true, ip };
      if (!uid && [0, '0'].includes(data.result)) return { online: false, ip };
      if (![1, '1'].includes(data.result)) throw new CampusError('认证服务器未返回明确状态，请打开认证页检查。', 'UNKNOWN_RESPONSE');
      return { online: await landingStatus(), ip };
    }
    const finish = result => ({ ...result, portalUrl: `${origin}/`, message: `${summary}。${result.online ? '已通过校园网认证。' : '当前未通过校园网认证。'}` });
    if (operation === 'status') return finish(await status());
    let initial, url;
    if (operation === 'login') {
      if (typeof context.username !== 'string' || !context.username || typeof context.password !== 'string' || !context.password) throw new CampusError('请填写校园网账号和密码。', 'INVALID_PARAMETERS');
      initial = await status();
      if (initial.online) return finish(initial);
      const operator = operatorValue(detected, context.parameters?.operator || 'auto', context.username);
      let username = context.username;
      if (detected.operatorMode === 'suffix' && operator) {
        if (username.includes('@') && !username.toLowerCase().endsWith(operator.toLowerCase())) throw new CampusError('账号后缀与所选运营商不一致，请修改账号或选择完整账号模式。', 'INVALID_PARAMETERS');
        if (!username.toLowerCase().endsWith(operator.toLowerCase())) username += operator;
      }
      const account = detected.accountPrefix + username;
      remember(username); remember(account);
      const ip = initial.ip || detected.device.ip;
      if ((detected.requireIp ?? detected.mode !== 'web') && !validIp(ip)) throw new CampusError('未发现当前设备 IPv4，未提交账号密码；请连接校园网络后重试或打开认证页。', 'PORTAL_PARAMETERS');
      remember(ip);
      if (detected.loginFields) {
        const mac = detected.macMode === 'zero' ? '000000000000' : detected.device.mac || '000000000000';
        const fields = renderWireFields(detected.loginFields, { account, password: context.password, ip, mac, acIp: detected.device.acIp, acName: detected.device.acName, operator, nonce: Date.now() }, 'login');
        url = apiUrl(detected.mode === 'web' ? homepage : gateway, detected.mode === 'web' ? '/drcom/login' : detected.mode === 'legacy' ? '/eportal/' : '/eportal/portal/login', fields);
      } else {
        const language = detected.loginParams.lang || (detected.mode === 'web' ? 'en' : 'zh-cn');
        const trailingLanguage = detected.loginParams.lang || (detected.mode === 'web' ? 'en' : 'zh');
        const fields = detected.mode === 'web' ? [
          ['DDDDD', account], ['upass', context.password], ['0MKKey', '123456'],
          ['R1', '0'], ['R2', ''], ['R3', detected.operatorMode === 'r3' ? operator : '0'], ['R6', '0'],
          ['para', '00'], ['v6ip', ''], ['terminal_type', '1'], ['lang', language],
        ] : [
          ['login_method', '1'], ['user_account', account], ['user_password', context.password],
          ['wlan_user_ip', ip], ['wlan_user_ipv6', ''],
          ['wlan_user_mac', /^[0-9a-f]{12}$/i.test(detected.device.mac || '') ? detected.device.mac : '000000000000'],
          ['wlan_ac_ip', detected.device.acIp || ''], ['wlan_ac_name', detected.device.acName || ''],
          ['terminal_type', '1'], ['lang', language],
        ];
        for (const [key, value] of Object.entries(detected.loginParams)) {
          if (['ac_logout', 'register_mode', 'enable_r3', 'lang'].includes(key)) continue;
          if (key === 'login_method' && detected.mode === 'web') continue;
          const index = fields.findIndex(field => field[0] === key);
          if (index >= 0) fields[index][1] = value;
          else fields.push([key, value]);
        }
        const prefix = detected.mode === 'legacy' ? [['c', 'Portal'], ['a', 'login'], ['callback', 'dr1003']] : [['callback', 'dr1003']];
        url = apiUrl(detected.mode === 'web' ? homepage : gateway, detected.mode === 'web' ? '/drcom/login' : detected.mode === 'legacy' ? '/eportal/' : '/eportal/portal/login', [...prefix, ...fields, ['jsVersion', detected.jsVersion], ['v', Date.now()], ['lang', trailingLanguage]]);
      }
    } else {
      let entries = detected.logoutMode === 'drcom' ? [['callback', 'dr1003'], ['jsVersion', detected.jsVersion], ['v', Date.now()], ['lang', 'zh']] : [];
      if (detected.logoutMode === 'legacy') entries = [['c', 'Portal'], ['a', 'logout'], ['callback', 'dr1003'], ['jsVersion', detected.jsVersion], ['v', Date.now()]];
      if (detected.loginFields) {
        initial = await status();
        if (!initial.online) return finish(initial);
      }
      if (detected.logoutFields) {
        const ip = initial?.ip || detected.device.ip;
        if (detected.logoutFields.some(field => field.value.includes('{{ip}}')) && !validIp(ip)) throw new CampusError('未发现当前设备 IPv4，未提交注销请求。', 'PORTAL_PARAMETERS');
        const mac = detected.macMode === 'zero' ? '000000000000' : detected.device.mac || '000000000000';
        entries = renderWireFields(detected.logoutFields, { ip, mac, acIp: detected.device.acIp, acName: detected.device.acName, nonce: Date.now() }, 'logout');
      }
      const path = detected.logoutMode === 'drcom' ? '/drcom/logout' : detected.logoutMode === 'legacy' ? '/eportal/' : '/eportal/portal/logout';
      url = apiUrl(detected.logoutMode === 'drcom' ? homepage : gateway, path, entries);
    }
    const data = parseJsonOrJsonp((await send(url)).body);
    if (!accepted(data)) {
      const detail = [data.msg, data.msga, data.message].find(value => typeof value === 'string');
      throw new CampusError(`${operation === 'login' ? '认证被拒绝，请核对账号、密码和运营商。' : '注销未成功，请打开认证页确认。'}${detail ? ` 服务器提示：${detail.slice(0, 300)}` : ''}`, 'AUTH_REJECTED');
    }
    let verified;
    try { verified = await status(); }
    catch { throw new CampusError('服务器已接受请求，但无法确认认证状态，请检测网络或打开认证页。', 'VERIFY_FAILED'); }
    if (verified.online !== (operation === 'login') || operation === 'login' && initial.ip && verified.ip && initial.ip !== verified.ip) throw new CampusError('服务器已接受请求，但认证状态尚未符合预期，请打开认证页确认。', 'VERIFY_FAILED');
    return finish(verified);
  } catch (error) {
    const failure = error instanceof CampusError ? error : new CampusError('无法识别当前校园网络，请打开认证页检查并填写认证地址。', 'DRCOM_DETECTION_INCOMPLETE');
    failure.message = sanitizeText(`${summary ? `${summary}。` : ''}${failure.message}`, secrets);
    throw failure;
  }
}

module.exports = { drcomAutoOperation, WIRE_FIELDS, WIRE_VARIABLES };
