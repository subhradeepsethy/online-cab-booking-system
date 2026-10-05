// Makes a consistent copy of the SQLite database (safe while the server is running) into
// DATA_DIR/backups, and keeps the 14 most recent copies. Uploaded documents live in
// DATA_DIR/uploads and should be copied by your host's disk/volume backups as well.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../src/config/env.js';

const keep = 14;
const source = path.resolve(env.dataDir, 'cab.sqlite');
const backupDir = path.resolve(env.dataDir, 'backups');

if (!fs.existsSync(source)) {
  console.error(`No database found at ${source}.`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDir, `cab-${stamp}.sqlite`);

const database = new Database(source, { readonly: true, fileMustExist: true });
await database.backup(destination);
database.close();
fs.chmodSync(destination, 0o600);
console.log(`Backup written to ${destination}`);

const old = fs.readdirSync(backupDir).filter((name) => /^cab-.*\.sqlite$/.test(name)).sort().slice(0, -keep);
old.forEach((name) => fs.rmSync(path.join(backupDir, name)));
if (old.length > 0) console.log(`Removed ${old.length} old backup(s).`);
