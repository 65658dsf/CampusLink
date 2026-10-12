'use strict';

// NingMeng123 — diagnostics are plain text, bounded, and never persisted here.
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const REDACTED = '[已隐藏]';
const TRUNCATED = '\n[响应内容已截断]';
const SENSITIVE_KEY = /^(?:ddddd|upass|pwd|pass|password|passwd|passphrase|username|user|userid|uid|account|accountname|accountid|loginname|studentid|phone|mobile|telephone|email|mail|credential|credentials|secret|token|accesstoken|refreshtoken|idtoken|authorization|auth|cookie|setcookie|session|sessionid|jsessionid|csrf|csrftoken|xsrf|xsrftoken|apikey|ac0|ss1|ss4|mac|usermac|clientmac|macaddress)$/i;
const isSensitiveKey = key => SENSITIVE_KEY.test(String(key).replace(/[^a-z0-9]/gi, '')) || /^(?:userindex|querystring|operatoruserid|operatorpwd)$/i.test(String(key).replace(/[^a-z0-9]/gi, '')) || /(?:password|token|secret|cookie|authorization)/i.test(key);
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', sol: '/', equals: '=' };
const ENCODED = /(?:%[a-f\d]{2})+|&#(?:x[a-f\d]+|\d+);?|&(?:amp|lt|gt|quot|apos|nbsp|colon|sol|equals);|\\u\{[a-f\d]{1,6}\}|\\u[a-f\d]{4}|\\x[a-f\d]{2}|\\["'\\/bfnrt]/gi;

function decodeToken(token) {
  try {
    if (token[0] === '%') return decodeURIComponent(token);
    if (token.startsWith('&#')) {
      const value = token.slice(2).replace(/;$/, '');
      return String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value));
    }
    if (token[0] === '&') return ENTITY[token.slice(1, -1).toLowerCase()] || token;
    if (token.startsWith('\\u{')) return String.fromCodePoint(parseInt(token.slice(3, -1), 16));
    if (/^\\[ux]/i.test(token)) return String.fromCharCode(parseInt(token.slice(2), 16));
    return ({ '\\b': '\b', '\\f': '\f', '\\n': '\n', '\\r': '\r', '\\t': '\t' })[token] ?? token.slice(1);
  } catch { return token; }
}

// Keep source offsets while decoding for comparisons. Redaction therefore
// preserves the server's original escaping/HTML everywhere except the secret.
function decodedView(source) {
  let view = { text: source, starts: null, ends: null };
  for (let round = 0; round < 4; round++) {
    const matches = [...view.text.matchAll(ENCODED)].filter(match => decodeToken(match[0]) !== match[0]);
    if (!matches.length) break;
    const starts = new Uint32Array(view.text.length);
    const ends = new Uint32Array(view.text.length);
    const chunks = [];
    let input = 0, output = 0;
    const copy = until => {
      chunks.push(view.text.slice(input, until));
      for (; input < until; input++, output++) {
        starts[output] = view.starts ? view.starts[input] : input;
        ends[output] = view.ends ? view.ends[input] : input + 1;
      }
    };
    for (const match of matches) {
      copy(match.index);
      const decoded = decodeToken(match[0]);
      const start = view.starts ? view.starts[input] : input;
      const end = view.ends ? view.ends[input + match[0].length - 1] : input + match[0].length;
      chunks.push(decoded);
      for (let i = 0; i < decoded.length; i++, output++) { starts[output] = start; ends[output] = end; }
      input += match[0].length;
    }
    copy(view.text.length);
    view = { text: chunks.join(''), starts: starts.subarray(0, output), ends: ends.subarray(0, output) };
  }
  return view;
}

function collectSecrets(url, options = {}) {
  const secrets = new Set((Array.isArray(options.diagnosticSecrets) ? options.diagnosticSecrets : []).filter(value => typeof value === 'string' && value.length));
  const add = value => { if (typeof value === 'string' && value) secrets.add(value); };
  const pairs = iterable => { for (const [key, value] of iterable) if (isSensitiveKey(key)) add(String(value)); };
  try {
    const parsed = new URL(url);
    add(decodeURIComponent(parsed.username)); add(decodeURIComponent(parsed.password));
    pairs(parsed.searchParams);
  } catch { /* The caller will report an invalid/unreachable URL safely. */ }
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 16) return;
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key) && (typeof item === 'string' || typeof item === 'number')) add(String(item));
      else visit(item, depth + 1);
    }
  };
  const body = options.body;
  if (body instanceof URLSearchParams || (typeof FormData !== 'undefined' && body instanceof FormData)) pairs(body.entries());
  else if (typeof body === 'string' || Buffer.isBuffer(body)) {
    const value = String(body);
    try { visit(JSON.parse(value)); } catch { pairs(new URLSearchParams(value)); }
  } else visit(body);
  try {
    for (const [key, value] of new Headers(options.headers || {})) {
      if (!isSensitiveKey(key)) continue;
      add(value);
      if (/authorization/i.test(key)) add(value.replace(/^\S+\s+/, ''));
      if (/cookie/i.test(key)) for (const part of value.split(';')) add(part.slice(part.indexOf('=') + 1).trim());
    }
  } catch { /* Invalid headers are handled by fetch, never echoed. */ }
  return [...secrets];
}

