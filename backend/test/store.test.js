import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, db, openDatabase, recordAudit, save } from '../src/lib/store.js';
import { createUser } from '../src/lib/users.js';

// This file runs in its own process, so opening a real database here doesn't affect other tests.
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cab-store-'));

function reset() {
  closeDatabase();
  db.users = [];
  db.rides = [];
  db.auditLog = [];
}

test('users, rides and audit entries survive a restart', async (context) => {
  const dir = tempDir();
  context.after(() => {
    reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  openDatabase(dir);
  const user = await createUser({ role: 'customer', name: 'Persist Me', phone: '9876500001', password: 'secret123' });
  const ride = { id: 'ride-1', customerId: user.id, driverId: null, status: 'requested', requestedAt: new Date().toISOString(), fare: 120 };
  save(ride);
  db.rides.push(ride);
  ride.status = 'cancelled';
  save(ride);
  recordAudit({ id: 'admin-1', name: 'Admin' }, 'user.block', { userId: user.id });

  reset();
  openDatabase(dir);
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].name, 'Persist Me');
  assert.match(db.users[0].passwordHash, /^scrypt\$/);
  assert.equal(db.rides[0].status, 'cancelled', 'updates overwrite the stored row');
  assert.equal(db.auditLog[0].action, 'user.block');
});

test('the database itself rejects duplicate accounts', async (context) => {
  const dir = tempDir();
  context.after(() => {
    reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  openDatabase(dir);
  await createUser({ role: 'driver', name: 'First', phone: '9876500002', password: 'secret123', vehicleType: 'mini', vehicleModel: 'Swift', vehicleNumber: 'OD 01 AA 0001' });
  // Simulate a race that slipped past the in-memory check.
  db.users = [];
  await assert.rejects(
    createUser({ role: 'driver', name: 'Second', phone: '9876500002', password: 'secret123', vehicleType: 'mini', vehicleModel: 'Swift', vehicleNumber: 'OD 01 AA 0002' }),
    (error) => error.code === 'PHONE_TAKEN',
  );
  assert.equal(db.users.length, 0, 'a rejected write never appears in memory');
});

test('an old db.json is imported once and kept as a backup', (context) => {
  const dir = tempDir();
  context.after(() => {
    reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const legacy = {
    users: [{ id: 'u1', role: 'customer', name: 'Legacy', phone: '9876500003', passwordHash: 'aa:bb', createdAt: '2026-01-01T00:00:00.000Z' }],
    rides: [{ id: 'r1', customerId: 'u1', driverId: null, status: 'completed', requestedAt: '2026-01-02T00:00:00.000Z', fare: 99 }],
    auditLog: [],
  };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(legacy));

  openDatabase(dir);
  assert.equal(db.users[0].name, 'Legacy');
  assert.equal(db.rides[0].fare, 99);
  assert.equal(fs.existsSync(path.join(dir, 'db.json')), false);
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('db.json.migrated-')));

  const sqlite = new Database(path.join(dir, 'cab.sqlite'), { readonly: true });
  assert.equal(sqlite.pragma('journal_mode', { simple: true }), 'wal');
  sqlite.close();
});
