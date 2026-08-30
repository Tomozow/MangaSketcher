/**
 * Streaming ZIP writer for .clip archives.
 * Entries are stored uncompressed (ZipPassThrough): .clip bodies are already
 * zlib-compressed tile data, so deflate would waste CPU for ~0 gain.
 */
import { Zip, ZipPassThrough } from 'fflate';

export interface ClipZipStream {
  /** Append one complete file; emits its chunks synchronously via onChunk. */
  addFile(name: string, bytes: Uint8Array): void;
  /** Write the central directory; emits the remaining chunks. */
  finish(): void;
}

export function createClipZipStream(
  onChunk: (chunk: Uint8Array, final: boolean) => void,
): ClipZipStream {
  let error: Error | null = null;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      error = err instanceof Error ? err : new Error(String(err));
      return;
    }
    onChunk(chunk, final);
  });

  const throwPending = () => {
    if (error) {
      throw error;
    }
  };

  return {
    addFile(name: string, bytes: Uint8Array): void {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(bytes, true);
      throwPending();
    },
    finish(): void {
      zip.end();
      throwPending();
    },
  };
}
