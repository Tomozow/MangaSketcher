import { describe, expect, test, vi } from 'vitest';
import { DOWNLOAD_OBJECT_URL_REVOKE_MS } from '../constants';
import { WorkspaceExportError } from '../errors';
import {
  canShareExportFile,
  revokeExportObjectUrl,
  scheduleDownloadUrlRevoke,
  shareExportFile,
  type ObjectUrlTracker,
} from '../saveExportZip';

function zipFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'demo.zip', { type: 'application/zip' });
}

describe('canShareExportFile', () => {
  test('requires share, canShare, and true for the real file', () => {
    const file = zipFile();
    expect(canShareExportFile(file, {})).toBe(false);
    expect(
      canShareExportFile(file, {
        share: async () => {},
        canShare: () => false,
      }),
    ).toBe(false);
    expect(
      canShareExportFile(file, {
        share: async () => {},
        canShare: (data) => data.files?.[0] === file,
      }),
    ).toBe(true);
  });
});

describe('shareExportFile', () => {
  test('AbortError is aborted not failed', async () => {
    const err = new Error('cancel');
    err.name = 'AbortError';
    const result = await shareExportFile(zipFile(), {
      share: async () => {
        throw err;
      },
    });
    expect(result).toBe('aborted');
  });

  test('other share errors become export failures', async () => {
    await expect(
      shareExportFile(zipFile(), {
        share: async () => {
          throw new Error('NotAllowedError');
        },
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });
});

describe('object url revoke', () => {
  test('download click urls wait 60s', () => {
    const revoke = vi.fn();
    const schedule = vi.fn((callback: () => void, ms: number) => {
      expect(ms).toBe(DOWNLOAD_OBJECT_URL_REVOKE_MS);
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    scheduleDownloadUrlRevoke('blob:test', { revoke, schedule });
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  test('unused urls revoke immediately; used download urls do not', () => {
    const unused: ObjectUrlTracker = {
      url: 'blob:unused',
      usedForDownload: false,
      revokeTimer: null,
    };
    const used: ObjectUrlTracker = {
      url: 'blob:used',
      usedForDownload: true,
      revokeTimer: null,
    };
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    revokeExportObjectUrl(unused, { unusedOnly: true });
    revokeExportObjectUrl(used, { unusedOnly: true });
    expect(revoke).toHaveBeenCalledWith('blob:unused');
    expect(revoke).not.toHaveBeenCalledWith('blob:used');
    revoke.mockRestore();
  });
});
