'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Tray, Menu, nativeImage, session, powerMonitor, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { CampusService } = require('./service.cjs');
const { MAX_PROFILE_BYTES, safeUrl, parseProfile } = require('./profiles.cjs');

app.setName('岚连 · Campus Link');
app.setAppUserModelId('cn.campuslink.desktop');
if (!app.isPackaged && process.env.CAMPUS_LINK_DATA_DIR) app.setPath('userData', path.resolve(process.env.CAMPUS_LINK_DATA_DIR));
const isPrimary = app.requestSingleInstanceLock();
let win = null;
let tray = null;
let service = null;
let quitting = false;
const indexPath = path.resolve(__dirname, '../dist/index.html');
const indexUrl = pathToFileURL(indexPath).href;
let devUrl = null;
if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
  const parsed = new URL(process.env.VITE_DEV_SERVER_URL);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('开发服务器仅允许本地 HTTP 地址');
  devUrl = parsed;
}

function trusted(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
  const frame = event.senderFrame;
  if (!frame) return false;
  if (devUrl) return frame.origin === devUrl.origin && new URL(frame.url).origin === devUrl.origin;
  // A file origin alone is opaque. Pin the exact document and the owned main frame as well.
  return frame.url.split('#')[0] === indexUrl;
}
function registerIpc() {
  const handle = (method, handler) => ipcMain.handle(`campus:${method}`, async (event, ...args) => {
    if (!trusted(event)) throw new Error('已拒绝不受信任的页面请求。');
    return handler(...args);
  });
  handle('getSnapshot', () => service.snapshot());
  handle('copyText', text => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
  });
  handle('saveSettings', async patch => {
    const previousProfile = service.settings.profileId;
    const snapshot = service.saveSettings(patch);
    return previousProfile !== service.settings.profileId ? service.checkStatus() : snapshot;
  });
  handle('connect', input => service.connect(input));
  handle('disconnect', () => service.disconnect());
  handle('checkStatus', () => service.checkStatus());
  handle('clearCredentials', () => service.clearCredentials());
  handle('removeProfile', id => service.removeProfile(id));
  handle('importProfile', async () => {
    const result = await dialog.showOpenDialog(win, { title: '导入校园网连接方案', properties: ['openFile'], filters: [{ name: '连接方案 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, snapshot: service.snapshot() };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > MAX_PROFILE_BYTES) throw new Error('连接方案文件不能超过 64 KB。');
    const text = fs.readFileSync(file, 'utf8');
    const profile = parseProfile(text);
    const endpoints = Object.entries(profile.operations).map(([name, operation]) => `${name}: ${operation.method} ${operation.url}`).join('\n');
    const confirmation = await dialog.showMessageBox(win, {
      type: 'question', title: '确认导入连接方案', message: `导入「${profile.name}」？`,
      detail: `作者：${profile.author || '未填写'}\n版本：${profile.version}\n认证页：${profile.homepage}\n\n请求地址（均与认证页同源）：\n${endpoints}\n\n连接时，账号和密码会发送给此方案指定的认证服务器。请确认你信任该方案及其地址。`,
      buttons: ['取消', '信任并导入'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true, snapshot: service.snapshot() };
    return { canceled: false, snapshot: service.importProfile(text) };
  });
  handle('exportExample', async () => {
    const result = await dialog.showSaveDialog(win, { title: '保存连接方案示例', defaultPath: 'custom-campus.example.json', filters: [{ name: '连接方案 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.copyFileSync(path.join(__dirname, '../examples/custom-campus.example.json'), result.filePath);
    service.log('success', '连接方案示例已保存。');
    return { canceled: false, path: result.filePath };
  });
  handle('openPortal', async id => {
    const profile = service.profile(id);
    const url = safeUrl(profile.homepage);
    await shell.openExternal(url.href);
  });
  handle('windowAction', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else throw new Error('窗口操作无效。');
  });
}

function iconImage() {
  const target = path.resolve(__dirname, '../assets/icon.png');
  if (fs.existsSync(target)) {
    const icon = nativeImage.createFromPath(target);
    if (!icon.isEmpty()) return icon;
  }
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 220; pixels[i + 1] = 100; pixels[i + 2] = 66; pixels[i + 3] = 255; }
  return nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
}
function showWindow() { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }
function trayAction(action) {
  Promise.resolve().then(action).catch(() => service.log('warning', '操作未完成，请打开主窗口检查当前设置。'));
}
function updateTray(snapshot) {
  if (!tray || tray.isDestroyed()) return;
  const busy = snapshot.connection.refreshing || ['checking', 'connecting', 'disconnecting'].includes(snapshot.connection.status);
  tray.setToolTip(`岚连 · ${snapshot.connection.status === 'connected' ? '校园网已连接' : '校园网连接工具'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开岚连', click: showWindow },
    { type: 'separator' },
    { label: '查询认证状态', enabled: !busy, click: () => trayAction(() => service.checkStatus()) },
    { label: '连接校园网', enabled: !busy && !snapshot.connection.canDisconnect && snapshot.hasPassword, click: () => trayAction(() => service.connect({})) },
    { label: '断开认证', enabled: !busy && snapshot.connection.canDisconnect, click: () => trayAction(() => service.disconnect()) },
    { type: 'separator' },
    { label: '退出岚连', click: () => { quitting = true; app.quit(); } },
  ]));
}
function configureSession() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  const connect = devUrl ? `'self' ${devUrl.origin} ws://${devUrl.host}` : "'none'";
  const script = devUrl ? "'self' 'unsafe-inline'" : "'self'";
  const csp = `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1260, height: 850, minWidth: 1000, minHeight: 720, show: false, frame: false,
    title: '岚连 · Campus Link', backgroundColor: '#f6f7fb', icon: iconImage(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged },
  });
  if (process.platform !== 'darwin') win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.once('ready-to-show', () => {
    const openedAtLogin = process.argv.includes('--autostart') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    if (!openedAtLogin) win.show();
  });
  win.on('focus', () => { if (service) void service.refreshStatus().catch(() => {}); });
  win.on('close', event => {
    if (!quitting && service.settings.minimizeToTray && tray) { event.preventDefault(); win.hide(); }
    else quitting = true;
  });
  win.on('closed', () => { win = null; });
  if (devUrl) win.loadURL(devUrl.href); else win.loadFile(indexPath);
}

if (!isPrimary) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; service?.dispose(); });
  app.on('window-all-closed', () => { if (!tray || quitting) app.quit(); });
  app.on('activate', showWindow);
  app.whenReady().then(() => {
    service = new CampusService({
      directory: app.getPath('userData'), safeStorage, version: app.getVersion(), packaged: app.isPackaged,
      autoLaunch: enabled => {
        if (!['win32', 'darwin'].includes(process.platform)) throw new Error('开机自启动支持 Windows 和 macOS。');
        if (!app.isPackaged) throw new Error('开发预览不注册开机自启动，请安装正式版后设置。');
        const options = process.platform === 'win32' ? { path: process.execPath, args: ['--autostart'] } : {};
        app.setLoginItemSettings({ ...options, openAtLogin: enabled, ...(process.platform === 'win32' ? { enabled } : {}) });
        const actual = app.getLoginItemSettings(options).openAtLogin;
        if (actual !== enabled) throw new Error('开机自启动设置未生效，请检查系统登录项或启动应用设置。');
        return actual;
      },
    });
    if (app.isPackaged && ['win32', 'darwin'].includes(process.platform)) service.settings.autoLaunch = app.getLoginItemSettings(process.platform === 'win32' ? { path: process.execPath, args: ['--autostart'] } : {}).openAtLogin;
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
    ]));
    configureSession(); registerIpc(); createWindow();
    tray = new Tray(iconImage().resize({ width: 20, height: 20 }));
    tray.on('double-click', showWindow);
    service.on('snapshot', snapshot => { if (win && !win.isDestroyed()) win.webContents.send('campus:snapshot', snapshot); updateTray(snapshot); });
    updateTray(service.snapshot());
    void service.initialize().catch(() => service.log('warning', '启动状态检查未完成，请点击检测网络重试。'));
    powerMonitor.on('resume', () => { void service.refreshStatus().catch(() => {}); });
  }).catch(() => {
    dialog.showErrorBox('岚连启动失败', '无法初始化校园网连接工具，请重新安装或检查应用数据目录权限。');
    quitting = true; app.quit();
  });
}
