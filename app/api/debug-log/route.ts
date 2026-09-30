import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Dev-only sink for browser (iPad) debug rows. Parked by scripts/build-static.mjs for static export. */
function linesFromBody(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function persist(line: string): Promise<void> {
  let sessionId = 'ipad';
  try {
    const parsed = JSON.parse(line) as { sessionId?: string };
    if (typeof parsed.sessionId === 'string' && /^[\w-]{1,40}$/.test(parsed.sessionId)) {
      sessionId = parsed.sessionId;
    }
  } catch {
    // keep raw line under the default session
  }
  const dir = path.join(process.cwd(), 'debug');
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, `debug-${sessionId}.log`), `${line}\n`);
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('not found', { status: 404 });
  }
  const raw = await request.text();
  for (const line of linesFromBody(raw)) {
    await persist(line).catch(() => {});
  }
  return new Response('ok');
}
