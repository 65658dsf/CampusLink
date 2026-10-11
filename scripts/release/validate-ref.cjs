'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { versionFromTag, assertVersions } = require('./config.cjs');

function validateRef({ cwd = process.cwd(), event = process.env.GITHUB_EVENT_NAME, ref = process.env.GITHUB_REF, inputTag = process.env.RELEASE_TAG_INPUT || '' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const release = event === 'workflow_dispatch' || (event === 'push' && ref?.startsWith('refs/tags/'));
  let tag = '', sha = git('rev-parse', 'HEAD');
  if (release) {
    if (event === 'workflow_dispatch' && ref !== 'refs/heads/main') throw new Error('Run manual releases from the main workflow only.');
    tag = event === 'workflow_dispatch' ? inputTag : ref.slice('refs/tags/'.length);
    versionFromTag(tag); // Reject branches, revision syntax and command-like inputs before invoking Git.
    git('show-ref', '--verify', `refs/tags/${tag}`);
    sha = git('rev-parse', `refs/tags/${tag}^{commit}`);
    git('merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main');
    if (event === 'push' && sha !== git('rev-parse', 'HEAD')) throw new Error('Checked-out commit does not match the pushed tag.');
  }
  const manifest = JSON.parse(git('show', `${sha}:package.json`));
  const lock = JSON.parse(git('show', `${sha}:package-lock.json`));
  assertVersions(manifest, lock, release ? versionFromTag(tag) : manifest.version);
  return { release: String(release), tag, sha, version: manifest.version };
}

if (require.main === module) {
  try {
    const revalidateTag = process.env.RELEASE_REVALIDATE_TAG;
    const result = validateRef(revalidateTag ? { event: 'push', ref: `refs/tags/${revalidateTag}` } : {});
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(`Validated ${result.release === 'true' ? result.tag : 'CI'} at ${result.sha}.`);
  } catch (error) { console.error(`Release validation failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { validateRef };
