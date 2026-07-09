// Apply db/schema.sql to DATABASE_URL. Idempotent (the schema is all
// IF NOT EXISTS / ON CONFLICT DO NOTHING) — run after provisioning the Neon
// resource, and again after any schema edit:
//   DATABASE_URL=... node scripts/migrate.mjs
// Reads .env.local (KEY=VALUE lines) as a fallback so local dev needs no
// explicit env. Plain node + pg, no other deps.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function envFromDotLocal(key) {
  try {
    const text = readFileSync(path.join(root, '.env.local'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env.local — fine
  }
  return undefined;
}

const databaseUrl = process.env.DATABASE_URL || envFromDotLocal('DATABASE_URL');
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (env or .env.local) — nothing to migrate against.');
  process.exit(1);
}

const schema = readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query(schema);
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  const domains = await client.query('SELECT count(*)::int AS n FROM allowed_domains');
  console.log(
    `migrate OK — tables: ${tables.rows.map((r) => r.table_name).join(', ')} · allowed_domains rows: ${domains.rows[0].n}`
  );
} finally {
  await client.end();
}
