// Desktop integration smoke: no real login/logout requests. Use a fresh, isolated profile.
const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-smoke-'));
  let online = true;
  let rejectLogin = true;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/login' && rejectLogin) {
      response.statusCode = 203;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<html><body>Error code: 203 Bad request(2) local-smoke-account local-smoke-secret<script>window.responseExecuted=true</script></body></html>');
    }
    else if (request.url === '/api/login') { online = true; response.end(JSON.stringify({ success: true })); }
    else if (request.url === '/api/logout') { online = false; response.end(JSON.stringify({ success: true })); }
    else response.end(JSON.stringify({ online }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mockOrigin = `http://127.0.0.1:${server.address().port}`;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/custom-campus.example.json'), 'utf8'));
  fixture.id = 'local-test-campus'; fixture.name = '本机测试大学'; fixture.homepage = `${mockOrigin}/`;
  for (const operation of Object.values(fixture.operations)) operation.url = operation.url.replace('https://campus.example.invalid', mockOrigin);
  const fixturePath = path.join(dataDirectory, 'local-fixture.json');
  const exportPath = path.join(dataDirectory, 'exported-example.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const startupProfile = { ...fixture, id: 'startup-test-campus', name: '启动检测测试大学' };
  fs.writeFileSync(path.join(dataDirectory, 'settings.json'), JSON.stringify({ version: 1,
    settings: { profileId: startupProfile.id, username: '', parameters: { operator: 'campus' }, rememberPassword: false, autoLaunch: false, autoConnect: false, minimizeToTray: true },
    profiles: [startupProfile], credential: null,
  }));
  const env = { ...process.env, CAMPUS_LINK_DATA_DIR: dataDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: [root], cwd: root, env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '校园生活，即刻在线.' })).toBeVisible();
    const security = await page.evaluate(() => ({ hasBridge: Boolean(window.campus), nodeAccess: typeof window.require }));
    assert.equal(security.hasBridge, true);
    assert.equal(security.nodeAccess, 'undefined');
    await expect(page.getByRole('heading', { name: '已登录校园网', exact: true })).toBeVisible();
    const initial = await page.evaluate(async () => { const s = await window.campus.getSnapshot(); return { autoConnect: s.settings.autoConnect, hasPassword: s.hasPassword, status: s.connection.status }; });
    assert.deepEqual(initial, { autoConnect: false, hasPassword: false, status: 'connected' });
    await expect(page.getByLabel('校园网账号', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('登录密码', { exact: true })).toHaveCount(0);
    assert.equal(requests.every(request => request.path === '/api/status'), true, 'Startup only performs status reads');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-online-mock.png'), fullPage: true });
    online = false; // Simulate a browser logout without sending a real logout request.
    await page.getByRole('button', { name: '检测网络', exact: true }).click();
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请先填写校园网账号');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await expect(page.getByRole('heading', { name: '贵州轻工职业大学', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '四川大学 · 锐捷 ePortal', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '活动日志', exact: true }).click();
    await expect(page.getByRole('heading', { name: '运行记录' })).toBeVisible();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('switch', { name: '开机自启动', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('开发预览不注册开机自启动');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请先');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await page.getByRole('button', { name: '使用帮助', exact: false }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '开始使用' }).click();
    // Exercise native file bridge and authentication only against the local test server.
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.fixturePath] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, { fixturePath, exportPath });
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('button', { name: '导出方案示例' }).click();
    await expect.poll(() => fs.existsSync(exportPath)).toBe(true);
    assert.deepEqual(JSON.parse(fs.readFileSync(exportPath, 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'examples/custom-campus.example.json'), 'utf8')));
    await page.getByRole('button', { name: '导出锐捷示例', exact: true }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(exportPath, 'utf8')).protocol).toBe('ruijie');
    assert.deepEqual(JSON.parse(fs.readFileSync(exportPath, 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'examples/ruijie-campus.example.json'), 'utf8')));
    await page.getByRole('button', { name: '导入连接方案', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
    await page.locator('article').filter({ has: page.getByRole('heading', { name: fixture.name, exact: true }) }).getByRole('button', { name: '使用此方案', exact: true }).click();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await page.getByLabel('校园网账号', { exact: true }).fill('local-smoke-account');
    await page.getByLabel('登录密码', { exact: true }).fill('local-smoke-secret');
    await page.getByRole('checkbox', { name: '记住密码' }).check();
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await page.getByRole('button', { name: '查看响应', exact: true }).first().click();
    const responseDialog = page.getByRole('dialog', { name: '服务器响应', exact: true });
    await expect(responseDialog).toBeVisible();
    await expect(responseDialog).toContainText('HTTP 203');
    await expect(responseDialog.getByLabel('请求 1 响应正文')).toContainText('Bad request(2)');
    await expect(responseDialog).not.toContainText('local-smoke-secret');
    await expect(responseDialog).not.toContainText('local-smoke-account');
    assert.equal(await page.evaluate(() => window.responseExecuted), undefined);
    await page.screenshot({ path: path.join(root, 'artifacts/response-details.png') });
    await page.getByRole('button', { name: '复制详情', exact: true }).click();
    await expect(responseDialog).toContainText('已复制');
    const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.ok(clipboard.includes('Bad request(2)'));
    assert.equal(clipboard.includes('local-smoke-secret'), false);
    await page.keyboard.press('Escape');
    await expect(responseDialog).not.toBeVisible();
    await page.getByRole('button', { name: '活动日志', exact: true }).click();
    await page.getByRole('button', { name: '查看响应', exact: true }).first().click();
    await expect(responseDialog).toBeVisible();
    await page.getByRole('button', { name: '关闭响应详情' }).click();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    rejectLogin = false;
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect(page.getByRole('button', { name: '注销校园网', exact: true })).toBeVisible();
    assert.equal(online, true);
    assert.equal(new URLSearchParams(requests.find(item => item.path === '/api/login').body).get('password'), 'local-smoke-secret');
    assert.equal(fs.readFileSync(path.join(dataDirectory, 'settings.json'), 'utf8').includes('local-smoke-secret'), false);
    await page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动后自动连接', exact: true })).toBeChecked();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '断线自动重连', exact: true })).toBeChecked();
    await expect(page.getByLabel('检测间隔（秒）', { exact: true })).toHaveValue('30');
    await page.getByLabel('检测间隔（秒）', { exact: true }).fill('5');
    await page.getByRole('button', { name: '保存间隔', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).settings.reconnectIntervalSeconds).toBe(5);
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    const loginCount = requests.filter(request => request.path === '/api/login').length;
    online = false;
    await expect.poll(() => requests.filter(request => request.path === '/api/login').length, { timeout: 12000 }).toBe(loginCount + 1);
    await expect(page.getByRole('heading', { name: '已登录校园网', exact: true })).toBeVisible();
    assert.equal(online, true, 'A confirmed outage reconnects with the saved session');
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).connection.monitoring).toBe(true);
    await page.getByRole('button', { name: '注销校园网', exact: true }).click();
    await expect(page.getByRole('button', { name: '连接校园网', exact: true })).toBeVisible();
    assert.equal(online, false);
    const paused = await page.evaluate(() => window.campus.getSnapshot());
    assert.equal(paused.connection.reconnectPaused, true);
    assert.equal(paused.connection.monitoring, false);
    const requestsAfterLogout = requests.length;
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.equal(requests.length, requestsAfterLogout, 'Manual logout stops both monitoring and reconnection');
    assert.equal(online, false);
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '清除密码', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动后自动连接', exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: '清除密码', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('button', { name: `删除${fixture.name}方案` }).click();
    await page.getByRole('button', { name: '确认移除' }).click();
    await expect(page.getByRole('heading', { name: fixture.name, exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-compact.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal overflow at minimum window size');
    assert.deepEqual(errors, []);
    // Closing with the tray preference disabled must actually quit, without changing network state.
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('switch', { name: '关闭时最小化到托盘', exact: true }).click();
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await closed;
    console.log('Desktop smoke passed: renderer bridge, navigation, validation, startup guards, profile import/export/removal, local mock authentication, configurable outage reconnection, manual logout pause, response details and redaction, native clipboard, actual Windows credential encryption, responsive layout, and exit.');
  } finally { await app.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
