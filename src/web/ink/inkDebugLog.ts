import { ipadDebugLog } from '@/src/web/ipadDebugLog';

/** Rows land in debug/debug-ink-loss.log (dev server only). Kept to low-frequency events. */
export function inkLog(location: string, message: string, data?: Record<string, unknown>): void {
  ipadDebugLog({ sessionId: 'ink-loss', location, message, data });
}
