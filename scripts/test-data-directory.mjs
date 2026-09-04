// Guards the one line that keeps a laboratory's data findable after a rename.
//
// WHY: Electron derives userData from app.getName(), so the folder holding the
// settings store, interface.db, the backups and the record of applied
// migrations is named after the product. app/main.ts pins that folder instead,
// to the name installations have used since they were installed. Two things
// can quietly undo it, and neither looks dangerous while you are doing it:
// renaming the constant along with the product, or moving the pin below the
// code that opens the store, which resolves the path when it is constructed.
//
// Either one ships an application that comes up with nothing configured and no
// error to explain where a lab's history went.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The directory every installation already uses. Renaming the product does not
// rename this; only a migration that moves the data could, and none exists.
const EXPECTED_DIRECTORY = 'vlsm-interfacing';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(repoRoot, 'app', 'main.ts'), 'utf8');

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

// Development is deliberately left on Electron's default so `npm start` cannot
// write into an installation's data on the same machine.
assert.match(
  main.slice(pin - 200, pin),
  /if \(!serve\) \{/,
  'the pin should apply to installations only, leaving a served run on the default path'
);
console.log('  ok  a served run keeps its own directory');

console.log('data directory: the path a laboratory\'s data lives at does not depend on the product name.');
