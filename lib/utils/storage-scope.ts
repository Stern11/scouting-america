/**
 * Whose planning data this browser is reading and writing.
 *
 * Sign-in identifies the planner, but browser storage belongs to the browser
 * profile, not the account. Every persisted planning key — the dataset choice,
 * decisions, scenarios and an uploaded workbook — is therefore suffixed with a
 * namespace derived from the signed-in account, so a second account on the
 * same machine starts empty instead of inheriting the first one's data. Until
 * an account is bound, planning data is neither read nor written.
 *
 * Isolation, not secrecy: anyone with this browser profile can still read its
 * storage. This stops one account's data surfacing under another; it is not
 * encryption.
 *
 * Plain module state rather than a store: it has to be readable synchronously
 * from inside zustand's storage adapter and from IndexedDB helpers.
 */

let namespace: string | null = null;

export function setStorageNamespace(value: string | null): void {
  namespace = value;
}

export function storageNamespace(): string | null {
  return namespace;
}

/** `base` suffixed with the active account's namespace, or null when none is bound. */
export function scopedKey(base: string): string | null {
  return namespace === null ? null : `${base}:${namespace}`;
}

/**
 * A stable namespace for an account. Hashed (cyrb53) so storage key names do
 * not spell out the planner's email address.
 */
export function namespaceFor(email: string): string {
  const input = email.trim().toLowerCase();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
