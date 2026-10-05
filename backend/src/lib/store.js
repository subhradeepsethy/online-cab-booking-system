import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// SQLite (in DATA_DIR/cab.sqlite) is the source of truth. The server keeps a working copy of
// users and rides in memory for fast reads, and every change writes just the affected records
// in a transaction. Tests don't open a database, so they run fully in memory.
//
// This design assumes a single API process (Socket.IO rooms are also per-process). To run
// several instances, move reads to SQL queries and add a Socket.IO adapter first.
export const db = {
  users: [],
  rides: [],
  auditLog: [],
};

const maxAuditEntriesInMemory = 5000;
const schemaVersion = 1;

let sqlite = null;
let statements = null;
let dataDirectory = null;

const schema = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('customer', 'driver', 'admin')),
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_role_phone ON users (role, phone);
  CREATE TABLE IF NOT EXISTS rides (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    driver_id TEXT,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data))
  );
  CREATE INDEX IF NOT EXISTS rides_customer ON rides (customer_id);
  CREATE INDEX IF NOT EXISTS rides_driver ON rides (driver_id);
  CREATE INDEX IF NOT EXISTS rides_status ON rides (status);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data))
  );
`;

function prepareStatements() {
  return {
    upsertUser: sqlite.prepare(`
      INSERT INTO users (id, role, phone, created_at, data) VALUES (@id, @role, @phone, @createdAt, @data)
      ON CONFLICT (id) DO UPDATE SET role = excluded.role, phone = excluded.phone, data = excluded.data
    `),
    upsertRide: sqlite.prepare(`
      INSERT INTO rides (id, customer_id, driver_id, status, requested_at, data)
      VALUES (@id, @customerId, @driverId, @status, @requestedAt, @data)
      ON CONFLICT (id) DO UPDATE SET driver_id = excluded.driver_id, status = excluded.status,
        requested_at = excluded.requested_at, data = excluded.data
    `),
    insertAudit: sqlite.prepare('INSERT INTO audit_log (at, admin_id, action, data) VALUES (@at, @adminId, @action, @data)'),
  };
}

function writeUser(user) {
  statements.upsertUser.run({ id: user.id, role: user.role, phone: user.phone, createdAt: user.createdAt, data: JSON.stringify(user) });
}

function writeRide(ride) {
  statements.upsertRide.run({
    id: ride.id,
    customerId: ride.customerId,
    driverId: ride.driverId ?? null,
    status: ride.status,
    requestedAt: ride.requestedAt,
    data: JSON.stringify(ride),
  });
}

// One-time import of the JSON file used by earlier versions. The file is kept (renamed) as a backup.
function migrateLegacyJson(legacyPath) {
  if (!fs.existsSync(legacyPath)) return;
  const hasData = sqlite.prepare('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM rides) AS count').get().count > 0;
  if (hasData) return;

  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  sqlite.transaction(() => {
    (legacy.users ?? []).forEach(writeUser);
    (legacy.rides ?? []).forEach(writeRide);
    (legacy.auditLog ?? []).forEach(({ at, adminId, action, ...rest }) => {
      statements.insertAudit.run({ at, adminId, action, data: JSON.stringify({ adminId, action, ...rest }) });
    });
  })();
  fs.renameSync(legacyPath, `${legacyPath}.migrated-${Date.now()}`);
  console.log(`Imported ${legacy.users?.length ?? 0} users and ${legacy.rides?.length ?? 0} rides from ${legacyPath} into SQLite.`);
}

export function openDatabase(directory) {
  dataDirectory = path.resolve(directory);
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

  sqlite = new Database(path.join(dataDirectory, 'cab.sqlite'));
  // WAL keeps reads fast during writes; FULL sync means a committed change survives a crash
  // or power cut. busy_timeout avoids spurious "database is locked" errors during backups.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(schema);
  sqlite.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING').run('schema_version', String(schemaVersion));
  statements = prepareStatements();

  migrateLegacyJson(path.join(dataDirectory, 'db.json'));

  db.users = sqlite.prepare('SELECT data FROM users ORDER BY created_at').all().map((row) => JSON.parse(row.data));
  db.rides = sqlite.prepare('SELECT data FROM rides ORDER BY requested_at').all().map((row) => JSON.parse(row.data));
  db.auditLog = sqlite.prepare('SELECT data, at FROM audit_log ORDER BY id DESC LIMIT ?').all(maxAuditEntriesInMemory)
    .reverse()
    .map((row) => ({ at: row.at, ...JSON.parse(row.data) }));
}

export function closeDatabase() {
  sqlite?.close();
  sqlite = null;
}

// Folder for uploaded files next to the database, or null when running in memory (tests).
export function uploadsDir() {
  return dataDirectory ? path.join(dataDirectory, 'uploads') : null;
}

// Persists the given users and/or rides (whatever was just changed) in one transaction.
export function save(...entities) {
  if (!sqlite) return;
  sqlite.transaction(() => {
    for (const entity of entities) {
      if (!entity) continue;
      if (typeof entity.role === 'string') writeUser(entity);
      else if (typeof entity.customerId === 'string') writeRide(entity);
      else throw new Error('save() only accepts user or ride objects.');
    }
  })();
}

// Admin actions are recorded so there's a trail of who changed what. The database keeps every
// entry; memory keeps the most recent ones for the admin API.
export function recordAudit(admin, action, details) {
  const entry = { at: new Date().toISOString(), adminId: admin.id, adminName: admin.name, action, ...details };
  db.auditLog.push(entry);
  if (db.auditLog.length > maxAuditEntriesInMemory) db.auditLog.splice(0, db.auditLog.length - maxAuditEntriesInMemory);
  if (sqlite) {
    const { at, ...rest } = entry;
    statements.insertAudit.run({ at, adminId: admin.id, action, data: JSON.stringify(rest) });
  }
}

// Consistent online backup (safe while the server is running).
export async function backupDatabase(destination) {
  if (!sqlite) throw new Error('No database is open.');
  await sqlite.backup(destination);
}
