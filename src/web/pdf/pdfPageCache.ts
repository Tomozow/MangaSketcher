export const PDF_PAGE_CACHE_LIMIT = 3;
/** Sharp pass waits for idle, but must still run soon enough that text snaps into focus. */
export const PDF_SHARP_IDLE_TIMEOUT_MS = 200;

export type PdfCachedBitmap = {
  width: number;
  height: number;
  close: () => void;
};

type CacheEntry = {
  page: number;
  scale: number;
  bitmap: PdfCachedBitmap;
};

function sessionId(opfsPath: string, generation: number): string {
  return `${opfsPath}#g=${generation}`;
}

export function createPdfPageBitmapCache(limit = PDF_PAGE_CACHE_LIMIT) {
  let identity: string | null = null;
  const entries: CacheEntry[] = [];
  const max = Math.max(1, limit);

  function clear(): void {
    for (const entry of entries) {
      try {
        entry.bitmap.close();
      } catch {
        // ImageBitmap.close is best-effort
      }
    }
    entries.length = 0;
  }

  function ensureIdentity(opfsPath: string, generation: number): void {
    const next = sessionId(opfsPath, generation);
    if (identity !== next) {
      clear();
      identity = next;
    }
  }

  function findIndex(page: number): number {
    return entries.findIndex((entry) => entry.page === page);
  }

  function touch(index: number): CacheEntry {
    const [entry] = entries.splice(index, 1);
    entries.push(entry);
    return entry;
  }

  function peek(opfsPath: string, generation: number, page: number): CacheEntry | null {
    ensureIdentity(opfsPath, generation);
    const index = findIndex(page);
    if (index < 0) {
      return null;
    }
    return entries[index];
  }

  function get(opfsPath: string, generation: number, page: number): CacheEntry | null {
    ensureIdentity(opfsPath, generation);
    const index = findIndex(page);
    if (index < 0) {
      return null;
    }
    return touch(index);
  }

  function put(
    opfsPath: string,
    generation: number,
    page: number,
    scale: number,
    bitmap: PdfCachedBitmap,
  ): void {
    ensureIdentity(opfsPath, generation);
    const index = findIndex(page);
    if (index >= 0) {
      const existing = entries[index];
      if (existing.scale >= scale) {
        try {
          bitmap.close();
        } catch {
          // ignore duplicate close
        }
        touch(index);
        return;
      }
      try {
        existing.bitmap.close();
      } catch {
        // ignore
      }
      entries.splice(index, 1);
    } else if (entries.length >= max) {
      const evicted = entries.shift();
      try {
        evicted?.bitmap.close();
      } catch {
        // ignore
      }
    }
    entries.push({ page, scale, bitmap });
  }

  return {
    clear,
    ensureIdentity,
    peek,
    get,
    put,
    get size() {
      return entries.length;
    },
  };
}

export type PdfPageBitmapCache = ReturnType<typeof createPdfPageBitmapCache>;

const sharedCache = createPdfPageBitmapCache();

export function getPdfPageBitmapCache(): PdfPageBitmapCache {
  return sharedCache;
}

export function clearPdfPageBitmaps(): void {
  sharedCache.clear();
}

export function schedulePdfIdle(fn: () => void, timeoutMs = PDF_SHARP_IDLE_TIMEOUT_MS): { cancel: () => void } {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return {
      cancel: () => {
        cancelIdleCallback(id);
      },
    };
  }
  const timer = setTimeout(fn, timeoutMs);
  return {
    cancel: () => {
      clearTimeout(timer);
    },
  };
}
