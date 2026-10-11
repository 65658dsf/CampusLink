'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { artifactNames, macSigning } = require('./config.cjs');

function main() {
  const [platform, arch] = process.argv.slice(2);
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = artifactNames(manifest.version, platform, arch);
  if ((platform === 'mac' && process.platform !== 'darwin') || (platform === 'win' && process.platform !== 'win32')) throw new Error('Use a native Windows or macOS host to build this target.');
  const env = { ...process.env };
  // Only the isolated publish job receives a release token. Builds never publish.
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  const args = [require.resolve('electron-builder/cli.js'), platform === 'mac' ? '--mac' : '--win', ...(platform === 'mac' ? ['dmg', 'zip'] : ['nsis']), `--${arch}`, '--publish', 'never'];
  let security = { signing: 'unsigned', notarized: false };
  if (platform === 'mac') {
    security = macSigning(env);
    args.push(`--config.mac.notarize=${security.notarized}`);
    if (security.signing === 'unsigned') {
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
      delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD; delete env.CSC_NAME;
      args.push('--config.mac.identity=null');
    } else {
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
      args.push('--config.forceCodeSigning=true');
    }
  } else {
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) delete env[key];
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  console.log(`Building ${platform}/${arch}: ${security.signing}; notarization ${security.notarized ? 'enabled' : 'disabled'}.`);
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder failed (exit ${result.status ?? result.signal}).`);
  for (const file of files) if (!fs.statSync(path.join(root, 'release', file)).size) throw new Error(`Missing or empty artifact: ${file}`);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const info = { version: manifest.version, platform, arch, sourceCommit, ...security, files };
  fs.writeFileSync(path.join(root, 'release', `build-${platform}-${arch}.json`), `${JSON.stringify(info, null, 2)}\n`);
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
