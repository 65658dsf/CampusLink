const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js')], { cwd: root, stdio: 'inherit', windowsHide: true });
let desktop;
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  desktop?.kill();
  vite.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('exit', code => stop(code || 0));
(async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok) {
        const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
        delete env.ELECTRON_RUN_AS_NODE;
        desktop = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env, windowsHide: true });
        desktop.on('exit', code => stop(code || 0));
        desktop.on('error', error => { console.error(error.message); stop(1); });
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.error('开发服务器未能启动。');
  stop(1);
})();
