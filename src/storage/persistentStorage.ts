let asked = false;

export function resetPersistentStorageGate(): void {
  asked = false;
}

/** Spec §3.6: one persist() after the first successful save. Failure is ignored. */
export async function requestPersistentStorage(): Promise<void> {
  if (asked) {
    return;
  }
  asked = true;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
      return;
    }
    await navigator.storage.persist();
  } catch {
    // iPad Safari may deny; keep editing.
  }
}
