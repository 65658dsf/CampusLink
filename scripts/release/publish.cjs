'use strict';

// NingMeng123 — called only by the contents:write publish job after every build succeeds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { artifactNames, versionFromTag } = require('./config.cjs');

function prepareAssets(directory, version, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A verified source commit is required.');
  const builds = [];
  const assets = [];
  const expected = new Set();
  const readFile = filename => {
    const file = path.join(directory, filename);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || !stat.size) throw new Error(`Artifact must be a nonempty regular file: ${filename}`);
    return fs.readFileSync(file);
  };
  for (const [platform, arch] of [['win', 'x64'], ['mac', 'x64'], ['mac', 'arm64']]) {
    const filename = `build-${platform}-${arch}.json`;
    expected.add(filename);
    const metadata = JSON.parse(readFile(filename));
    const files = artifactNames(version, platform, arch);
    if (metadata.version !== version || metadata.sourceCommit !== sha || metadata.platform !== platform || metadata.arch !== arch || JSON.stringify(metadata.files) !== JSON.stringify(files)) {
      throw new Error(`Artifact provenance mismatch: ${filename}`);
    }
    if (!['unsigned', 'developer-id'].includes(metadata.signing) || typeof metadata.notarized !== 'boolean' || (metadata.notarized && metadata.signing !== 'developer-id') || (platform === 'win' && metadata.signing !== 'unsigned')) {
      throw new Error(`Invalid signing metadata: ${filename}`);
    }
    builds.push(metadata);
    for (const file of files) { expected.add(file); readFile(file); assets.push(file); }
  }
  for (const file of fs.readdirSync(directory)) if (!expected.has(file)) throw new Error(`Unexpected release artifact: ${file}`);
  fs.writeFileSync(path.join(directory, 'build-info.json'), `${JSON.stringify({ version, sourceCommit: sha, builds }, null, 2)}\n`);
  assets.push('build-info.json');
  const sums = assets.map(file => `${crypto.createHash('sha256').update(readFile(file)).digest('hex')}  ${file}`).join('\n');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${sums}\n`);
  assets.push('SHA256SUMS.txt');
  return { assets, builds };
}

function releaseNotes(version, builds, generatedNotes = '', { authored = false } = {}) {
  const mac = builds.filter(item => item.platform === 'mac').map(item => `- macOS ${item.arch}：${item.signing === 'unsigned' ? '未签名、未公证' : item.notarized ? '使用 Developer ID 签名，并已完成构建公证步骤' : '使用 Developer ID 签名，未公证'}。`);
  if (authored) return [generatedNotes.trim(), '', '## 本次构建签名记录', '', '- Windows x64：未签名。', ...mac, '', '源码提交及校验值见随版本提供的 `build-info.json` 和 `SHA256SUMS.txt`。', ''].join('\n');
  const changes = version === '1.1.0' ? [
    '## 本版更新', '',
    '- 新增断线自动重连：成功认证或确认在线后持续检测，只在明确离线时使用本次会话或已保存的凭据重连。',
    '- 检测间隔可设为 5–3600 秒，默认 30 秒；手动注销立即暂停守护，避免刚退出又自动登录。',
    '- 新增 macOS 窗口、菜单栏、钥匙串和登录项适配，以及 Intel / Apple Silicon 两种构建目标。系统行为仍需对应设备验收。',
    '- 新增标签驱动的 GitHub Actions 发布：完整校验、三平台打包、产物校验和及统一 Release 上传。', '',
  ] : [generatedNotes, ''];
  return [
    `# 岚连 · CDUTYB 专版 v${version}`, '', '上游作者：NingMeng123（基于 Campus Link）；本专版：岚连 · CDUTYB 专版', '',
    ...changes,
    '提供 Windows x64 安装程序，以及 Intel Mac（x64）和 Apple Silicon（arm64）各自的 DMG / ZIP。请按设备架构选择。', '',
    'Windows 构建未配置代码签名，系统可能显示未知发布者提示。', ...mac, '',
    '未签名或未公证的 macOS 构建可能被 Gatekeeper 拦截，开机自启动也可能不可用。请核对下载来源及系统提示；本项目不建议关闭系统安全保护。', '',
    '本次自动化包含 Linux 单元测试、界面构建和 Windows 本机模拟服务桌面检查。macOS 产物来自对应架构的 GitHub runner；打包成功不代表已完成 macOS 真机校园认证、钥匙串或登录项验收。', '',
    '`SHA256SUMS.txt` 提供安装产物和 `build-info.json` 的 SHA-256 校验值；`build-info.json` 记录源码提交、平台、架构和构建签名状态。', '',
    '发布流程与可选签名配置见仓库 docs/releases.md。', '',
  ].join('\n');
}

function main() {
  const tag = process.env.RELEASE_TAG;
  const version = versionFromTag(tag);
  const sha = process.env.RELEASE_SHA || '';
  const directory = path.resolve(process.argv[2] || 'release-assets');
  if (!process.env.GH_TOKEN || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GH_REPO || '')) throw new Error('The isolated release job must supply GH_TOKEN and GH_REPO.');
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remoteSha = gh('api', `repos/${process.env.GH_REPO}/commits/${tag}`, '--jq', '.sha');
  if (remoteSha !== sha) throw new Error('The remote release tag moved after validation; nothing was published.');
  const { assets, builds } = prepareAssets(directory, version, sha);
  const notes = path.join(directory, 'release-notes.md');
  const authoredNotes = path.resolve(__dirname, '../../docs', `releases-v${version}.md`);
  const generatedNotes = fs.existsSync(authoredNotes) ? fs.readFileSync(authoredNotes, 'utf8') : version === '1.1.0' ? '' : gh('api', `repos/${process.env.GH_REPO}/releases/generate-notes`, '-f', `tag_name=${tag}`, '--jq', '.body');
  fs.writeFileSync(notes, releaseNotes(version, builds, generatedNotes, { authored: fs.existsSync(authoredNotes) }));
  const existing = JSON.parse(gh('release', 'list', '--limit', '1000', '--json', 'tagName,isDraft')).find(item => item.tagName === tag);
  if (existing && !existing.isDraft) throw new Error('This version is already published. Do not overwrite it; release a new version.');
  if (!existing) gh('release', 'create', tag, '--verify-tag', '--draft', '--title', `岚连 · CDUTYB 专版 ${tag}`, '--notes-file', notes);
  else gh('release', 'edit', tag, '--title', `岚连 · CDUTYB 专版 ${tag}`, '--notes-file', notes);
  gh('release', 'upload', tag, ...assets.map(file => path.join(directory, file)), '--clobber');
  // A failed upload leaves a recoverable draft instead of a partial public release.
  gh('release', 'edit', tag, '--draft=false');
  console.log(`Published ${tag} with all five installers, build information and checksums.`);
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }

module.exports = { prepareAssets, releaseNotes };
