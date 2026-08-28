import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

const LOG_PATH = join(process.cwd(), 'debug-516081.log');
const INGEST_URL = 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';

export async function POST(request: Request) {
  const body = await request.text();
  try {
    appendFileSync(LOG_PATH, `${body}\n`);
  } catch {
    // ignore file write errors during debug
  }
  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '516081',
      },
      body,
    });
  } catch {
    // ignore ingest errors when server unavailable
  }
  return NextResponse.json({ ok: true });
}
