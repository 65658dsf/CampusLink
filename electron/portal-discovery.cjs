'use strict';

// NingMeng123 — unauthenticated, bounded portal discovery. Device parameters
// belong to this operation only; callers may cache the verified origin.
const { portalRequest } = require('./portal-transport.cjs');
const { CampusError } = require('./transport.cjs');
const { htmlTarget } = require('./ruijie.cjs');

const MAX_HOPS = 6;
const MICROSOFT_DOMAINS = ['msftconnecttest.com', 'msftncsi.com', 'microsoft.com', 'microsoft.cn', 'microsoftonline.com', 'msn.com', 'msn.cn', 'bing.com', 'bing.com.cn', 'live.com', 'windows.com'];
const CREDENTIAL_KEY = /^(?:username|user|userid|account|accountname|accountid|loginname|ddddd|upass|pwd|pass|password|passwd|operatorpwd|operatoruserid|authorization|cookie|credential|credentials|secret|token|accesstoken|refreshtoken|apikey)$/i;

function isMicrosoft(url) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return MICROSOFT_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

function safeTarget(value, base) {
  if (typeof value !== 'string' || value.length > 20000 || /[\u0000-\u0020]/.test(value)) return null;
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
  // Discovery never sends account credentials, even if a redirect contains
  // them. Do not silently turn an authenticated URL into an apparent probe.
  for (const [key] of url.searchParams) if (CREDENTIAL_KEY.test(key.replace(/[^a-z0-9]/gi, ''))) return null;
  return url;
}

function protocolOf(url, body) {
  const html = String(body).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const htmlDocument = /<(?:!doctype|html|head|body|form)\b/i.test(html);
  const drcomMarker = htmlDocument && /<!--\s*Dr\.COMWebLoginID_\d+\.htm\s*-->/i.test(html);
  const loginForm = /<form\b[^>]*>[\s\S]*?<input\b[^>]*(?:name|id)\s*=\s*["']?(?:DDDDD|upass|username|password|userId|account)\b/i.test(html);
  const drcomApi = /(?:["'\s=]|^)\/?drcom\/(?:login|logout|chkstatus|rad_user_info)\b/i.test(body) || /https?:\/\/[^\s"'<>]+\/drcom\/(?:login|logout|chkstatus|rad_user_info)\b/i.test(body);
  const drcom = drcomMarker || (loginForm && drcomApi);
  const eportalPath = /^\/eportal\/(?:index|success|redirectortosuccess)\.jsp$/i.test(url.pathname);
  const mac = url.searchParams.get('mac') || '';
  // SCU calls its 32-digit opaque device identifier "mac" as well. Preserve
  // that value verbatim: the legacy RSA input is not limited to a hardware MAC.
  const validMac = /^(?:[a-f0-9]{12}|[a-f0-9]{32}|(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2})$/i.test(mac) && url.search.length <= 16385;
  const eportalMarker = /(?:\bePortal\b|\bRuijie\b|锐捷|\bInterFace\.do\b)/i.test(body);
  const ruijie = eportalPath && (validMac || eportalMarker);
  if (drcom && ruijie) return 'ambiguous';
  return drcom ? 'drcom' : ruijie ? 'ruijie' : null;
}

function explicitFormOrigin(body, current) {
  // A transparent gateway may replace the Microsoft probe's body while the
  // browser URL is still Microsoft. Only explicit off-site form destinations
  // can identify the actual server; never return the probe's own origin.
  const destinations = new Set();
  for (const form of String(body).matchAll(/<form\b[^<>]*>/gi)) {
    const action = form[0].match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!action) continue;
    const url = safeTarget((action[1] ?? action[2] ?? action[3]).replace(/&amp;/gi, '&'), current);
    if (!url || isMicrosoft(url)) continue;
    // Visit the server's landing page with GET; never execute a form's login,
    // logout, or other action while discovering its origin.
    destinations.add(`${url.origin}/`);
  }
  return destinations.size === 1 ? [...destinations][0] : null;
}

async function discoverPortal(profile, requester = portalRequest) {
  if (!profile?.portalDiscovery?.url || !['drcom', 'ruijie'].includes(profile.protocol)) return null;
  let current = safeTarget(profile.portalDiscovery.url);
  if (!current) return null;
  const visited = new Set();
  const origins = new Set();
  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (visited.has(current.href) || (hop > 0 && isMicrosoft(current))) return null;
      visited.add(current.href);
      if (!isMicrosoft(current)) origins.add(current.origin);
      let response = { status: 200, location: '' };
      const body = await requester(current, {
        method: 'GET', allowRedirect: true,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Cache-Control': 'no-cache' },
        onResponse: metadata => { response = metadata; },
      }, Math.min(profile.timeoutMs || 10000, 10000));
      if (response.status >= 300 && response.status < 400) {
        const next = safeTarget(response.location, current);
        if (!next) return null;
        current = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) return null;
      const target = htmlTarget(String(body));
      if (target) {
        const next = safeTarget(target, current);
        if (!next) return null;
        current = next;
        continue;
      }
      if (isMicrosoft(current)) {
        const portalBody = protocolOf(current, body) === 'drcom' || /<(?:html|form)\b/i.test(body) && /(?:\bePortal\b|\bRuijie\b|锐捷|\bInterFace\.do\b)/i.test(body);
        if (!portalBody) return null;
        const target = explicitFormOrigin(body, current);
        if (!target) return null;
        current = new URL(target);
        continue;
      }
      const detected = protocolOf(current, body);
      if (!detected || detected === 'ambiguous') return null;
      if (detected !== profile.protocol) throw new CampusError('当前网络的校园网认证类型与所选方案不同，请切换匹配的连接方案后重试。', 'PORTAL_PROTOCOL_MISMATCH');
      return { homepage: `${current.origin}/`, entryUrl: current.href, redirectOrigins: [...origins] };
    }
  } catch (error) {
    if (error instanceof CampusError && error.code === 'PORTAL_PROTOCOL_MISMATCH') throw error;
    // A failed connectivity probe does not establish an offline/authenticated
    // state. The caller can still try its known authentication server.
  }
  return null;
}

module.exports = { discoverPortal };
