import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { lanIPv4s } from '../lanHttpsShared.mjs';

export const LAN_PACK_MAX_BYTES = 200 * 1024 * 1024;
export const LAN_PACK_DIR_NAME = '.lan-transfer';

export function isLanPackCode(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

export function lanPackOriginKind(origin, ipv4s) {
  if (!origin) {
    return 'hub';
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    return 'reject';
  }
  const hosts = new Set(['127.0.0.1', 'localhost', ...ipv4s]);
  if (!hosts.has(url.hostname)) {
    return 'reject';
  }
  if (url.protocol === 'https:' && url.port === '3000') {
    return 'pc';
  }
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '3001') {
    return 'pc';
  }
  if (url.protocol === 'https:' && url.port === '3443') {
    return 'hub';
  }
  return 'reject';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function applyCors(res, origin, kind) {
  if (kind === 'pc' && origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      res.setHeader(key, value);
    }
  }
}

export function parseLanPackPath(pathname) {
  if (pathname === '/api/lan-pack/health') {
    return { kind: 'health' };
  }
  if (pathname === '/api/lan-pack') {
    return { kind: 'root' };
  }
  const match = pathname.match(/^\/api\/lan-pack\/([0-9]{6})$/);
  if (match) {
    return { kind: 'code', code: match[1] };
  }
  if (pathname.startsWith('/api/lan-pack')) {
    return { kind: 'invalid' };
  }
  return { kind: 'skip' };
}

function transferDir(repoRoot) {
  return join(repoRoot, LAN_PACK_DIR_NAME);
}

function metaPath(dir, code) {
  return join(dir, `${code}.json`);
}

function zipPath(dir, code) {
  return join(dir, `${code}.zip`);
}

function partPath(dir, code) {
  return join(dir, `${code}.part`);
}

function unlinkQuiet(path) {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // ignore
  }
}

export function removeCode(dir, code) {
  unlinkQuiet(metaPath(dir, code));
  unlinkQuiet(zipPath(dir, code));
  unlinkQuiet(partPath(dir, code));
}

export function sweepLanPackDir(dir) {
  if (!existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    const match = name.match(/^([0-9]{6})\.(json|zip|part)$/);
    if (!match) {
      continue;
    }
    const code = match[1];
    const jsonPath = metaPath(dir, code);
    if (!existsSync(jsonPath)) {
      removeCode(dir, code);
      continue;
    }
    try {
      JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch {
      removeCode(dir, code);
    }
  }
}

function readMeta(dir, code) {
  const path = metaPath(dir, code);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    removeCode(dir, code);
    return null;
  }
}

function writeMeta(dir, code, meta) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(metaPath(dir, code), `${JSON.stringify(meta)}\n`);
}

function mintCode(dir) {
  for (let i = 0; i < 64; i += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!existsSync(metaPath(dir, code))) {
      writeMeta(dir, code, { createdAt: Date.now() });
      return code;
    }
  }
  return null;
}

function send(res, status, origin, kind, body, extraHeaders = {}) {
  applyCors(res, origin, kind);
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  if (body == null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.setHeader('Content-Type', typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  res.writeHead(status);
  res.end(payload);
}

/**
 * @returns {Promise<boolean>} true if the request was a lan-pack route (including 404s)
 */
export async function handleLanPack(req, res, opts = {}) {
  const repoRoot = opts.repoRoot;
  const ipv4s = opts.ipv4s ?? lanIPv4s();
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/', `https://${host}`);
  const parsed = parseLanPackPath(url.pathname);
  if (parsed.kind === 'skip') {
    return false;
  }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const kind = lanPackOriginKind(origin || null, ipv4s);
  if (origin && kind === 'reject') {
    res.writeHead(403);
    res.end();
    return true;
  }

  const dir = transferDir(repoRoot);
  sweepLanPackDir(dir);

  if (req.method === 'OPTIONS') {
    if (parsed.kind === 'invalid') {
      send(res, 404, origin, kind, null);
      return true;
    }
    applyCors(res, origin, kind);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (parsed.kind === 'invalid') {
    send(res, 404, origin, kind, null);
    return true;
  }

  if (parsed.kind === 'health') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      send(res, 204, origin, kind, null);
      return true;
    }
    send(res, 405, origin, kind, null);
    return true;
  }

  if (parsed.kind === 'root') {
    if (req.method !== 'POST') {
      send(res, 405, origin, kind, null);
      return true;
    }
    mkdirSync(dir, { recursive: true });
    const code = mintCode(dir);
    if (!code) {
      send(res, 503, origin, kind, { error: 'busy' });
      return true;
    }
    send(res, 200, origin, kind, { code });
    return true;
  }

  const { code } = parsed;
  const meta = readMeta(dir, code);

  if (req.method === 'PUT') {
    if (!meta) {
      send(res, 404, origin, kind, null);
      return true;
    }
    if (existsSync(zipPath(dir, code))) {
      send(res, 409, origin, kind, null);
      return true;
    }
    const rawLen = req.headers['content-length'];
    if (rawLen != null) {
      const length = Number.parseInt(String(rawLen), 10);
      if (!Number.isFinite(length) || length <= 0 || length > LAN_PACK_MAX_BYTES) {
        req.resume();
        send(res, 413, origin, kind, null);
        return true;
      }
    }
    mkdirSync(dir, { recursive: true });
    const dest = partPath(dir, code);
    unlinkQuiet(dest);
    let received = 0;
    try {
      await pipeline(
        req,
        async function* (source) {
          for await (const chunk of source) {
            received += chunk.length;
            if (received > LAN_PACK_MAX_BYTES) {
              const err = new Error('too large');
              err.code = 'LAN_PACK_TOO_LARGE';
              throw err;
            }
            yield chunk;
          }
        },
        createWriteStream(dest),
      );
    } catch (err) {
      unlinkQuiet(dest);
      if (err && err.code === 'LAN_PACK_TOO_LARGE') {
        send(res, 413, origin, kind, null);
        return true;
      }
      send(res, 500, origin, kind, null);
      return true;
    }
    if (received <= 0) {
      unlinkQuiet(dest);
      send(res, 413, origin, kind, null);
      return true;
    }
    try {
      renameSync(dest, zipPath(dir, code));
    } catch {
      unlinkQuiet(dest);
      send(res, 500, origin, kind, null);
      return true;
    }
    send(res, 204, origin, kind, null);
    return true;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!meta) {
      send(res, 404, origin, kind, null);
      return true;
    }
    const zip = zipPath(dir, code);
    if (!existsSync(zip)) {
      send(res, 204, origin, kind, null);
      return true;
    }
    applyCors(res, origin, kind);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return true;
    }
    res.writeHead(200);
    await pipeline(createReadStream(zip), res);
    unlinkQuiet(zip);
    unlinkQuiet(partPath(dir, code));
    return true;
  }

  send(res, 405, origin, kind, null);
  return true;
}
