const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeSqlite = require('node:sqlite');
const { DatabaseSync } = nodeSqlite;

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
    assert(orderColumns.some(column => column.name === 'ingestion_id'));
    const orderIndexes = all(database, 'PRAGMA index_list(orders)');
    assert(orderIndexes.some(index => index.name === 'idx_orders_ingestion_id' && index.unique === 1));
    assert(rawDataColumns.some(column => column.name === 'instrument_id'));
    assert(rawDataColumns.some(column => column.name === 'mysql_inserted'));
    assert(appLogColumns.some(column => column.name === 'log_type'));
    assert(appLogColumns.some(column => column.name === 'mysql_inserted'));
    assert(appLogColumns.some(column => column.name === 'category'));
    const appLogIndexes = all(database, 'PRAGMA index_list(app_log)');
    assert(appLogIndexes.some(index => index.name === 'idx_app_log_added_on'));
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
    database.exec("INSERT INTO app_log (log) VALUES ('legacy log')");

    applyMigrations(database, migrations.slice(1));

    const orders = all(database, "SELECT order_id, mysql_inserted, notes, ingestion_id FROM orders WHERE order_id = 'LEGACY-001'");
    const rawData = all(database, "SELECT machine, instrument_id, mysql_inserted FROM raw_data WHERE machine = 'ANALYZER-OLD'");
    const appLogs = all(database, "SELECT log, category FROM app_log WHERE log = 'legacy log'");
    assert.equal(orders.length, 1);
    assert.equal(orders[0].order_id, 'LEGACY-001');
    assert.equal(orders[0].mysql_inserted, 1);
    assert.equal(orders[0].notes, null);
    assert.match(orders[0].ingestion_id, /^[a-f0-9]{32}$/);
    assert.deepEqual(rawData, [{ machine: 'ANALYZER-OLD', instrument_id: 'ANALYZER-OLD', mysql_inserted: 0 }]);
    assert.deepEqual(appLogs, [{ log: 'legacy log', category: 'operational' }]);
  } finally {
    database.close();
  }
}

async function createOnlineTestBackup(database, destination) {
  if (typeof nodeSqlite.backup === 'function') {
    await nodeSqlite.backup(database, destination);
    return;
  }

  // Node 22.12-22.15 pre-dates node:sqlite.backup. VACUUM INTO exercises the
  // same recovery contract for developers using the oldest supported runtime.
  const escapedDestination = destination.replace(/'/g, "''");
  database.exec(`VACUUM INTO '${escapedDestination}'`);
}

async function testOnlineBackupIncludesWalTransactions(temporaryDirectory) {
  const livePath = path.join(temporaryDirectory, 'wal-live.db');
  const backupPath = path.join(temporaryDirectory, 'wal-online-backup.db');
  const liveDatabase = new DatabaseSync(livePath);
  try {
    liveDatabase.exec('PRAGMA journal_mode = WAL');
    liveDatabase.exec('CREATE TABLE recovery_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    liveDatabase.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    liveDatabase.exec("INSERT INTO recovery_probe (value) VALUES ('committed-in-wal')");

    assert(fs.statSync(`${livePath}-wal`).size > 0, 'Expected a non-empty WAL sidecar');
    await createOnlineTestBackup(liveDatabase, backupPath);

    const copiedDatabase = new DatabaseSync(backupPath);
    try {
      const copiedRows = all(copiedDatabase, 'SELECT value FROM recovery_probe');
      assert.deepEqual(copiedRows, [{ value: 'committed-in-wal' }]);
      assert.deepEqual(all(copiedDatabase, 'PRAGMA quick_check'), [{ quick_check: 'ok' }]);
    } finally {
      copiedDatabase.close();
    }
  } finally {
    liveDatabase.close();
  }
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vlsm-migrations-'));
  try {
    const migrations = readMigrations();
    assert(migrations.length > 0, 'Expected at least one SQLite migration');
    testFreshInstallation(migrations, temporaryDirectory);
    testLegacyUpgrade(migrations, temporaryDirectory);
    await testOnlineBackupIncludesWalTransactions(temporaryDirectory);
    console.log(`SQLite migration tests passed (${migrations.length} migrations).`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
