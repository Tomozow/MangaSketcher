import { appendFile } from 'node:fs/promises';
import path from 'node:path';

function linesFromBody(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((row) => JSON.stringify(row));
      }
    } catch {
      return [];
    }
  }
  return trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function persist(line: string): Promise<void> {
  let sessionId = 'ipad';
  try {
    const parsed = JSON.parse(line) as { sessionId?: string; ingest?: string };
    if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      sessionId = parsed.sessionId;
    }
    const name = `debug-${sessionId}.log`;
    await appendFile(path.join(process.cwd(), name), `${line}\n`);
    await appendFile(path.join(process.cwd(), '.cursor', name), `${line}\n`).catch(() => {});
    const ingest = typeof parsed.ingest === 'string' ? parsed.ingest : process.env.CURSOR_DEBUG_INGEST;
    if (ingest) {
      await fetch(ingest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
        body: line,
      }).catch(() => {});
    }
  } catch {
    const name = `debug-${sessionId}.log`;
    await appendFile(path.join(process.cwd(), name), `${line}\n`).catch(() => {});
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('not found', { status: 404 });
  }
  const raw = await request.text();
  for (const line of linesFromBody(raw)) {
    await persist(line);
  }
  return new Response('ok');
}
