'use strict';

// NingMeng123 — some Ruijie gateways require the literal HTTP header name Host.
const http = require('node:http');
const https = require('node:https');
const { CampusError, MAX_RESPONSE_BYTES } = require('./transport.cjs');
const { createDiagnostic } = require('./diagnostics.cjs');

function portalRequest(url, options = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const chunks = [];
    const responseSecrets = [];
    let request, response, timer, diagnostic;
    let size = 0, truncated = false, finished = false;
    const method = String(options.method || 'GET').toUpperCase();

    function decodeBody() {
      const charset = response?.headers['content-type']?.match(/\bcharset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
      const body = Buffer.concat(chunks);
      try { return new TextDecoder(charset).decode(body); }
      catch { return body.toString('utf8'); }
    }

    function capture() {
      if (!diagnostic) {
        diagnostic = createDiagnostic(url, {
          ...options,
          diagnosticSecrets: [...(Array.isArray(options.diagnosticSecrets) ? options.diagnosticSecrets : []), ...responseSecrets],
        }, {
          status: response?.statusCode, statusText: response?.statusMessage,
          contentType: response?.headers['content-type'], durationMs: performance.now() - started,
          responseBody: decodeBody(), truncated,
        });
        if (typeof options.onDiagnostic === 'function') {
          try { options.onDiagnostic(diagnostic); } catch { /* Observers cannot interrupt authentication. */ }
        }
      }
      return diagnostic;
    }

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const details = [capture()];
      if (error) {
        response?.destroy();
        request?.destroy();
        if (!(error instanceof CampusError)) error = new CampusError('无法访问认证服务器，请连接校园 Wi-Fi / 有线网络后重试。', 'NETWORK_ERROR');
        error.diagnostics = details;
        reject(error);
      } else resolve(decodeBody());
    }

    function responseError() {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        if (options.allowRedirect === true && method === 'GET') return null;
        return new CampusError('认证服务器返回了未允许的跳转，请检查连接方案。', 'NETWORK_ERROR');
      }
      if (status < 200 || status >= 300) return new CampusError(`认证服务器返回 HTTP ${status}，请稍后再试。`, 'HTTP_ERROR');
      return null;
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new CampusError('认证地址无效，请使用不含账号密码的 HTTP / HTTPS 地址。', 'NETWORK_ERROR');
      }
      const headers = {};
      for (const [name, value] of new Headers(options.headers || {})) headers[name.toLowerCase() === 'host' ? 'Host' : name] = value;
      headers.Host ??= parsed.host;
      // Campus portals return plain HTML/JSON. Do not request a compressed body
      // that could bypass the response-size bound after decompression.
      headers['accept-encoding'] = 'identity';
      let body = options.body;
      if (body instanceof URLSearchParams) {
        body = body.toString();
        headers['content-type'] ??= 'application/x-www-form-urlencoded;charset=UTF-8';
      }
      if (body !== undefined && body !== null) {
        if (!(typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array)) throw new TypeError('Unsupported request body');
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      timer = setTimeout(() => {
        if (response) truncated = true;
        finish(new CampusError('连接超时，请确认已接入校园网络。', 'TIMEOUT'));
      }, timeoutMs);
      // Only explicitly supported fields reach Node; no implicit redirects,
      // cookie jar, URL credentials, or diagnostic callbacks enter the request.
      request = (parsed.protocol === 'https:' ? https : http).request(parsed, { method, headers }, incoming => {
        response = incoming;
        const setCookies = [...(incoming.headers['set-cookie'] || [])];
        for (const cookie of setCookies) {
          responseSecrets.push(cookie);
          const pair = cookie.split(';', 1)[0];
          const equals = pair.indexOf('=');
          if (equals !== -1 && pair.slice(equals + 1)) responseSecrets.push(pair.slice(equals + 1));
        }
        if (typeof options.onResponse === 'function') {
          try { options.onResponse({ status: incoming.statusCode, location: incoming.headers.location, setCookies }); }
          catch { /* Observers cannot interrupt authentication. */ }
        }
        if (!responseError() && Number(incoming.headers['content-length'] || 0) > MAX_RESPONSE_BYTES) {
          truncated = true;
          finish(new CampusError('认证服务器返回内容过大。', 'RESPONSE_TOO_LARGE'));
          return;
        }
        incoming.on('data', chunk => {
          if (finished) return;
          const buffer = Buffer.from(chunk);
          chunks.push(buffer.subarray(0, Math.max(0, MAX_RESPONSE_BYTES - size)));
          size += buffer.length;
          if (size > MAX_RESPONSE_BYTES) {
            truncated = true;
            finish(responseError() || new CampusError('认证服务器返回内容过大。', 'RESPONSE_TOO_LARGE'));
          }
        });
        incoming.on('end', () => finish(responseError()));
        incoming.on('error', error => { truncated = true; finish(error); });
        incoming.on('aborted', () => { truncated = true; finish(new Error('Response interrupted')); });
      });
      request.on('error', error => { if (response) truncated = true; finish(error); });
      request.end(body);
    } catch (error) { finish(error); }
  });
}

module.exports = { portalRequest };
