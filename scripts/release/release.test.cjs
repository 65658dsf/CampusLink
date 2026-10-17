'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { versionFromTag, assertVersions, artifactNames, macSigning } = require('./config.cjs');
const { validateRef } = require('./validate-ref.cjs');
const { prepareAssets, releaseNotes } = require('./publish.cjs');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('release names reject arbitrary refs, expressions, prereleases and mismatched lockfiles', () => {
  assert.equal(versionFromTag('v1.1.0'), '1.1.0');
  for (const tag of ['main', 'v1.1.0~1', '--help', 'v1.1.0\nmain', 'v01.1.0', 'v1.1.0-beta.1', 'v1.1.0;echo bad']) assert.throws(() => versionFromTag(tag));
  const lock = { version: '1.1.0', packages: { '': { version: '1.1.0' } } };
  assertVersions({ version: '1.1.0' }, lock, '1.1.0');
  assert.throws(() => assertVersions({ version: '1.1.0' }, { ...lock, version: '1.0.2' }, '1.1.0'));
});

test('all release targets have distinct architecture-aware filenames and unsigned defaults', () => {
  const names = [['win', 'x64'], ['mac', 'x64'], ['mac', 'arm64']].flatMap(([p, a]) => artifactNames('1.1.0', p, a));
  assert.equal(new Set(names).size, 5);
  assert.ok(names.includes('Campus-Link-Glass-Setup-1.1.0.exe'));
  assert.throws(() => artifactNames('1.1.0', 'win', 'arm64'));
  assert.deepEqual(macSigning({}), { signing: 'unsigned', notarized: false });
  assert.deepEqual(macSigning({ CSC_LINK: 'fixture-certificate' }), { signing: 'developer-id', notarized: false });
  assert.deepEqual(macSigning({ CSC_LINK: 'fixture', APPLE_ID: 'fixture', APPLE_APP_SPECIFIC_PASSWORD: 'fixture', APPLE_TEAM_ID: 'fixture' }), { signing: 'developer-id', notarized: true });
  assert.throws(() => macSigning({ APPLE_ID: 'fixture' }));
  assert.throws(() => macSigning({ CSC_LINK: 'fixture', APPLE_TEAM_ID: 'fixture' }));
});

test('release ref must exist, match its version and belong to main; manual workflow must run from main', t => {
  const cwd = temporary(t);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'NingMeng123'); git('config', 'user.email', 'release-test@example.invalid');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({ version: '1.1.0', packages: { '': { version: '1.1.0' } } }));
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'release fixture');
  const sha = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', sha); git('tag', 'v1.1.0');
  assert.deepEqual(validateRef({ cwd, event: 'push', ref: 'refs/tags/v1.1.0' }), { release: 'true', tag: 'v1.1.0', sha, version: '1.1.0' });
  assert.equal(validateRef({ cwd, event: 'workflow_dispatch', ref: 'refs/heads/main', inputTag: 'v1.1.0' }).sha, sha);
  assert.throws(() => validateRef({ cwd, event: 'workflow_dispatch', ref: 'refs/heads/other', inputTag: 'v1.1.0' }));
  assert.throws(() => validateRef({ cwd, event: 'workflow_dispatch', ref: 'refs/heads/main', inputTag: 'main' }));
  git('tag', 'v1.1.1'); assert.throws(() => validateRef({ cwd, event: 'push', ref: 'refs/tags/v1.1.1' }));
  git('switch', '-c', 'unmerged'); fs.writeFileSync(path.join(cwd, 'unmerged.txt'), 'fixture'); git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'unmerged fixture');
  git('tag', '-f', 'v1.1.0'); assert.throws(() => validateRef({ cwd, event: 'push', ref: 'refs/tags/v1.1.0' }));
});

function assetFixture(t) {
  const directory = temporary(t), sha = 'a'.repeat(40), version = '1.1.0';
  for (const [platform, arch] of [['win', 'x64'], ['mac', 'x64'], ['mac', 'arm64']]) {
    const files = artifactNames(version, platform, arch);
    for (const file of files) fs.writeFileSync(path.join(directory, file), `fixture ${file}`);
    fs.writeFileSync(path.join(directory, `build-${platform}-${arch}.json`), JSON.stringify({ version, sourceCommit: sha, platform, arch, files, signing: 'unsigned', notarized: false }));
  }
  return { directory, version, sha };
}

test('publish assembly requires all platforms, records unsigned status and generates correct hashes', t => {
  const { directory, version, sha } = assetFixture(t);
  const result = prepareAssets(directory, version, sha);
  assert.equal(result.assets.length, 7);
  const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(sums.length, 6);
  for (const line of sums) { const [hash, file] = line.split('  '); assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')); }
  const notes = releaseNotes(version, result.builds);
  assert.match(notes, /未签名、未公证/); assert.match(notes, /不代表已完成 macOS 真机/);
});

test('missing, foreign or unexpected assets cannot be published', t => {
  const missing = assetFixture(t); fs.unlinkSync(path.join(missing.directory, 'Campus-Link-1.1.0-mac-arm64.dmg'));
  assert.throws(() => prepareAssets(missing.directory, missing.version, missing.sha));
  const foreign = assetFixture(t); assert.throws(() => prepareAssets(foreign.directory, foreign.version, 'b'.repeat(40)), /provenance/);
  const extra = assetFixture(t); fs.writeFileSync(path.join(extra.directory, 'private.txt'), 'not a release artifact');
  assert.throws(() => prepareAssets(extra.directory, extra.version, extra.sha), /Unexpected/);
});

test('authored release notes retain one title and append actual signing metadata', () => {
  const authored = '# 岚连 Campus Link v1.1.1\n\n新增锐捷与认证入口发现。';
  const notes = releaseNotes('1.1.1', [{ platform: 'mac', arch: 'arm64', signing: 'unsigned', notarized: false }], authored, { authored: true });
  assert.equal(notes.split('# 岚连 Campus Link v1.1.1').length, 2);
  assert.match(notes, /新增锐捷与认证入口发现/);
  assert.match(notes, /macOS arm64：未签名、未公证/);
});
