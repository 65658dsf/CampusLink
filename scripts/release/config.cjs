'use strict';

// NingMeng123 — shared, side-effect-free release validation.
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !STABLE_VERSION.test(tag.slice(1))) {
    throw new Error('Release tag must be an existing stable version such as v1.1.0.');
  }
  return tag.slice(1);
}

function assertVersions(packageJson, lock, version) {
  if (!STABLE_VERSION.test(version) || packageJson.version !== version || lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('Tag, package.json and both package-lock.json root versions must match.');
  }
}

function artifactNames(version, platform, arch) {
  if (!STABLE_VERSION.test(version)) throw new Error('Unsupported release version.');
  if (platform === 'win' && arch === 'x64') return [`Campus-Link-Glass-Setup-${version}.exe`];
  if (platform === 'mac' && ['x64', 'arm64'].includes(arch)) return ['dmg', 'zip'].map(ext => `Campus-Link-${version}-mac-${arch}.${ext}`);
  throw new Error('Supported targets are win/x64, mac/x64 and mac/arm64.');
}

function macSigning(env) {
  const certificate = Boolean(env.CSC_LINK);
  const apple = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].map(key => Boolean(env[key]));
  if (apple.some(Boolean) && (!certificate || !apple.every(Boolean))) {
    throw new Error('Notarization requires a signing certificate and all three Apple notarization secrets.');
  }
  if (!certificate && env.CSC_KEY_PASSWORD) throw new Error('A certificate password was provided without CSC_LINK.');
  return { signing: certificate ? 'developer-id' : 'unsigned', notarized: certificate && apple.every(Boolean) };
}

module.exports = { STABLE_VERSION, versionFromTag, assertVersions, artifactNames, macSigning };
