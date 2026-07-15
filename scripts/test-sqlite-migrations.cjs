const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('@vscode/sqlite3');

const migrationsDirectory = path.join(__dirname, '..', 'app', 'sqlite-migrations');

function openDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, error => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function exec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

function readMigrations() {
  return fs.readdirSync(migrationsDirectory)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => ({
      file,
      sql: fs.readFileSync(path.join(migrationsDirectory, file), 'utf8')
    }));
}

async function applyMigrations(database, migrations) {
  for (const migration of migrations) {
    await exec(database, migration.sql);
  }
}

async function testFreshInstallation(migrations, temporaryDirectory) {
  const database = await openDatabase(path.join(temporaryDirectory, 'fresh.db'));
  try {
    await applyMigrations(database, migrations);
    const tables = await all(database, "SELECT name FROM sqlite_master WHERE type = 'table'");
    const tableNames = tables.map(row => row.name);
    assert(tableNames.includes('orders'));
    assert(tableNames.includes('raw_data'));
    assert(tableNames.includes('app_log'));

    const orderColumns = await all(database, 'PRAGMA table_info(orders)');
    const rawDataColumns = await all(database, 'PRAGMA table_info(raw_data)');
    const appLogColumns = await all(database, 'PRAGMA table_info(app_log)');
    assert(orderColumns.some(column => column.name === 'instrument_id'));
    assert(orderColumns.some(column => column.name === 'mysql_inserted'));
    assert(orderColumns.some(column => column.name === 'notes'));
    assert(rawDataColumns.some(column => column.name === 'instrument_id'));
    assert(rawDataColumns.some(column => column.name === 'mysql_inserted'));
    assert(appLogColumns.some(column => column.name === 'log_type'));
    assert(appLogColumns.some(column => column.name === 'mysql_inserted'));
  } finally {
    await close(database);
  }
}

async function testLegacyUpgrade(migrations, temporaryDirectory) {
  const database = await openDatabase(path.join(temporaryDirectory, 'upgrade.db'));
  try {
    await exec(database, migrations[0].sql);
    await exec(database, "INSERT INTO orders (order_id, test_type) VALUES ('LEGACY-001', 'HIVVL')");
    await exec(database, "INSERT INTO raw_data (data, machine) VALUES ('legacy payload', 'ANALYZER-OLD')");

    await applyMigrations(database, migrations.slice(1));

    const orders = await all(database, "SELECT order_id, mysql_inserted, notes FROM orders WHERE order_id = 'LEGACY-001'");
    const rawData = await all(database, "SELECT machine, instrument_id, mysql_inserted FROM raw_data WHERE machine = 'ANALYZER-OLD'");
    assert.deepEqual(orders, [{ order_id: 'LEGACY-001', mysql_inserted: 1, notes: null }]);
    assert.deepEqual(rawData, [{ machine: 'ANALYZER-OLD', instrument_id: 'ANALYZER-OLD', mysql_inserted: 0 }]);
  } finally {
    await close(database);
  }
}

async function testWalSnapshotCharacterization(temporaryDirectory) {
  const livePath = path.join(temporaryDirectory, 'wal-live.db');
  const copiedPath = path.join(temporaryDirectory, 'wal-main-file-copy.db');
  const liveDatabase = await openDatabase(livePath);
  try {
    await exec(liveDatabase, 'PRAGMA journal_mode = WAL');
    await exec(liveDatabase, 'CREATE TABLE recovery_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await all(liveDatabase, 'PRAGMA wal_checkpoint(TRUNCATE)');
    await exec(liveDatabase, "INSERT INTO recovery_probe (value) VALUES ('committed-in-wal')");

    assert(fs.statSync(`${livePath}-wal`).size > 0, 'Expected a non-empty WAL sidecar');
    fs.copyFileSync(livePath, copiedPath);

    const copiedDatabase = await openDatabase(copiedPath);
    try {
      const copiedRows = await all(copiedDatabase, 'SELECT value FROM recovery_probe');
      // WHY: this captures the current startup backup limitation. Copying only
      // the main file is not a recovery-safe snapshot after an unclean exit.
      assert.deepEqual(copiedRows, []);
    } finally {
      await close(copiedDatabase);
    }
  } finally {
    await close(liveDatabase);
  }
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vlsm-migrations-'));
  try {
    const migrations = readMigrations();
    assert(migrations.length > 0, 'Expected at least one SQLite migration');
    await testFreshInstallation(migrations, temporaryDirectory);
    await testLegacyUpgrade(migrations, temporaryDirectory);
    await testWalSnapshotCharacterization(temporaryDirectory);
    console.log(`SQLite migration tests passed (${migrations.length} migrations).`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
