#!/usr/bin/env node
// Bumps the application version across every file that records it.
//
// WHY: the version lives in four places (root and app package.json, plus both
// lockfiles). electron-builder reads app/package.json for the packaged app
// version while the release workflow reads the root one, so a partial bump
// ships installers labelled differently from the release they land on. CI now
// rejects that mismatch — this script makes it hard to create in the first place.
//
// Deliberately does not use `npm version`: the root package.json defines a
// `version` lifecycle script that regenerates CHANGELOG.md, which this project
// has not maintained since April.
//
//   npm run bump 4.1.11
//   npm run bump patch | minor | major

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Both lockfiles record the version twice: once at the top level and once in
// the packages[""] self-entry. Other "version" keys belong to dependencies and
// must not be touched.
const TARGETS = [
  { path: 'package.json', keys: [['version']] },
  { path: 'app/package.json', keys: [['version']] },
  { path: 'package-lock.json', keys: [['version'], ['packages', '', 'version']] },
  { path: 'app/package-lock.json', keys: [['version'], ['packages', '', 'version']] }
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function readJson(relativePath) {
  const absolutePath = join(repoRoot, relativePath);
  return { absolutePath, raw: readFileSync(absolutePath, 'utf8') };
}

function getIn(object, keyPath) {
  return keyPath.reduce((current, key) => (current == null ? current : current[key]), object);
}

function setIn(object, keyPath, value) {
  const parent = keyPath.slice(0, -1).reduce((current, key) => current[key], object);
  parent[keyPath.at(-1)] = value;
}

function resolveNextVersion(current, request) {
  if (SEMVER.test(request)) return request;

  const [, major, minor, patch] = current.match(SEMVER).map(Number);
  switch (request) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Expected a semver version or major|minor|patch, got "${request}"`);
  }
}

function main() {
  const request = process.argv[2];
  if (!request) {
    console.error('Usage: npm run bump <version|major|minor|patch>');
    process.exit(1);
  }

  const { raw: rootRaw } = readJson('package.json');
  const currentVersion = JSON.parse(rootRaw).version;
  if (!SEMVER.test(currentVersion)) {
    throw new Error(`Current root version "${currentVersion}" is not plain semver; bump by hand.`);
  }

  const nextVersion = resolveNextVersion(currentVersion, request);
  if (nextVersion === currentVersion) {
    throw new Error(`Version is already ${nextVersion}; nothing to do.`);
  }

  // Verify every file agrees before writing any of them, so a pre-existing
  // drift is reported rather than silently flattened.
  const planned = TARGETS.map(({ path, keys }) => {
    const { absolutePath, raw } = readJson(path);
    const parsed = JSON.parse(raw);
    for (const keyPath of keys) {
      const found = getIn(parsed, keyPath);
      if (found !== currentVersion) {
        throw new Error(
          `${path} has ${keyPath.join('.')} = "${found}", expected "${currentVersion}". ` +
          'Reconcile the versions by hand before bumping.'
        );
      }
    }
    // Preserve the file's existing trailing newline convention.
    return { path, absolutePath, parsed, keys, endsWithNewline: raw.endsWith('\n') };
  });

  for (const { path, absolutePath, parsed, keys, endsWithNewline } of planned) {
    for (const keyPath of keys) setIn(parsed, keyPath, nextVersion);
    writeFileSync(absolutePath, JSON.stringify(parsed, null, 2) + (endsWithNewline ? '\n' : ''));
    console.log(`  updated ${path}`);
  }

  console.log(`\n${currentVersion} -> ${nextVersion}\n`);
  console.log('Next:');
  console.log(`  git commit -am "Release ${nextVersion}"`);
  console.log('  git push origin master');
  console.log(`  git tag v${nextVersion} && git push origin v${nextVersion}`);
}

try {
  main();
} catch (error) {
  console.error(`\nBump failed: ${error.message}`);
  process.exit(1);
}