function sanitizeText(value, secrets = [], { truncated = false } = {}) {
  const source = String(value ?? '');
  if (!source) return '';
  const view = decodedView(source);
  const ranges = [];
  const hide = (start, end) => {
    if (end <= start) return;
    ranges.push([view.starts ? view.starts[start] : start, view.ends ? view.ends[end - 1] : end]);
  };
  const values = Array.isArray(secrets) ? secrets : secrets?.diagnosticSecrets || [];
  for (const secret of new Set(values.filter(item => typeof item === 'string' && item.length))) {
    const base64 = Buffer.from(secret, 'utf8').toString('base64');
    const candidates = new Set([secret, decodedView(secret).text, base64, base64.replace(/=+$/, ''), Buffer.from(secret, 'utf8').toString('base64url')]);
    // Form URL encoding uses '+' for spaces; it is ambiguous in ordinary text.
    if (secret.includes(' ')) candidates.add(secret.replace(/ /g, '+'));
    for (const candidate of candidates) {
      let offset = 0;
      while (candidate && (offset = view.text.indexOf(candidate, offset)) !== -1) { hide(offset, offset + candidate.length); offset += candidate.length; }
      if (truncated) {
        for (let length = Math.min(candidate.length - 1, view.text.length); length > 0; length--) {
          if (view.text.endsWith(candidate.slice(0, length))) { hide(view.text.length - length, view.text.length); break; }
        }
      }
    }
  }
  // Redact credentials issued by the server as well as request echoes.
  const fields = /(?<![\w$.-])(["']?)([a-z_$][\w$.-]{0,127})\1\s*(?:\.value\s*)?[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&<>}\]\r\n]+)/gi;
  for (const [text, addRange] of [[source, (start, end) => ranges.push([start, end])], [view.text, hide]]) {
    for (const match of text.matchAll(fields)) {
      if (!isSensitiveKey(match[2].replace(/\.value$/i, ''))) continue;
      const start = match.index + match[0].length - match[3].length;
      addRange(start, start + match[3].length);
      // An encoded key can accompany a quoted value containing escaped quotes.
      // Parsing the original quoted token avoids exposing its tail after the
      // comparison view has decoded those internal quotation marks.
      if (text === view.text) {
        const originalStart = view.starts ? view.starts[start] : start;
        const originalValue = source.slice(originalStart).match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
        if (originalValue) ranges.push([originalStart, originalStart + originalValue[0].length]);
      }
    }
  }
  for (const match of view.text.matchAll(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n<>]+/gi)) {
    const start = match.index + match[0].indexOf(':') + 1;
    hide(start, match.index + match[0].length);
  }
  // Do not restart an unbounded scan at every '<input' in malformed HTML.
  for (const match of view.text.matchAll(/<input\b[^<>]*(?:>|$)/gi)) {
    const name = match[0].match(/\b(?:name|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!name || !isSensitiveKey(name[1] ?? name[2] ?? name[3])) continue;
    const val = match[0].match(/\bvalue\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    if (val) { const start = match.index + val.index + val[0].length - val[1].length; hide(start, start + val[1].length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  let result = '', cursor = 0;
  for (const [start, end] of merged) { result += source.slice(cursor, start) + REDACTED; cursor = end; }
  result += source.slice(cursor);
  return result.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}

function boundedText(text, alreadyTruncated = false) {
  const truncated = alreadyTruncated || Buffer.byteLength(text, 'utf8') > MAX_DIAGNOSTIC_BYTES;
  if (!truncated) return { responseBody: text, truncated: false };
  const budget = MAX_DIAGNOSTIC_BYTES - Buffer.byteLength(TRUNCATED, 'utf8');
  let bytes = 0, length = 0;
  for (const character of text) { bytes += Buffer.byteLength(character, 'utf8'); if (bytes > budget) break; length += character.length; }
  return { responseBody: text.slice(0, length) + TRUNCATED, truncated: true };
}

function createDiagnostic(url, options = {}, details = {}) {
  const secrets = collectSecrets(url, options);
  let safeUrl = '[无效地址]';
  try { const parsed = new URL(url); safeUrl = `${parsed.origin}${parsed.pathname}`; } catch { /* No raw URL in errors. */ }
  const diagnostic = {
    method: String(options.method || 'GET').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 16) || 'GET',
    url: sanitizeText(safeUrl, secrets),
    durationMs: Math.max(0, Math.round(Number(details.durationMs) || 0)),
    ...boundedText(sanitizeText(details.responseBody, secrets, { truncated: details.truncated === true }), details.truncated === true),
  };
  if (Number.isInteger(details.status)) diagnostic.status = details.status;
  if (typeof details.statusText === 'string') diagnostic.statusText = sanitizeText(details.statusText, secrets).slice(0, 256);
  if (typeof details.contentType === 'string') diagnostic.contentType = sanitizeText(details.contentType, secrets).slice(0, 256);
  return diagnostic;
}

module.exports = { createDiagnostic, sanitizeText, collectSecrets, MAX_DIAGNOSTIC_BYTES };
