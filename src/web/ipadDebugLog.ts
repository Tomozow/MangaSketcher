/**
 * iPad-reachable debug ingest. Never POST to 127.0.0.1 from the browser —
 * iPad Safari cannot hit the PC loopback. Same-origin /api/debug-log is
 * written on the Next server (which CAN reach Cursor ingest on loopback).
 */
type DebugPayload = {
  sessionId?: string;
  runId?: string;
  hypothesisId?: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: number;
};

const queue: DebugPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function deviceMeta(): Record<string, unknown> {
  if (typeof navigator === 'undefined') {
    return {};
  }
  return {
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform,
    fromIpad: /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  };
}

function scheduleFlush(): void {
  if (flushTimer != null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = queue.splice(0, queue.length);
    if (batch.length === 0) {
      return;
    }
    const body = batch.map((row) => JSON.stringify(row)).join('\n');
    const blob = new Blob([body], { type: 'text/plain' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/debug-log', blob)) {
        return;
      }
    }
    fetch('/api/debug-log', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'Content-Type': 'text/plain' },
    }).catch(() => {});
  }, 0);
}

export function ipadDebugLog(payload: DebugPayload): void {
  queue.push({
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
    data: { ...deviceMeta(), ...payload.data },
  });
  scheduleFlush();
}
