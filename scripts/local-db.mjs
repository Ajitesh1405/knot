// Local Postgres for Knot — no Docker, no system install required.
//
// Runs a self-contained Postgres cluster from ./.localdb using the
// `embedded-postgres` portable binaries. Credentials + port match the default
// DATABASE_URL in .env (postgresql://knot:knot@localhost:5432/knot).
//
//   npm run db:local        # starts the server and keeps it running
//
// Leave this running in its own terminal; run migrations / the app elsewhere.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '..', '.localdb');
const DB_NAME = 'knot';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'knot',
  password: 'knot',
  port: 5432,
  authMethod: 'password',
  persistent: true,
  onLog: (m) => process.stdout.write(`[pg] ${m}\n`),
  onError: (m) => process.stderr.write(`[pg:err] ${m}\n`),
});

const freshCluster = !existsSync(dataDir);

if (freshCluster) {
  console.log(`Initialising new Postgres cluster at ${dataDir} ...`);
  await pg.initialise();
}

await pg.start();
console.log('Local Postgres started on localhost:5432 (user=knot db=knot).');

// Ensure the application database exists (initdb only creates the superuser DB).
try {
  await pg.createDatabase(DB_NAME);
  console.log(`Created database "${DB_NAME}".`);
} catch (err) {
  const msg = String(err?.message ?? err);
  if (/already exists/i.test(msg)) {
    console.log(`Database "${DB_NAME}" already exists — reusing it.`);
  } else {
    console.error('Failed to create database:', msg);
  }
}

console.log('\nReady. DATABASE_URL=postgresql://knot:knot@localhost:5432/knot?schema=public');
console.log('Keep this process running. Press Ctrl+C to stop the database.\n');

async function shutdown(signal) {
  console.log(`\nReceived ${signal}, stopping Postgres ...`);
  try {
    await pg.stop();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the event loop alive so the cluster stays up.
setInterval(() => {}, 1 << 30);
