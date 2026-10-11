'use strict';

const { createDiagnostic } = require('./diagnostics.cjs');

class CampusError extends Error {
  constructor(message, code = 'REQUEST_FAILED', diagnostics = []) {
    super(message); this.name = 'CampusError'; this.code = code;
    this.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  }
}
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function request(url, options = {}, timeoutMs = 10000) {
  const { diagnosticSecrets: _secrets, onDiagnostic, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let response;
  const chunks = [];
  let size = 0, truncated = false, diagnostic;
  function decodeBody() {
    // The built-in portal serves both HTML and JSONP using GBK. Honor its
    // declared encoding without executing any response as JavaScript.
    const charset = response?.headers.get('content-type')?.match(/\bcharset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
    const body = Buffer.concat(chunks);
    try { return new TextDecoder(charset).decode(body); }
    catch { return body.toString('utf8'); }
  }
  function capture() {
    if (!diagnostic) {
      diagnostic = createDiagnostic(url, options, {
        status: response?.status, statusText: response?.statusText,
        contentType: response?.headers.get('content-type'), durationMs: performance.now() - started,
        responseBody: decodeBody(), truncated,
      });
      // A consumer cannot break authentication by throwing from its observer.
      if (typeof onDiagnostic === 'function') { try { onDiagnostic(diagnostic); } catch { /* No raw diagnostic logging. */ } }
    }
    return diagnostic;
  }
  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal, redirect: 'error', cache: 'no-store' });
    // Failed responses still carry the server explanation. Read a bounded body
    // before reporting HTTP_ERROR, even when Content-Length is oversized.
    if (response.ok && Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) {
      truncated = true; controller.abort();
      throw new CampusError('认证服务器返回内容过大。', 'RESPONSE_TOO_LARGE');
    }
    if (response.body) {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        const remaining = MAX_RESPONSE_BYTES - size;
        chunks.push(buffer.subarray(0, remaining));
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          truncated = true; controller.abort();
          if (!response.ok) throw new CampusError(`认证服务器返回 HTTP ${response.status}，请稍后再试。`, 'HTTP_ERROR');
          throw new CampusError('认证服务器返回内容过大。', 'RESPONSE_TOO_LARGE');
        }
      }
    }
    if (!response.ok) throw new CampusError(`认证服务器返回 HTTP ${response.status}，请稍后再试。`, 'HTTP_ERROR');
    capture();
    return decodeBody();
  } catch (error) {
    if (!(error instanceof CampusError) && response) truncated = true;
    const details = [capture()];
    if (error instanceof CampusError) { error.diagnostics = details; throw error; }
    if (controller.signal.aborted) throw new CampusError('连接超时，请确认已接入校园网络。', 'TIMEOUT', details);
    throw new CampusError('无法访问认证服务器，请连接校园 Wi-Fi / 有线网络后重试。', 'NETWORK_ERROR', details);
  } finally { clearTimeout(timer); }
}

function parseJsonOrJsonp(text) {
  let source = String(text).trim().replace(/^\uFEFF/, '').replace(/^\/\*\*\/\s*/, '');
  // Accept a JSONP callback (including a dotted namespace), but only parse its
  // argument as strict JSON. Never evaluate assignments, expressions, or code.
  const match = source.match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (match) source = match[1];
  try { return JSON.parse(source); } catch { throw new CampusError('服务器响应无法识别，请打开认证页检查。', 'INVALID_RESPONSE'); }
}

module.exports = { CampusError, request, parseJsonOrJsonp, MAX_RESPONSE_BYTES };
