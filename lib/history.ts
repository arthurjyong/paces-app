// Server-only study-history sync (Phase 1.1, 2026-07-09). A signed-in user's
// archived encounters are stored so their history follows them across devices.
//
// SCOPE / trust model (see db/schema.sql study_history):
// - Only ever reached behind a valid managed session (the routes gate on it);
//   a user only ever touches their OWN rows (keyed by users.id from the cookie).
// - The stored payload is the SAME data the client already holds — case meta
//   (PublicCaseMeta), the served stem, and the user's own transcript. The
//   hidden answer key / expected findings NEVER reach the client, so they are
//   NOT in this payload: storing it leaks no spoiler content (invariant 1 holds).
// - Records are immutable snapshots keyed by the client id; a delete is a
//   TOMBSTONE (deleted=true) so it propagates and can't be resurrected by a
//   stale device re-pushing the same id.
// - Abuse bounds: each pushed record is size- and shape-checked before storage;
//   history is pruned to MAX_RECORDS newest per user.
//
// Nothing here may be imported by a client component.

import { query, withTransaction } from './db';

/** Newest N history records kept per user (matches the client IndexedDB cap). */
const MAX_RECORDS = 200;
/** Hard ceiling on one serialized record (a full transcript is a few KB; this is abuse defence). */
const MAX_RECORD_BYTES = 512 * 1024;
/** Ceiling on records accepted in one push batch. */
export const MAX_PUSH_BATCH = 100;

/** The shape the client sends / receives — an ArchivedEncounter (components/historyStore.ts). */
export interface HistoryRecord {
  id: string;
  archivedAt: string;
  [k: string]: unknown;
}

export interface HistorySnapshot {
  records: HistoryRecord[];
  deletedIds: string[];
}

/**
 * Validate ONE untrusted record from the client to abuse-defence level (not a
 * full semantic parse — the CLIENT re-sanitizes every pulled record before it
 * renders or reopens, exactly as it does for its own IndexedDB). We only
 * guarantee: a plausible id + archivedAt, a meta object, and a bounded size.
 * Returns the normalized record or null.
 */
export function validateIncomingRecord(x: unknown): HistoryRecord | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 400) return null;
  // archivedAt must parse and not be meaningfully in the future (defence in
  // depth — the DB column used for prune/order is set from server now() anyway).
  const t = Date.parse(typeof r.archivedAt === 'string' ? r.archivedAt : '');
  if (Number.isNaN(t) || t > Date.now() + 5 * 60 * 1000) return null;
  if (!r.meta || typeof r.meta !== 'object') return null;
  if (typeof r.stem !== 'string') return null;
  if (!Array.isArray(r.entries)) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(r);
  } catch {
    return null;
  }
  if (serialized.length > MAX_RECORD_BYTES) return null;
  return r as HistoryRecord;
}

/** The user's server-side history: non-deleted records (newest first) + tombstoned ids. */
export async function listUserHistory(userId: string): Promise<HistorySnapshot> {
  const res = await query<{ payload: HistoryRecord; client_id: string; deleted: boolean }>(
    `SELECT client_id, payload, deleted FROM study_history
     WHERE user_id = $1 ORDER BY archived_at DESC LIMIT $2`,
    [userId, MAX_RECORDS]
  );
  const records: HistoryRecord[] = [];
  const deletedIds: string[] = [];
  for (const row of res.rows) {
    if (row.deleted) deletedIds.push(row.client_id);
    else if (row.payload && typeof row.payload === 'object') records.push(row.payload);
  }
  return { records, deletedIds };
}

/**
 * Insert a record if new. Immutable: ON CONFLICT DO NOTHING, so an existing
 * row (including a tombstone) is never overwritten — a delete always wins over
 * a later re-push of the same id. Prunes to MAX_RECORDS afterwards.
 */
export async function upsertRecord(userId: string, record: HistoryRecord): Promise<void> {
  // archived_at is set from SERVER now() (not the client's value) so ordering,
  // prune, and the 200-record LIMIT are non-forgeable — a client can't pin
  // records or evict its own genuine ones by sending a far-future date. The
  // client's own archivedAt stays in the JSON payload for display.
  await query(
    `INSERT INTO study_history (user_id, client_id, archived_at, payload)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (user_id, client_id) DO NOTHING`,
    [userId, record.id, JSON.stringify(record)]
  );
  await pruneUser(userId);
}

/**
 * Tombstone a record so the delete propagates. Inserts a tombstone row if the
 * record was never pushed from this device (another device may still hold and
 * re-push it — the tombstone stops that).
 */
export async function tombstoneRecord(userId: string, clientId: string): Promise<void> {
  await query(
    `INSERT INTO study_history (user_id, client_id, archived_at, payload, deleted)
     VALUES ($1, $2, now(), '{}'::jsonb, true)
     ON CONFLICT (user_id, client_id) DO UPDATE SET deleted = true, payload = '{}'::jsonb, updated_at = now()`,
    [userId, clientId]
  );
}

/** Keep the newest MAX_RECORDS non-deleted rows; drop older ones (tombstones are tiny, kept). */
async function pruneUser(userId: string): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM study_history
         WHERE user_id = $1 AND deleted = false AND client_id NOT IN (
           SELECT client_id FROM study_history
           WHERE user_id = $1 AND deleted = false
           ORDER BY archived_at DESC LIMIT $2
         )`,
        [userId, MAX_RECORDS]
      );
    });
  } catch {
    // pruning is hygiene, not correctness
  }
}
