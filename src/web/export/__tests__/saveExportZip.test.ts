import { describe, expect, test, vi } from 'vitest';
import { DOWNLOAD_OBJECT_URL_REVOKE_MS } from '../constants';
import {
  revokeExportObjectUrl,
  scheduleDownloadUrlRevoke,
  type ObjectUrlTracker,
} from '../saveExportZip';

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
