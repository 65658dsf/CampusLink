'use strict';

// NingMeng123 — source-verified Dr.COM wire definitions share the controlled
// executor while keeping school-specific fields and ordering explicit.
const { isIP } = require('node:net');
const { CampusError } = require('./transport.cjs');
const { drcomAutoOperation } = require('./drcom-auto.cjs');

function configuredPortal(profile) {
  const config = profile.drcomConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !['web', 'legacy', 'v4'].includes(config.mode)
    || !Number.isInteger(config.apiPort) || config.apiPort < 1 || config.apiPort > 65535
    || !['suffix', 'r3', 'none'].includes(config.operatorMode)
    || !['result', 'identity'].includes(config.statusMode)
    || !['zero', 'portal'].includes(config.macMode)
    || !['drcom', 'legacy', 'v4'].includes(config.logoutMode)
    || typeof config.requireIp !== 'boolean'
    || !Array.isArray(config.loginFields) || !config.loginFields.length) {
    throw new CampusError('学校 Dr.COM 协议配置无效。', 'INVALID_PROFILE');
  }
  const homepage = new URL(profile.homepage);
  const entry = new URL(profile.discoveredEntry || profile.homepage);
  if (entry.origin !== homepage.origin || entry.username || entry.password || entry.hash) throw new CampusError('学校认证入口与发现结果不一致。', 'PORTAL_REDIRECT');
  const device = { ip: '', mac: '', acIp: '', acName: '' };
  const aliases = {
    ip: ['wlan_user_ip', 'wlanuserip', 'userip', 'ip'],
    mac: ['wlan_user_mac', 'wlanusermac', 'mac'],
    acIp: ['wlan_ac_ip', 'wlanacip', 'nasip'],
    acName: ['wlan_ac_name', 'wlanacname'],
  };
  for (const [key, names] of Object.entries(aliases)) {
    const value = names.map(name => entry.searchParams.get(name)).find(Boolean) || '';
    if (value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new CampusError('学校认证页设备参数无效。', 'PORTAL_PARAMETERS');
    device[key] = value;
  }
  if (isIP(device.ip) !== 4) device.ip = '';
  device.mac = device.mac.replace(/[:-]/g, '');
  if (config.macMode === 'zero' || !/^[a-f0-9]{12}$/i.test(device.mac)) device.mac = '000000000000';
  return {
    ...config,
    homepage: `${homepage.origin}${homepage.pathname}`,
    entryUrl: entry.href,
    suffixes: config.operators,
    loginParams: {},
    device,
    evidence: ['学校源码核验的声明式配置'],
  };
}

async function drcomConfigOperation(profile, operation, context, requester, registerSecret) {
  return drcomAutoOperation(profile, operation, context, requester, registerSecret, configuredPortal);
}

module.exports = { drcomConfigOperation };
