import http from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import { initRealtime } from './lib/realtime.js';
import { runRideMaintenance } from './lib/rides.js';
import { closeDatabase, openDatabase } from './lib/store.js';
import { seedAdminFromEnv, seedDemoAccounts } from './lib/users.js';

openDatabase(env.dataDir);

if (env.seedDemoAccounts) {
  await seedDemoAccounts();
  console.warn('Demo accounts with known passwords are enabled (SEED_DEMO_ACCOUNTS=true). Never use this on a public server.');
}
await seedAdminFromEnv();

const server = http.createServer(app);
const io = initRealtime(server);

// Releases scheduled rides and expires stale requests even when nobody is polling.
const maintenanceTimer = setInterval(() => runRideMaintenance(), 30 * 1000);

server.listen(env.port, () => {
  console.log(`Cab System API listening on http://localhost:${env.port}`);
});

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Shutting down server.`);
  clearInterval(maintenanceTimer);
  // Closing Socket.IO disconnects clients and closes the HTTP server with it; the database is
  // closed last so in-flight requests can finish writing.
  io.close(() => {
    closeDatabase();
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => {
    closeDatabase();
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
