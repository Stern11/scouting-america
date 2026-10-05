/**
 * Local persistence for an uploaded planning dataset.
 *
 * Uploaded workbook data stays in the browser. It is never posted to a server,
 * an LLM, or analytics (V2 §36) — IndexedDB is the whole storage story.
 *
 * Stored per signed-in account (see `lib/utils/storage-scope.ts`): another
 * account on the same browser never reads this account's workbook.
 *
 * A demo dataset is never stored here: it is regenerated from its seed, which
 * is both smaller and guaranteed to stay in step with the generator.
 */

import type { PlanningDataset } from "@/types/dataset";
import { scopedKey } from "@/lib/utils/storage-scope";

const DB_NAME = "heizen";
const DB_VERSION = 1;
const STORE = "datasets";
/**
 * Versioned: the first product generation stored a different dataset shape
 * under "active-upload". A new key means an old workbook is never read back
 * as if it were transition data; it is deleted instead.
 */
const ACTIVE_KEY = "active-upload-v2";
const LEGACY_ACTIVE_KEY = "active-upload";
const PROBE_KEY = "write-probe";

function supported(): boolean {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!supported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private-mode browsers can throw on open rather than erroring.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * Every operation resolves rather than rejects. Storage being unavailable is a
 * degraded session, not a crash — the caller falls back to keeping the dataset
 * in memory for the current page.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  fallback: T
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    let request: IDBRequest;
    try {
      request = run(db.transaction(STORE, mode).objectStore(STORE));
    } catch {
      db.close();
      resolve(fallback);
      return;
    }
    request.onsuccess = () => {
      resolve((request.result as T) ?? fallback);
      db.close();
    };
    request.onerror = () => {
      resolve(fallback);
      db.close();
    };
  });
}

/**
 * Writes one value and resolves true only once the transaction has committed.
 *
 * A successful `put` request is not a successful write: quota and policy
 * failures surface on the transaction, after the request has already reported
 * success. Only `complete` means the data will survive a refresh.
 */
async function putDurably(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
    } catch {
      // DataCloneError and friends throw synchronously.
      db.close();
      resolve(false);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
    tx.onabort = () => {
      db.close();
      resolve(false);
    };
  });
}

/**
 * This tab's copy of the most recent upload. Held whatever happens to the
 * durable write, so a failed save degrades to "gone after a refresh" rather
 * than to an empty workspace the moment the planner clicks Run planning.
 */
let inMemory: { key: string; dataset: PlanningDataset } | null = null;

/** True only when the workbook is durably stored for the signed-in account. */
export async function saveUploadedDataset(dataset: PlanningDataset): Promise<boolean> {
  const key = scopedKey(ACTIVE_KEY);
  if (key === null) return false;
  inMemory = { key, dataset };
  return putDurably(key, dataset);
}

export async function loadUploadedDataset(): Promise<PlanningDataset | null> {
  const key = scopedKey(ACTIVE_KEY);
  if (key === null) return null;
  const legacy = scopedKey(LEGACY_ACTIVE_KEY);
  if (legacy !== null) await withStore<unknown>("readwrite", (s) => s.delete(legacy), null);
  const stored = await withStore<PlanningDataset | null>("readonly", (s) => s.get(key), null);
  if (stored && isTransitionDataset(stored)) return stored;
  return inMemory?.key === key ? inMemory.dataset : null;
}

/** A guard against anything stored under the key that is not this model. */
function isTransitionDataset(value: unknown): value is PlanningDataset {
  const v = value as Partial<PlanningDataset> | null;
  return Boolean(v && Array.isArray(v.stores) && Array.isArray(v.skus) && Array.isArray(v.sales) && v.metadata);
}

/** Removes the signed-in account's workbook, durable and in-memory. */
export async function clearUploadedDataset(): Promise<void> {
  const key = scopedKey(ACTIVE_KEY);
  if (key === null) return;
  if (inMemory?.key === key) inMemory = null;
  await withStore<unknown>("readwrite", (s) => s.delete(key), null);
}

/**
 * Removes a workbook stored before storage was scoped per account. Nothing
 * says whose it was, so it is dropped rather than handed to whoever signs in
 * first.
 */
export async function clearUnscopedUpload(): Promise<void> {
  await withStore<unknown>("readwrite", (s) => s.delete(ACTIVE_KEY), null);
  await withStore<unknown>("readwrite", (s) => s.delete(LEGACY_ACTIVE_KEY), null);
}

/** Whether this browser exposes IndexedDB at all. See `probePersistence` for whether it keeps writes. */
export function persistenceAvailable(): boolean {
  return supported();
}

/**
 * Whether a write here will actually survive a refresh. The API existing is
 * not enough — private modes, blocked site data and exhausted quota all
 * expose `indexedDB` and then refuse or discard the write.
 */
export async function probePersistence(): Promise<boolean> {
  if (!supported()) return false;
  const ok = await putDurably(PROBE_KEY, 1);
  if (ok) await withStore<unknown>("readwrite", (s) => s.delete(PROBE_KEY), null);
  return ok;
}
