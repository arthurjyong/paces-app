// Server-only Postgres access (the Phase-1 managed-tier state: users, OTP
// codes, the usage ledger and balances). ONE driver everywhere — plain `pg`
// against DATABASE_URL — which works identically for local dev Postgres and
// Neon's pooled connection string (every route here is runtime='nodejs';
// Neon's pooler is pgbouncer in transaction mode, so single statements AND
// explicit BEGIN/COMMIT transactions are both fine, but session-level state
// like prepared statements or SET must not be relied on across queries).
//
// Nothing in this module may be imported by client components.

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

/** True when the managed tier's database is configured at all. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Lazy singleton Pool. Small max: serverless instances each hold their own
 * pool, and Neon's pooler multiplexes beyond that. The connection string is
 * passed through untouched — Neon URLs carry sslmode=require, which pg's
 * connection-string parser honours; local dev URLs (localhost) stay plain.
 */
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Without a handler, an idle-client error (e.g. Neon closing a connection)
    // crashes the process. The pool discards the broken client either way.
    pool.on('error', () => {});
  }
  return pool;
}

/** Single parameterised query. */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params as unknown[]);
}

/**
 * Run `fn` inside BEGIN/COMMIT on one connection; ROLLBACK on any throw.
 * Keep the body short — the connection is held for its duration.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is broken; release(err) below discards it
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Period keys — calendar month / day in Asia/Singapore (the users are SG
// candidates; documented in db/schema.sql). en-CA gives ISO-style YYYY-MM-DD.
// ---------------------------------------------------------------------------

const SGT_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' in Asia/Singapore — the global_spend day key. */
export function sgtDay(now: Date = new Date()): string {
  return SGT_DATE.format(now);
}

/** 'YYYY-MM' in Asia/Singapore — the user_balances period key. */
export function sgtMonth(now: Date = new Date()): string {
  return sgtDay(now).slice(0, 7);
}
