const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const migrationsDirectory = path.join(__dirname, '..', 'app', 'sqlite-migrations');

function readMigrations() {
  return fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({
      file,
      sql: fs.readFileSync(path.join(migrationsDirectory, file), 'utf8')
    }));
}

function applyMigrations(database, migrations) {
  for (const migration of migrations) {
    database.exec(migration.sql);
  }
}

function all(database, sql, params = []) {
  // Node's built-in driver returns null-prototype rows. Normalize them so
  // assertions describe database values rather than driver object internals.
  return database.prepare(sql).all(...params).map(row => ({ ...row }));
}

function testFreshInstallation(migrations, temporaryDirectory) {
  const database = new DatabaseSync(path.join(temporaryDirectory, 'fresh.db'));
  try {
    applyMigrations(database, migrations);
    const tables = all(database, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const tableNames = tables.map(row => row.name);
    assert(tableNames.includes('orders'));
    assert(tableNames.includes('raw_data'));
    assert(tableNames.includes('app_log'));

    const orderColumns = all(database, 'PRAGMA table_info(orders)');
    const rawDataColumns = all(database, 'PRAGMA table_info(raw_data)');
    const appLogColumns = all(database, 'PRAGMA table_info(app_log)');
    assert(orderColumns.some(column => column.name === 'instrument_id'));
    assert(orderColumns.some(column => column.name === 'mysql_inserted'));
    assert(orderColumns.some(column => column.name === 'notes'));
    assert(rawDataColumns.some(column => column.name === 'instrument_id'));
    assert(rawDataColumns.some(column => column.name === 'mysql_inserted'));
    assert(appLogColumns.some(column => column.name === 'log_type'));
    assert(appLogColumns.some(column => column.name === 'mysql_inserted'));
  } finally {
    database.close();
  }
}

function testLegacyUpgrade(migrations, temporaryDirectory) {
  const database = new DatabaseSync(path.join(temporaryDirectory, 'upgrade.db'));
  try {
    database.exec(migrations[0].sql);
    database.exec("INSERT INTO orders (order_id, test_type) VALUES ('LEGACY-001', 'HIVVL')");
    database.exec("INSERT INTO raw_data (data, machine) VALUES ('legacy payload', 'ANALYZER-OLD')");

    applyMigrations(database, migrations.slice(1));

    const orders = all(database, "SELECT order_id, mysql_inserted, notes FROM orders WHERE order_id = 'LEGACY-001'");
    const rawData = all(database, "SELECT machine, instrument_id, mysql_inserted FROM raw_data WHERE machine = 'ANALYZER-OLD'");
    assert.deepEqual(orders, [{ order_id: 'LEGACY-001', mysql_inserted: 1, notes: null }]);
    assert.deepEqual(rawData, [{ machine: 'ANALYZER-OLD', instrument_id: 'ANALYZER-OLD', mysql_inserted: 0 }]);
  } finally {
    database.close();
  }
}

function testWalSnapshotCharacterization(temporaryDirectory) {
  const livePath = path.join(temporaryDirectory, 'wal-live.db');
  const copiedPath = path.join(temporaryDirectory, 'wal-main-file-copy.db');
  const liveDatabase = new DatabaseSync(livePath);
  try {
    liveDatabase.exec('PRAGMA journal_mode = WAL');
    liveDatabase.exec('CREATE TABLE recovery_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    liveDatabase.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    liveDatabase.exec("INSERT INTO recovery_probe (value) VALUES ('committed-in-wal')");

    assert(fs.statSync(`${livePath}-wal`).size > 0, 'Expected a non-empty WAL sidecar');
    fs.copyFileSync(livePath, copiedPath);

    const copiedDatabase = new DatabaseSync(copiedPath);
    try {
      const copiedRows = all(copiedDatabase, 'SELECT value FROM recovery_probe');
      // WHY: this captures the current startup backup limitation. Copying only
      // the main file is not a recovery-safe snapshot after an unclean exit.
      assert.deepEqual(copiedRows, []);
    } finally {
      copiedDatabase.close();
    }
  } finally {
    liveDatabase.close();
  }
}

function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vlsm-migrations-'));
  try {
    const migrations = readMigrations();
    assert(migrations.length > 0, 'Expected at least one SQLite migration');
    testFreshInstallation(migrations, temporaryDirectory);
    testLegacyUpgrade(migrations, temporaryDirectory);
    testWalSnapshotCharacterization(temporaryDirectory);
    console.log(`SQLite migration tests passed (${migrations.length} migrations).`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
