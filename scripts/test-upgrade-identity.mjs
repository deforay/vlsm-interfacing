// Guards the identifiers that let an installation already in a laboratory keep
// its data and be upgraded in place, rather than replaced beside itself.
//
// WHY: the product was renamed from vlsm-interfacing to InteLIS-interfacing,
// and three things that look like part of a name are not:
//
//   the data directory  Electron derives userData from app.getName(), so the
//                       folder holding the settings store, interface.db, the
//                       backups and the record of applied migrations is named
//                       after the product. app/main.ts names it instead.
//   the NSIS GUID       Windows finds the installed copy to upgrade through a
//                       UUIDv5 of appId. The appId changed, so the GUID is
//                       pinned to what it was; without it every Windows
//                       laboratory gets a second copy alongside the first.
//   the deb metadata    dpkg names the package after the product, so the new
//                       package has to declare that it replaces the old one.
//
// Each of these is invisible until an upgrade reaches a laboratory that has
// been running the tool for a year, and by then it is their problem, not ours.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The directory every installation already uses. Renaming the product does not
// rename this; only a migration that moves the data could, and none exists.
const EXPECTED_DIRECTORY = 'vlsm-interfacing';

// What Windows has recorded for every installation out there: UUIDv5 of the
// original appId, com.deforay.vlsm-interfacing, in electron-builder's
// namespace. Recomputed from a new appId it would be a different number and a
// different application.
const EXPECTED_NSIS_GUID = '94f6f827-8263-5f05-a641-73580cb0a2f1';

// The dpkg package name the tool shipped under before the rename.
const REPLACED_DEB_PACKAGE = 'vlsm-interfacing';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(repoRoot, 'app', 'main.ts'), 'utf8');
const builder = JSON.parse(readFileSync(join(repoRoot, 'electron-builder.json'), 'utf8'));

const declaration = main.match(/const DATA_DIRECTORY_NAME = '([^']+)'/);
assert.ok(declaration, 'app/main.ts no longer declares DATA_DIRECTORY_NAME');
assert.equal(
  declaration[1],
  EXPECTED_DIRECTORY,
  `The data directory is named '${declaration[1]}', but every existing installation keeps its `
  + `settings, database and backups in '${EXPECTED_DIRECTORY}'. Renaming it strands them.`
);
console.log(`  ok  the data directory is still '${EXPECTED_DIRECTORY}'`);

const pin = main.indexOf('app.setPath(\'userData\'');
assert.notEqual(pin, -1, 'app/main.ts no longer pins userData, so the data folder follows the product name');
console.log('  ok  userData is pinned rather than derived from the product name');

// Anything that resolves a path at construction has to come after the pin.
for (const consumer of ['new Store(', 'setupSqlite(', 'app.getPath(\'userData\')']) {
  const at = main.indexOf(consumer);
  if (at === -1) continue;
  assert.ok(
    at > pin,
    `${consumer} appears before userData is pinned, so it resolves the old path`
  );
  console.log(`  ok  ${consumer} runs after the pin`);
}

// A served run and a run handed its own profile are deliberately left alone, so
// neither `npm start` nor the end-to-end tests can write into an installation's
// data on the same machine.
const guard = main.slice(pin - 400, pin);
assert.match(
  guard,
  /if \(!serve && !profileChosenByCaller\) \{/,
  'the pin should apply to installations only, leaving a served run and an explicit profile alone'
);
assert.match(
  guard,
  /mkdirSync\(dataDirectory, \{ recursive: true \}\)/,
  'the data directory should be created before it is pinned'
);
console.log('  ok  a served run and an explicit profile keep their own directory');

assert.equal(
  builder.nsis?.guid,
  EXPECTED_NSIS_GUID,
  'nsis.guid must stay pinned to the GUID Windows recorded under the original appId, '
  + 'or an upgrade installs a second copy beside the one the laboratory is using.'
);
console.log('  ok  Windows upgrades in place');

const fpmArguments = builder.deb?.fpm ?? [];
for (const declaration of ['--replaces', '--conflicts', '--provides']) {
  const at = fpmArguments.indexOf(declaration);
  assert.ok(at !== -1, `the deb package no longer declares ${declaration}`);
  assert.equal(
    fpmArguments[at + 1],
    REPLACED_DEB_PACKAGE,
    `${declaration} should name ${REPLACED_DEB_PACKAGE}, the package installed laboratories already have`
  );
}
console.log('  ok  the deb package takes over from the one it replaces');

console.log('upgrade identity: an installed laboratory keeps its data and is upgraded, not duplicated.');
