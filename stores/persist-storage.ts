import type { StateStorage } from "zustand/middleware";
import { scopedKey } from "@/lib/utils/storage-scope";

/**
 * SSR-safe Web Storage access for the zustand `persist` middleware.
 *
 * Two hazards this exists to defuse:
 *
 * 1. **The server has no Storage.** Every store here is imported by
 *    components that render on the server, so touching `sessionStorage`
 *    during module evaluation would throw during SSR. Each accessor is
 *    resolved lazily and guarded.
 * 2. **Hydration mismatch.** If persist rehydrated synchronously at module
 *    load, the client's FIRST render would use restored state while the
 *    server-rendered HTML used defaults, and React would report a hydration
 *    mismatch (or silently discard one tree). Every store using this storage
 *    is therefore configured with `skipHydration: true` and rehydrated from a
 *    `useEffect` in `components/layout/app-providers.tsx`, which runs strictly
 *    AFTER hydration has completed. The first client render is byte-identical
 *    to the server's; the restored state arrives one commit later.
 *
 * Storage can also be unavailable in a browser (Safari private mode, blocked
 * site data), so every call is wrapped: persistence degrades to "this session
 * only", never to a crash.
 */
function resolve(kind: "local" | "session"): Storage | null {
  try {
    const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
    const store = kind === "local" ? g.localStorage : g.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function webStorage(kind: "local" | "session"): StateStorage {
  return {
    getItem: (name) => {
      try {
        return resolve(kind)?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        resolve(kind)?.setItem(name, value);
      } catch {
        /* quota exceeded / storage disabled — the session keeps working in memory */
      }
    },
    removeItem: (name) => {
      try {
        resolve(kind)?.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * `webStorage`, with every key suffixed by the signed-in account's namespace
 * (see `lib/utils/storage-scope.ts`). With no account bound it reads nothing
 * and writes nothing, so planning data never lands under a key another account
 * on this browser would read.
 */
export function scopedWebStorage(kind: "local" | "session"): StateStorage {
  const inner = webStorage(kind);
  return {
    getItem: (name) => {
      const key = scopedKey(name);
      return key === null ? null : inner.getItem(key);
    },
    setItem: (name, value) => {
      const key = scopedKey(name);
      if (key !== null) void inner.setItem(key, value);
    },
    removeItem: (name) => {
      const key = scopedKey(name);
      if (key !== null) void inner.removeItem(key);
    },
  };
}

/** Direct read/write for the one value that must be applied BEFORE React runs (the theme). */
export function readRaw(kind: "local" | "session", key: string): string | null {
  try {
    return resolve(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(kind: "local" | "session", key: string, value: string): void {
  try {
    resolve(kind)?.setItem(key, value);
  } catch {
    /* ignore */
  }
}
