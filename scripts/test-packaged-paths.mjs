// Guards the packaging of code the main process imports from outside app/.
//
// app/ is electron-builder's application directory, because it carries its own
// package.json. Every glob in the "files" config is therefore resolved relative
// to app/, and anything the main process reaches for with '../' — shared/ today
// — matches none of them. Such a module has to be copied in explicitly via
// extraResources or the packaged app throws MODULE_NOT_FOUND on its first
// require and never opens a window.
//
// Nothing else catches this: `npm run verify` does not package, and running
// from source resolves the same paths against the repository, where they exist.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoRoot, 'app');
const builderConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron-builder.json'), 'utf8'));

const IMPORT_PATTERN = /(?:from\s+|require\()\s*['"](\.\.\/[^'"]+)['"]/g;

function mainProcessSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : mainProcessSources(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

// Top-level directory each escaping import lands in, e.g. '../shared/x' -> 'shared'.
function escapedRoots() {
  const roots = new Map();

  for (const file of mainProcessSources(appDir)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(IMPORT_PATTERN)) {
      const resolved = path.resolve(path.dirname(file), specifier);
      if (resolved.startsWith(appDir + path.sep)) continue;

      const relative = path.relative(repoRoot, resolved);
      assert.ok(
        !relative.startsWith('..'),
        `${path.relative(repoRoot, file)} imports '${specifier}', which is outside the repository.`
      );

      const root = relative.split(path.sep)[0];
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root).push(`${path.relative(repoRoot, file)} -> ${specifier}`);
    }
  }

  return roots;
}

// extraResources entries land in resources/, the same directory resources/app
// sits in — so 'to' is what a '../<name>' require resolves against.
function packagedResourceDirs() {
  return new Set(
    (builderConfig.extraResources ?? [])
      .map(entry => (typeof entry === 'string' ? entry : entry.to ?? entry.from))
      .filter(Boolean)
      .map(target => target.split('/')[0])
  );
}

const roots = escapedRoots();
const packaged = packagedResourceDirs();

console.log(`main process imports from outside app/: ${[...roots.keys()].join(', ') || '(none)'}`);
console.log(`extraResources provides: ${[...packaged].join(', ') || '(none)'}`);

for (const [root, importers] of roots) {
  assert.ok(
    packaged.has(root),
    `The main process imports from '${root}/', which is outside electron-builder's app directory `
    + `and is not copied by extraResources. The packaged app will fail to start.\n`
    + `  Add to electron-builder.json:\n`
    + `    "extraResources": [{ "from": "${root}", "to": "${root}", "filter": ["**/*.js"] }]\n`
    + `  Imports that need it:\n${importers.map(i => `    ${i}`).join('\n')}`
  );

  // A .ts-only filter would package nothing useful: main requires compiled JS.
  const entry = builderConfig.extraResources.find(e => (e.to ?? e.from) === root);
  const filters = [entry.filter ?? []].flat();
  assert.ok(
    filters.length === 0 || filters.some(f => f.endsWith('*.js') || f === '**/*'),
    `extraResources for '${root}' does not include JavaScript (filter: ${JSON.stringify(filters)}).`
  );

  console.log(`  ok  ${root}/ is copied into resources/${root}`);
}

console.log('\npackaged paths: main process imports are all reachable in a packaged build');
