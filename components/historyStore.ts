'use client';

// Client-side History archive: finished/parked encounters in IndexedDB
// (db "paces", store "encounters"). Entirely in-browser — the backend stays
// stateless and never sees transcripts. Records denormalise the case meta so
// a history entry outlives manifest renames/removals across content redeploys.

import type { PublicCaseMeta } from '@/lib/types';
import { isRenderableMeta, sanitizeEncounterPayload, type EncounterPayload } from './shared';

export interface ArchivedEncounter extends EncounterPayload {
  /** unique record id: `<archivedAt ISO>_<caseId>` (sortable, collision-free in practice) */
  id: string;
  archivedAt: string;
  /** denormalised at archive time — the record renders and reopens without a manifest lookup */
  meta: PublicCaseMeta;
}

const DB_NAME = 'paces';
const STORE = 'encounters';
/** Hygiene cap — oldest records pruned beyond this (a full transcript is a few KB). */
const MAX_RECORDS = 200;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/** Meta fields the UI renders / the engine needs; anything else is passed through. */
function hasRenderableMeta(x: unknown): x is { meta: PublicCaseMeta } {
  if (!x || typeof x !== 'object') return false;
  return isRenderableMeta((x as ArchivedEncounter).meta);
}

/**
 * Rebuild one archived record from untrusted data (IndexedDB row OR a record
 * pulled from the server's history sync), or null if unusable. Same discipline
 * as the autosave blob: a foreign/malformed write reads as "skip".
 */
export function sanitizeArchivedRecord(raw: unknown): ArchivedEncounter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as ArchivedEncounter;
  if (typeof r.id !== 'string' || typeof r.archivedAt !== 'string' || !hasRenderableMeta(r)) return null;
  const payload = sanitizeEncounterPayload(r);
  if (!payload) return null;
  return { id: r.id, archivedAt: r.archivedAt, meta: r.meta, ...payload };
}

/**
 * All archived encounters, newest first. Records failing validation (foreign
 * writes, schema drift) are silently skipped — never rendered, never reopened.
 */
export async function listArchived(): Promise<ArchivedEncounter[]> {
  const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<unknown[]>);
  const valid: ArchivedEncounter[] = [];
  for (const raw of all) {
    const rec = sanitizeArchivedRecord(raw);
    if (rec) valid.push(rec);
  }
  return valid.sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
}

/** Store one record, then prune the oldest beyond MAX_RECORDS (best-effort). */
export async function archiveEncounter(record: ArchivedEncounter): Promise<void> {
  await withStore('readwrite', (s) => s.put(record));
  try {
    const all = await listArchived();
    for (const r of all.slice(MAX_RECORDS)) {
      await withStore('readwrite', (s) => s.delete(r.id));
    }
  } catch {
    // pruning is hygiene, not correctness
  }
}

export async function deleteArchived(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

/** Merge validated records (e.g. pulled from server sync) into the store, then prune. */
export async function putArchivedRecords(records: ArchivedEncounter[]): Promise<void> {
  for (const rec of records) {
    const clean = sanitizeArchivedRecord(rec);
    if (clean) await withStore('readwrite', (s) => s.put(clean));
  }
  try {
    const all = await listArchived();
    for (const r of all.slice(MAX_RECORDS)) {
      await withStore('readwrite', (s) => s.delete(r.id));
    }
  } catch {
    // pruning is hygiene, not correctness
  }
}

/** Wipe the local History store — used on explicit sign-out so a shared device doesn't mix users. */
export async function clearAllArchived(): Promise<void> {
  await withStore('readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>);
}
