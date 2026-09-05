import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import { isLanPackCode, lanPackApiUrl } from './hubUrl';

export const LAN_PACK_FETCH_TIMEOUT_MS = 4000;

async function lanPackFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = LAN_PACK_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const outer = init.signal;
  const onOuterAbort = () => ac.abort();
  outer?.addEventListener('abort', onOuterAbort);
  try {
    return await fetch(url, { ...init, cache: init.cache ?? 'no-store', signal: ac.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

export async function probeLanPackHub(hubBase: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await lanPackFetch(
      lanPackApiUrl(hubBase, '/api/lan-pack/health'),
      { method: 'GET', signal },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

export async function mintLanPackCode(hubBase: string, signal?: AbortSignal): Promise<{ code: string }> {
  const response = await lanPackFetch(lanPackApiUrl(hubBase, '/api/lan-pack'), {
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    throw new Error('mint');
  }
  const body = (await response.json()) as { code?: string };
  if (typeof body.code !== 'string' || !isLanPackCode(body.code)) {
    throw new Error('mint');
  }
  return { code: body.code };
}

export function releaseLanPackCode(hubBase: string, code: string): void {
  if (!isLanPackCode(code)) {
    return;
  }
  void fetch(lanPackApiUrl(hubBase, `/api/lan-pack/${code}`), {
    method: 'DELETE',
    cache: 'no-store',
    keepalive: true,
  }).catch(() => undefined);
}

export async function putLanPackZip(
  hubBase: string,
  code: string,
  file: File,
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(lanPackApiUrl(hubBase, `/api/lan-pack/${code}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
    cache: 'no-store',
    signal,
  });
  return response.status;
}

export async function getLanPackZip(
  hubBase: string,
  code: string,
  signal?: AbortSignal,
): Promise<{ status: number; file: File | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LAN_PACK_FETCH_TIMEOUT_MS);
  const onOuterAbort = () => ac.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const response = await fetch(lanPackApiUrl(hubBase, `/api/lan-pack/${code}`), {
      method: 'GET',
      cache: 'no-store',
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (response.status !== 200) {
      return { status: response.status, file: null };
    }
    const blob = await response.blob();
    return {
      status: 200,
      file: new File([blob], 'lan-pack.zip', { type: 'application/zip' }),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export function logLanPack(message: string, data: Record<string, unknown>): void {
  ipadDebugLog({
    sessionId: 'lan-pack',
    hypothesisId: 'lan-pack',
    location: 'lanPack/client.ts',
    message,
    data,
  });
}
