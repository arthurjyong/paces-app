// Local dev/test Postgres for the managed tier: REAL PostgreSQL binaries via
// the embedded-postgres devDependency — no system install, no Docker. Run
// `node scripts/dev-db.mjs` (keeps running until Ctrl-C), then point the app
// at it: DATABASE_URL=postgresql://postgres:paces@127.0.0.1:54321/paces
// (put it in .env.local) and apply the schema with `node scripts/migrate.mjs`.
// Data persists in .dev-pg/ (gitignored).
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const dir = process.env.PG_DIR || './.dev-pg';
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'paces',
  port: 54321,
  persistent: true,
});

// initialise() runs initdb, which fails on an already-initialised dir — only
// call it on a fresh dir so re-runs (after a crash/kill) just start the cluster.
if (!existsSync(`${dir}/PG_VERSION`)) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('paces');
} catch {
  // already exists on a re-run — fine
}
console.log('embedded postgres READY on 127.0.0.1:54321 (db: paces)');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// keep alive
setInterval(() => {}, 60_000);
