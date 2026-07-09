// Local dev/test Postgres for the managed tier: REAL PostgreSQL binaries via
// the embedded-postgres devDependency — no system install, no Docker. Run
// `node scripts/dev-db.mjs` (keeps running until Ctrl-C), then point the app
// at it: DATABASE_URL=postgresql://postgres:paces@127.0.0.1:54321/paces
// (put it in .env.local) and apply the schema with `node scripts/migrate.mjs`.
// Data persists in .dev-pg/ (gitignored).
import EmbeddedPostgres from 'embedded-postgres';

const pg = new EmbeddedPostgres({
  databaseDir: process.env.PG_DIR || './.dev-pg',
  user: 'postgres',
  password: 'paces',
  port: 54321,
  persistent: true,
});

await pg.initialise();
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
