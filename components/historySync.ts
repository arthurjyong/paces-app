'use client';

// Client side of study-history sync (Phase 1.1). A signed-in user's archived
// encounters follow them across devices. Two directions:
//  - PUSH (real-time): when a logged-in user archives or deletes a record, we
//    also POST/DELETE it to the server (pushRecordToServer / deleteRecordOnServer).
//  - PULL + merge (on login): syncHistory() fetches the server's set and folds
//    it into local IndexedDB — adds records this device is missing, applies
//    tombstones (deletes propagate). It deliberately does NOT bulk-push local
//    records to the server: only records archived WHILE logged in are uploaded
//    (via the real-time push), so a browser's pre-existing/anonymous local
//    history can never leak into whichever account signs in next. Combined with
//    clearing local History on explicit sign-out (see page.tsx), a shared
//    device never mixes two users.
//
// All calls are best-effort: any failure (offline, 401 when not signed in, DB
// blip) is swallowed — local History keeps working regardless.

import {
  deleteArchived,
  putArchivedRecords,
  sanitizeArchivedRecord,
  type ArchivedEncounter,
} from './historyStore';

interface ServerSnapshot {
  records: unknown[];
  deletedIds: string[];
}

async function fetchSnapshot(): Promise<ServerSnapshot | null> {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return null; // 401 (not signed in) or an error → skip sync
    const data = (await res.json()) as unknown;
    if (
      data &&
      typeof data === 'object' &&
      Array.isArray((data as ServerSnapshot).records) &&
      Array.isArray((data as ServerSnapshot).deletedIds)
    ) {
      return data as ServerSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

/** Push one archived record to the signed-in user's server history (best-effort). */
export async function pushRecordToServer(record: ArchivedEncounter): Promise<void> {
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    });
  } catch {
    // best-effort — the record is safe in local IndexedDB; a later sync catches up
  }
}

/** Tombstone one record on the server so the delete propagates (best-effort). */
export async function deleteRecordOnServer(id: string): Promise<void> {
  try {
    await fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
}

/**
 * Pull the server's history and merge it into local IndexedDB: delete tombstoned
 * records, add records this device doesn't have. Returns true if the local store
 * may have changed (so the caller can refresh the list). No-op when not signed in.
 */
export async function syncHistory(): Promise<boolean> {
  const snap = await fetchSnapshot();
  if (!snap) return false;
  const deleted = new Set(snap.deletedIds.filter((x): x is string => typeof x === 'string'));
  let changed = false;
  for (const id of deleted) {
    try {
      await deleteArchived(id);
      changed = true;
    } catch {
      // ignore
    }
  }
  const toAdd = snap.records
    .map(sanitizeArchivedRecord)
    .filter((r): r is ArchivedEncounter => r !== null && !deleted.has(r.id));
  if (toAdd.length > 0) {
    try {
      await putArchivedRecords(toAdd);
      changed = true;
    } catch {
      // ignore
    }
  }
  return changed;
}
