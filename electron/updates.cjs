'use strict';

// Campus Link · NingMeng123
const { EventEmitter } = require('node:events');

const RELEASES_URL = 'https://github.com/65658dsf/CampusLink/releases';
const API_URL = 'https://api.github.com/repos/65658dsf/CampusLink/releases/latest';
const VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RESPONSE_LIMIT = 256 * 1024;
const NOTES_LIMIT = 32 * 1024;
const COOLDOWN_MS = 60 * 1000;
const ERROR_COOLDOWN_MS = 5 * 1000;

class UpdateError extends Error {}

function versionParts(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const match = VERSION_PATTERN.exec(value);
  return match && match[0] === value ? match.slice(1).map(part => BigInt(part)) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw new UpdateError('版本号格式无法识别，请前往 Releases 查看。');
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function safeReleaseUrl(input = RELEASES_URL) {
  if (input === RELEASES_URL) return input;
  if (typeof input !== 'string' || !input.startsWith(`${RELEASES_URL}/tag/`)) {
    throw new UpdateError('更新页面地址无效。');
  }
  const tag = input.slice(`${RELEASES_URL}/tag/`.length);
  if (!versionParts(tag)) throw new UpdateError('更新页面地址无效。');
  return `${RELEASES_URL}/tag/${tag}`;
}

function cancelBody(response) {
  // Cancellation is best effort: an unresponsive stream must not delay the timeout.
  try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
}

function rateLimitDelay(response, now) {
  const value = response.headers.get('retry-after');
  if (!value) return COOLDOWN_MS;
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.min(10 * COOLDOWN_MS, Math.max(COOLDOWN_MS, milliseconds)) : COOLDOWN_MS;
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_LIMIT) {
    cancelBody(response);
    throw new UpdateError('更新信息过大，请前往 Releases 查看。');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new UpdateError('更新服务响应格式无法识别，请稍后重试。');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) {
        Promise.resolve(reader.cancel()).catch(() => {});
        throw new UpdateError('更新信息过大，请前往 Releases 查看。');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch {
    throw new UpdateError('更新服务响应格式无法识别，请稍后重试。');
  }
}

function releaseNotes(body) {
  if (body == null || body.trim() === '') return '暂无更新说明。';
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= NOTES_LIMIT) return body;
  const suffix = '\n\n（更新内容较长，完整说明请前往 Releases 查看。）';
  const limit = NOTES_LIMIT - Buffer.byteLength(suffix, 'utf8');
  // Streaming decoding omits an incomplete trailing UTF-8 character.
  return new TextDecoder().decode(bytes.subarray(0, limit), { stream: true }) + suffix;
}

function validateRelease(release, currentVersion) {
  if (!release || Array.isArray(release) || typeof release !== 'object'
      || release.draft !== false || release.prerelease !== false
      || !versionParts(release.tag_name)
      || (release.body != null && typeof release.body !== 'string')) {
    throw new UpdateError('最新发行版格式无法识别，请前往 Releases 查看。');
  }
  const releaseUrl = safeReleaseUrl(`${RELEASES_URL}/tag/${release.tag_name}`);
  if (safeReleaseUrl(release.html_url) !== releaseUrl) {
    throw new UpdateError('更新页面地址与版本不匹配，请前往 Releases 查看。');
  }
  const newer = compareVersions(release.tag_name, currentVersion) > 0;
  const result = {
    status: newer ? 'available' : 'up-to-date',
    currentVersion,
    latestVersion: release.tag_name.replace(/^v/, ''),
    releaseUrl,
    notes: releaseNotes(release.body),
    message: newer ? '发现新版本，请前往 Releases 下载。' : '当前已是最新版本。',
  };
  if (typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))) {
    result.publishedAt = new Date(release.published_at).toISOString();
  }
  return result;
}

class UpdateChecker extends EventEmitter {
  constructor({ currentVersion, fetcher = global.fetch, now = () => Date.now(), timeoutMs = 10_000 }) {
    super();
    if (!versionParts(currentVersion)) throw new TypeError('当前应用版本号格式无效。');
    if (typeof fetcher !== 'function' || typeof now !== 'function') throw new TypeError('更新检查配置无效。');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('更新检查超时配置无效。');
    this.currentVersion = currentVersion.replace(/^v/, '');
    this.fetcher = fetcher;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.state = { status: 'idle', currentVersion: this.currentVersion };
    this.pending = null;
    this.nextAllowedCheckAt = -Infinity;
  }

  snapshot() {
    return { ...this.state };
  }

  retryDelayMs() {
    return Math.max(0, this.nextAllowedCheckAt - this.now());
  }

  setState(state) {
    this.state = state;
    this.emit('change', this.snapshot());
    return this.snapshot();
  }

  check() {
    if (this.pending) return this.pending;
    if (this.now() < this.nextAllowedCheckAt) return Promise.resolve(this.snapshot());
    this.pending = Promise.resolve().then(() => this.performCheck()).finally(() => { this.pending = null; });
    this.setState({ status: 'checking', currentVersion: this.currentVersion, message: '正在检查更新…' });
    return this.pending;
  }

  async fetchRelease(signal) {
    const response = await this.fetcher(API_URL, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': `CampusLink/${this.currentVersion} (NingMeng123; https://github.com/65658dsf/CampusLink)`,
      },
    });
    if (response.status !== 200) {
      cancelBody(response);
      if (response.status === 404) throw new UpdateError('暂未找到正式发行版，请前往 Releases 查看。');
      if (response.status === 403 || response.status === 429) {
        const error = new UpdateError('GitHub 暂时限制了更新查询，请稍后重试或前往 Releases 查看。');
        error.cooldownMs = rateLimitDelay(response, this.now());
        throw error;
      }
      throw new UpdateError('更新服务暂时不可用，请稍后重试。');
    }
    return validateRelease(await readBoundedJson(response), this.currentVersion);
  }

  async performCheck() {
    const controller = new AbortController();
    let timeout;
    let result;
    let cooldownMs = COOLDOWN_MS;
    try {
      result = await Promise.race([
        this.fetchRelease(controller.signal),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            reject(new UpdateError('检查更新超时，请确认网络连接后重试。'));
            controller.abort();
          }, this.timeoutMs);
        }),
      ]);
    } catch (error) {
      cooldownMs = error instanceof UpdateError && error.cooldownMs ? error.cooldownMs : ERROR_COOLDOWN_MS;
      result = {
        status: 'error',
        currentVersion: this.currentVersion,
        message: error instanceof UpdateError
          ? error.message
          : '无法连接更新服务，请在校园网登录成功后重试，或前往 Releases 查看。',
      };
    } finally {
      clearTimeout(timeout);
    }
    this.nextAllowedCheckAt = this.now() + cooldownMs;
    return this.setState({ ...result, checkedAt: new Date(this.now()).toISOString() });
  }
}

module.exports = { UpdateChecker, safeReleaseUrl };
