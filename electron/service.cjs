'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { builtinProfiles, defaultProfile, publicProfile, validateProfile, parseProfile, profileParameters, keys } = require('./profiles.cjs');
const { runOperation } = require('./adapters.cjs');
const { CampusError } = require('./transport.cjs');

const defaults = () => ({ profileId: defaultProfile.id, username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 10, minimizeToTray: true, appearance: 'classic', parameters: profileParameters(defaultProfile) });
const IDLE = () => ({ status: 'idle', message: '准备就绪，连接校园网络后即可认证。' });

class CampusService extends EventEmitter {
  constructor({ directory, safeStorage, version = '1.0.0', platform = process.platform, packaged = false, autoLaunch = () => false, operation = runOperation, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, firstRun }) {
    super();
    this.directory = directory;
    this.file = path.join(directory, 'settings.json');
    this.firstRun = firstRun ?? !fs.existsSync(this.file);
    this.safeStorage = safeStorage;
    this.autoLaunch = autoLaunch;
    this.operation = operation;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.settings = defaults();
    this.externalProfiles = [];
    this.credential = null;
    this.session = null;
    this.reconnectContext = null;
    this.reconnectPaused = false;
    this.monitorArmed = false;
    this.monitorRunning = false;
    this.monitorTimer = null;
    this.monitorGeneration = 0;
    this.timerVersion = 0;
    this.reconnectWarning = false;
    this.disposed = false;
    this.busy = false;
    this.lastStatusCheck = 0;
    this.refreshing = false;
    this.connection = IDLE();
    this.logs = [];
    this.appInfo = { version, platform, packaged, windowGlass: false, firstRun: this.firstRun, secureStorage: this.storageAvailable() };
    this.load();
    this.log('info', '岚连 · CDUTYB 专版已就绪，首次连接按启动偏好执行；确认在线后可按设置检测并自动重连。', false);
  }
  storageAvailable() {
    try { return Boolean(this.safeStorage?.isEncryptionAvailable()) && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; }
  }
  monitoring() {
    return !this.disposed && this.settings.autoReconnect && this.monitorArmed && !this.reconnectPaused;
  }
  cancelMonitorTimer() {
    this.timerVersion++;
    if (this.monitorTimer !== null) this.clearTimer(this.monitorTimer);
    this.monitorTimer = null;
  }
  stopMonitoring() {
    this.monitorGeneration++;
    this.monitorArmed = false;
    this.cancelMonitorTimer();
  }
  armMonitoring() {
    if (this.disposed || !this.settings.autoReconnect || this.reconnectPaused) return;
    this.monitorArmed = true;
    if (this.session?.password && this.sameReconnectIdentity(this.session)) this.reconnectContext = { ...this.session };
    this.scheduleMonitor();
  }
  scheduleMonitor() {
    if (!this.monitoring() || this.monitorRunning || this.monitorTimer !== null) return;
    const version = ++this.timerVersion;
    this.monitorTimer = this.setTimer(() => {
      if (version !== this.timerVersion) return;
      this.monitorTimer = null;
      return this.monitorTick();
    }, this.settings.reconnectIntervalSeconds * 1000);
    this.monitorTimer?.unref?.();
  }
  sameReconnectIdentity(context) {
    return context?.profileId === this.settings.profileId && context.username === this.settings.username && JSON.stringify(context.parameters) === JSON.stringify(this.settings.parameters);
  }
  reconnectCredentials() {
    if (this.sameReconnectIdentity(this.reconnectContext) && this.reconnectContext.password) return { ...this.reconnectContext };
    if (!this.settings.rememberPassword || this.credential?.profileId !== this.settings.profileId || this.credential?.username !== this.settings.username) return null;
    try {
      const password = this.decryptPassword();
      return password ? { profileId: this.settings.profileId, username: this.settings.username, password, parameters: this.settings.parameters } : null;
    } catch { return null; }
  }
  async monitorTick() {
    if (!this.monitoring() || this.monitorRunning) return;
    if (this.busy) { this.scheduleMonitor(); return; }
    const generation = this.monitorGeneration;
    this.monitorRunning = true;
    try {
      // A timeout or unknown response remains unknown: only a positively
      // confirmed offline result permits submitting the remembered identity.
      await this.checkStatus({ silent: true });
      if (!this.monitoring() || generation !== this.monitorGeneration || this.busy || this.connection.status !== 'idle') return;
      const context = this.reconnectCredentials();
      if (!context?.username || !context.password) {
        if (!this.reconnectWarning) {
          this.reconnectWarning = true;
          this.log('warning', '检测到校园网已断开，但没有可用密码；将继续检测，请手动连接一次或保存密码以便自动重连。');
        }
        return;
      }
      this.reconnectWarning = false;
      this.log('info', '检测到校园网认证已断开，正在自动重连。', false);
      await this.connect(context, { automatic: true });
    } catch (error) {
      if (this.monitoring()) this.log('warning', this.networkError(error), true, this.errorDetails(error));
    } finally {
      this.monitorRunning = false;
      this.scheduleMonitor();
    }
  }
  dispose() {
    this.disposed = true;
    this.stopMonitoring();
    this.reconnectContext = null;
    if (this.session) delete this.session.password;
  }
  profile(id = this.settings.profileId) {
    const value = [...builtinProfiles, ...this.externalProfiles].find(p => p.id === id);
    if (!value) throw new Error('找不到连接方案，请重新选择。');
    return value;
  }
  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size > 1024 * 1024) throw new Error('oversized');
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.profiles) || saved.profiles.length > 30) throw new Error('version');
      this.externalProfiles = saved.profiles.map(p => validateProfile(p));
      if (new Set(this.externalProfiles.map(p => p.id)).size !== this.externalProfiles.length) throw new Error('duplicate');
      this.settings = this.validatedSettings({ ...defaults(), ...saved.settings });
      const cred = saved.credential;
      if (this.settings.rememberPassword && cred && cred.profileId === this.settings.profileId && cred.username === this.settings.username && ((typeof cred.password === 'string' && cred.password.length > 0 && cred.password.length <= 1024) || (typeof cred.encrypted === 'string' && cred.encrypted.length < 20000))) this.credential = cred;
      if (!this.credential) this.settings.autoConnect = false;
      if (!this.appInfo.packaged) this.settings.autoLaunch = false;
    } catch {
      this.settings = defaults(); this.externalProfiles = []; this.credential = null;
      this.log('warning', '本地配置无法读取，已使用默认设置。原文件将保留至下次保存。', false);
    }
  }
  persist() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const content = JSON.stringify({ version: 1, settings: this.settings, profiles: this.externalProfiles, credential: this.settings.rememberPassword ? this.credential : null }, null, 2);
    try { fs.writeFileSync(temp, content, { mode: 0o600 }); fs.renameSync(temp, this.file); }
    catch { try { fs.unlinkSync(temp); } catch {} throw new Error('无法保存本地配置，请检查文件夹权限。'); }
  }
  log(level, message, publish = true, details) {
    this.logs.unshift({ id: randomUUID(), time: new Date().toISOString(), level, message, ...(details ? { details } : {}) });
    this.logs = this.logs.slice(0, 100);
    if (publish) this.publish();
  }
  snapshot() {
    return structuredClone({ settings: this.settings, hasPassword: Boolean(this.credential), profiles: [...builtinProfiles.map(p => publicProfile(p, true)), ...this.externalProfiles.map(p => publicProfile(p))], connection: { ...this.connection, refreshing: this.refreshing, canDisconnect: Boolean(this.session || this.connection.status === 'connected'), monitoring: this.monitoring(), reconnectPaused: this.reconnectPaused }, logs: this.logs, app: { ...this.appInfo, secureStorage: this.storageAvailable() } });
  }
  publish() { const value = this.snapshot(); this.emit('snapshot', value); return value; }
  assertIdle() { if (this.busy) throw new Error('正在处理网络请求，请稍候。'); }
  validatedSettings(input) {
    keys(input, ['profileId', 'username', 'rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'reconnectIntervalSeconds', 'minimizeToTray', 'appearance', 'parameters'], '设置');
    if (typeof input.profileId !== 'string') throw new Error('连接方案无效。');
    const profile = this.profile(input.profileId);
    if (typeof input.username !== 'string' || input.username.length > 200 || /[\r\n\u0000]/.test(input.username)) throw new Error('账号格式无效。');
    for (const key of ['rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'minimizeToTray']) if (typeof input[key] !== 'boolean') throw new Error('设置值无效。');
    if (!Number.isInteger(input.reconnectIntervalSeconds) || input.reconnectIntervalSeconds < 5 || input.reconnectIntervalSeconds > 3600) throw new Error('检测间隔必须是 5 至 3600 秒的整数。');
    if (input.appearance !== 'classic' && input.appearance !== 'liquid') throw new Error('界面外观设置无效。');
    return { ...input, username: input.username.trim(), parameters: profileParameters(profile, input.parameters) };
  }
  saveSettings(patch) {
    this.assertIdle();
    keys(patch, ['profileId', 'username', 'rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'reconnectIntervalSeconds', 'minimizeToTray', 'parameters'], '设置');
    const previousSettings = this.settings;
    const changedProfile = patch.profileId !== undefined && patch.profileId !== this.settings.profileId;
    if (changedProfile && (this.session || this.connection.status === 'connected')) throw new Error('请先断开当前认证，再切换连接方案。');
    const next = this.validatedSettings({ ...this.settings, ...patch, parameters: changedProfile ? (patch.parameters || {}) : (patch.parameters || this.settings.parameters) });
    const changedIdentity = next.profileId !== this.settings.profileId || next.username !== this.settings.username;
    if (changedIdentity && (this.session || this.connection.status === 'connected')) throw new Error('请先断开当前认证，再更改账号或连接方案。');
    const credential = !next.rememberPassword || changedIdentity ? null : this.credential;
    if (patch.autoConnect === true && (!next.rememberPassword || !credential || !this.decryptPassword())) throw new Error('请先在「应用设置 → 密码管理」保存账号密码，再启用自动连接。');
    if (!next.rememberPassword || changedIdentity) next.autoConnect = false;
    if (next.autoConnect && !credential) throw new Error('请先在「应用设置 → 密码管理」保存账号密码，再启用自动连接。');
    if (next.autoConnect && this.profile(next.profileId).protocol === 'http' && !this.profile(next.profileId).operations.status) throw new Error('启用自动连接需要方案提供只读状态查询。');
    if (next.autoLaunch !== this.settings.autoLaunch) next.autoLaunch = this.autoLaunch(next.autoLaunch);
    this.credential = credential;
    this.settings = next;
    const changedContext = changedIdentity || JSON.stringify(next.parameters) !== JSON.stringify(previousSettings.parameters);
    if (changedContext) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    if (!next.autoReconnect) this.stopMonitoring();
    if (!previousSettings.autoReconnect && next.autoReconnect && this.connection.status === 'connected' && !changedContext) {
      this.reconnectPaused = false;
      this.armMonitoring();
    }
    if (next.reconnectIntervalSeconds !== previousSettings.reconnectIntervalSeconds) { this.cancelMonitorTimer(); this.scheduleMonitor(); }
    if (changedProfile) this.connection = IDLE();
    this.persist();
    return this.publish();
  }
  setAppearance(value) {
    // 界面外观切换与网络状态无关：不受连接忙碌限制，仅持久化并广播快照。
    if (value !== 'classic' && value !== 'liquid') throw new Error('界面外观设置无效。');
    if (value === this.settings.appearance) return this.snapshot();
    this.settings = { ...this.settings, appearance: value };
    this.persist();
    return this.publish();
  }
  setCredentials(input) {
    // 明文账号密码管理：不受连接忙碌限制；连接中仅允许改密码，改账号需先断开。
    keys(input, ['username', 'password'], '账号密码');
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    if (!username || username.length > 200 || /[\r\n\u0000]/.test(username)) throw new Error('账号格式无效。');
    if (typeof input.password !== 'string' || !input.password || input.password.length > 1024 || /[\r\n\u0000]/.test(input.password)) throw new Error('密码格式无效。');
    const changedIdentity = username !== this.settings.username;
    if (changedIdentity && (this.session || this.connection.status === 'connected')) throw new Error('请先断开当前认证，再更改账号。');
    this.credential = { profileId: this.settings.profileId, username, password: input.password };
    this.settings = { ...this.settings, username, rememberPassword: true, ...(changedIdentity ? { autoConnect: false } : {}) };
    if (changedIdentity) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    this.persist();
    return this.publish();
  }
  decryptPassword() {
    // 明文直读；旧版加密凭据仅作只读兜底，解密失败视为未保存。
    if (!this.credential) return '';
    if (typeof this.credential.password === 'string') return this.credential.password;
    if (typeof this.credential.encrypted === 'string' && this.storageAvailable()) {
      try { return this.safeStorage.decryptString(Buffer.from(this.credential.encrypted, 'base64')); }
      catch { return ''; }
    }
    return '';
  }
  async connect(input, { automatic = false } = {}) {
    if (this.disposed) throw new Error('应用已停止，无法继续连接。');
    this.assertIdle();
    keys(input, ['profileId', 'username', 'password', 'rememberPassword', 'parameters'], '连接请求');
    if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 1024 || /[\r\n\u0000]/.test(input.password))) throw new Error('密码格式无效。');
    const next = this.validatedSettings({ ...this.settings, profileId: input.profileId || this.settings.profileId, username: input.username ?? this.settings.username, rememberPassword: input.rememberPassword ?? this.settings.rememberPassword, parameters: input.parameters ?? this.settings.parameters });
    if (!next.username) throw new Error('请输入校园网账号。');
    if (this.session || this.connection.status === 'connected') throw new Error('当前已有认证会话，请先检查状态或断开后重试。');
    const sameIdentity = next.profileId === this.settings.profileId && next.username === this.settings.username;
    const password = input.password || (sameIdentity ? this.decryptPassword() : '');
    if (!password) throw new Error('请输入校园网密码。');
    let credential = automatic ? this.credential : null;
    if (automatic && (!sameIdentity || JSON.stringify(next.parameters) !== JSON.stringify(this.settings.parameters))) throw new Error('认证身份已变化，请手动连接。');
    if (!automatic && next.rememberPassword) credential = { profileId: next.profileId, username: next.username, password };
    else if (!next.rememberPassword) next.autoConnect = false;
    if (!sameIdentity || JSON.stringify(next.parameters) !== JSON.stringify(this.settings.parameters)) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    this.credential = credential;
    this.settings = next;
    if (!automatic) this.persist();
    const profile = this.profile();
    const generation = this.monitorGeneration;
    // A new login attempt starts a fresh interval after it finishes. An older
    // pending timer must not query or retry immediately after that attempt.
    this.cancelMonitorTimer();
    this.busy = true;
    this.connection = { status: 'connecting', message: '正在向校园网认证服务器提交认证…' };
    this.log('info', '正在连接校园网。');
    try {
      const result = await this.operation(profile, 'login', { username: next.username, password, parameters: next.parameters });
      if (this.disposed) return this.snapshot();
      this.session = { profileId: profile.id, username: next.username, password, parameters: next.parameters };
      this.connection = { status: 'connected', message: result.message, ip: result.ip, portalUrl: result.portalUrl, since: new Date().toISOString() };
      if (generation === this.monitorGeneration && !this.disposed) {
        if (!automatic) this.reconnectPaused = false;
        this.reconnectContext = { ...this.session };
        this.reconnectWarning = false;
        this.armMonitoring();
      }
      this.log('success', '校园网认证成功。', false);
    } catch (error) {
      if (!this.disposed && error instanceof CampusError && error.code === 'VERIFY_FAILED') this.session = { profileId: profile.id, username: next.username, password, parameters: next.parameters };
      if (error instanceof CampusError && error.code === 'CAPTCHA_REQUIRED') { this.stopMonitoring(); this.reconnectContext = null; }
      this.connection = { status: 'error', message: this.networkError(error) }; this.log('error', this.connection.message, false, this.errorDetails(error));
    }
    finally { this.busy = false; this.lastStatusCheck = this.now(); this.scheduleMonitor(); }
    return this.publish();
  }
  networkError(error) { return error instanceof CampusError ? error.message : '操作未完成，请检查校园网络或打开认证页重试。'; }
  errorDetails(error) { return { code: error instanceof CampusError ? error.code : 'REQUEST_FAILED', requests: error instanceof CampusError && Array.isArray(error.diagnostics) ? error.diagnostics : [] }; }
  async disconnect() {
    // The user's intent to log out cancels reconnection immediately, even if
    // another request is busy or the logout request itself later fails.
    this.reconnectPaused = true;
    this.stopMonitoring();
    this.reconnectContext = null;
    this.publish();
    this.assertIdle();
    const context = this.session || { username: this.settings.username, parameters: this.settings.parameters, profileId: this.settings.profileId };
    this.busy = true;
    this.connection = { ...this.connection, status: 'disconnecting', message: '正在退出校园网认证…' }; this.publish();
    try {
      await this.operation(this.profile(context.profileId), 'logout', context);
      this.session = null;
      this.connection = { status: 'idle', message: '已退出校园网认证。' };
      this.log('info', '已退出校园网认证。', false);
    } catch (error) { this.connection = { status: 'error', message: this.networkError(error) }; this.log('error', this.connection.message, false, this.errorDetails(error)); }
    finally { this.busy = false; }
    return this.publish();
  }
  async checkStatus({ silent = false } = {}) {
    this.assertIdle();
    const previous = this.connection;
    this.busy = true;
    this.lastStatusCheck = this.now();
    this.refreshing = true;
    if (!silent) this.connection = { ...previous, status: 'checking', message: '正在查询校园网认证状态…' };
    this.publish();
    try {
      const result = await this.operation(this.profile(), 'status', { username: this.settings.username, parameters: this.settings.parameters });
      this.connection = { status: result.online ? 'connected' : 'idle', message: result.message, ip: result.ip, portalUrl: result.portalUrl, checkedAt: new Date().toISOString(), ...(result.online && previous.since ? { since: previous.since } : {}) };
      if (!result.online) this.session = null;
      else if (!this.session) this.session = { profileId: this.settings.profileId, username: this.settings.username, parameters: this.settings.parameters };
      if (result.online) this.armMonitoring();
      if (!silent || previous.status !== this.connection.status) this.log(result.online ? 'success' : 'info', result.online ? '状态查询：当前已通过校园网认证。' : '状态查询：当前尚未认证。', false);
    } catch (error) {
      this.connection = { status: 'error', message: this.networkError(error), checkedAt: previous.checkedAt };
      if (!silent || previous.status !== 'error' || previous.message !== this.connection.message) this.log('warning', this.connection.message, false, this.errorDetails(error));
    }
    finally { this.busy = false; this.refreshing = false; }
    return this.publish();
  }
  async refreshStatus() {
    // Background reads must never race an explicit authentication action or spam logs.
    if (this.disposed || !this.settings.autoReconnect || this.reconnectPaused || this.busy || this.now() - this.lastStatusCheck < 5000) return this.snapshot();
    return this.checkStatus({ silent: true });
  }
  async onNetworkChanged() {
    // Called by the interface watcher when the active network changed, for
    // example because campus Wi-Fi was just joined. Unlike a focus refresh
    // this follows a real state change, so it may bypass the five second read
    // throttle; the busy guard still serializes it with explicit user actions.
    if (this.disposed || this.busy) return this.snapshot();
    if (this.monitoring()) return this.monitorTick();
    if (!this.settings.autoReconnect || this.reconnectPaused) return this.snapshot();
    return this.checkStatus({ silent: true });
  }
  setGuardPaused(paused) {
    // 托盘快捷开关：暂停只停止定时检测与自动重连，不注销当前会话。
    if (this.disposed) return this.snapshot();
    if (typeof paused !== 'boolean') throw new Error('守护状态无效。');
    if (paused === this.reconnectPaused) return this.snapshot();
    this.reconnectPaused = paused;
    if (paused) this.stopMonitoring();
    else if (this.settings.autoReconnect && this.connection.status === 'connected') this.armMonitoring();
    return this.publish();
  }
  importProfile(text) {
    this.assertIdle();
    const profile = parseProfile(text);
    if (this.externalProfiles.some(p => p.id === profile.id)) throw new Error('此方案 ID 已存在，请先移除旧方案或更改 ID。');
    if (this.externalProfiles.length >= 30) throw new Error('最多导入 30 个外部方案。');
    this.externalProfiles.push(profile); this.persist(); this.log('success', '外部连接方案已导入。'); return this.snapshot();
  }
  removeProfile(id) {
    this.assertIdle();
    if (builtinProfiles.some(p => p.id === id)) throw new Error('内置方案不能移除。');
    this.profile(id);
    if (this.session?.profileId === id || (this.connection.status === 'connected' && this.settings.profileId === id)) throw new Error('请先断开当前认证，再移除方案。');
    this.externalProfiles = this.externalProfiles.filter(p => p.id !== id);
    if (this.settings.profileId === id) { this.stopMonitoring(); this.reconnectContext = null; this.settings = { ...this.settings, profileId: defaultProfile.id, parameters: profileParameters(defaultProfile), autoConnect: false }; this.credential = null; this.connection = IDLE(); }
    this.persist(); this.log('info', '外部连接方案已移除。'); return this.snapshot();
  }
  clearCredentials() {
    this.assertIdle(); this.credential = null;
    if (this.session) delete this.session.password;
    this.reconnectContext = null;
    this.reconnectWarning = false;
    this.settings.rememberPassword = false; this.settings.autoConnect = false;
    this.persist(); this.log('info', '已清除保存的密码，并关闭自动连接。'); return this.snapshot();
  }
  async initialize() {
    if (this.disposed) return this.snapshot();
    const generation = this.monitorGeneration;
    this.log('info', '正在检查启动后的校园网认证状态。');
    const snapshot = await this.checkStatus();
    // The initial read must not authorize a later login after shutdown or a
    // manual pause canceled this startup operation while it was in flight.
    if (this.disposed || this.reconnectPaused || generation !== this.monitorGeneration) return this.snapshot();
    if (snapshot.connection.status === 'connected') return this.snapshot();
    if (snapshot.connection.status !== 'idle' || !this.settings.autoConnect || !this.settings.rememberPassword || !this.credential) return this.snapshot();
    this.log('info', '当前未认证，已按设置开始自动连接。');
    return this.connect({});
  }
  async autoConnectIfEnabled() {
    if (!this.settings.autoConnect || !this.settings.rememberPassword || !this.credential) return this.snapshot();
    return this.initialize();
  }
}

module.exports = { CampusService, defaults };
