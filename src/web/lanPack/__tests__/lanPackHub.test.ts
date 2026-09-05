import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  handleLanPack,
  LAN_PACK_DIR_NAME,
  LAN_PACK_LIVE_CODE_LIMIT,
  LAN_PACK_MAX_BYTES,
  parseLanPackPath,
} from '../../../../scripts/static-host/lanPackHub.mjs';

describe('parseLanPackPath', () => {
  test('routes health, root, code, invalid, skip', () => {
    expect(parseLanPackPath('/api/lan-pack/health')).toEqual({ kind: 'health' });
    expect(parseLanPackPath('/api/lan-pack')).toEqual({ kind: 'root' });
    expect(parseLanPackPath('/api/lan-pack/001')).toEqual({ kind: 'code', code: '001' });
    expect(parseLanPackPath('/api/lan-pack/000001')).toEqual({ kind: 'invalid' });
    expect(parseLanPackPath('/api/lan-pack/abc')).toEqual({ kind: 'invalid' });
    expect(parseLanPackPath('/other')).toEqual({ kind: 'skip' });
  });
});

describe('lan pack hub HTTP', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0, dirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function listen() {
    const repoRoot = mkdtempSync(join(tmpdir(), 'lan-pack-'));
    dirs.push(repoRoot);
    const server = createServer((req, res) => {
      void handleLanPack(req, res, { repoRoot, ipv4s: ['192.168.0.2'] });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    return {
      repoRoot,
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
  }

  test('health, mint, put, get, same code stays waiting', async () => {
    const hub = await listen();
    try {
      const origin = 'https://127.0.0.1:3000';
      const health = await fetch(`${hub.url}/api/lan-pack/health`, { headers: { Origin: origin } });
      expect(health.status).toBe(204);
      expect(health.headers.get('Access-Control-Allow-Origin')).toBe(origin);

      const minted = await fetch(`${hub.url}/api/lan-pack`, {
        method: 'POST',
        headers: { Origin: origin },
      });
      expect(minted.status).toBe(200);
      const body = (await minted.json()) as { code: string };
      expect(body.code).toMatch(/^[0-9]{3}$/);

      const waiting = await fetch(`${hub.url}/api/lan-pack/${body.code}`, {
        headers: { Origin: origin },
      });
      expect(waiting.status).toBe(204);

      const zip = Buffer.from('PK\u0003\u0004hub-test');
      const put = await fetch(`${hub.url}/api/lan-pack/${body.code}`, {
        method: 'PUT',
        headers: {
          Origin: origin,
          'Content-Type': 'application/zip',
          'Content-Length': String(zip.length),
        },
        body: zip,
      });
      expect(put.status).toBe(204);

      const got = await fetch(`${hub.url}/api/lan-pack/${body.code}`, { headers: { Origin: origin } });
      expect(got.status).toBe(200);
      expect(Buffer.from(await got.arrayBuffer()).equals(zip)).toBe(true);

      const again = await fetch(`${hub.url}/api/lan-pack/${body.code}`, {
        headers: { Origin: origin },
      });
      expect(again.status).toBe(204);

      const zip2 = Buffer.from('PK\u0003\u0004hub-test-2');
      const put2 = await fetch(`${hub.url}/api/lan-pack/${body.code}`, {
        method: 'PUT',
        headers: {
          Origin: origin,
          'Content-Type': 'application/zip',
          'Content-Length': String(zip2.length),
        },
        body: zip2,
      });
      expect(put2.status).toBe(204);
      const got2 = await fetch(`${hub.url}/api/lan-pack/${body.code}`, { headers: { Origin: origin } });
      expect(got2.status).toBe(200);
      expect(Buffer.from(await got2.arrayBuffer()).equals(zip2)).toBe(true);
    } finally {
      await hub.close();
    }
  });

  test('rejects unknown origin and declared oversize', async () => {
    const hub = await listen();
    try {
      const forbidden = await fetch(`${hub.url}/api/lan-pack/health`, {
        headers: { Origin: 'https://evil.example:3000' },
      });
      expect(forbidden.status).toBe(403);

      const minted = await fetch(`${hub.url}/api/lan-pack`, {
        method: 'POST',
        headers: { Origin: 'https://192.168.0.2:3000' },
      });
      const { code } = (await minted.json()) as { code: string };

      const tooBig = await new Promise<{ status: number }>((resolve, reject) => {
        const req = httpRequest(
          `${hub.url}/api/lan-pack/${code}`,
          {
            method: 'PUT',
            headers: {
              Origin: 'https://192.168.0.2:3000',
              'Content-Type': 'application/zip',
              'Content-Length': String(LAN_PACK_MAX_BYTES + 1),
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(tooBig.status).toBe(413);
    } finally {
      await hub.close();
    }
  });

  test('non three-digit path is 404', async () => {
    const hub = await listen();
    try {
      const res = await fetch(`${hub.url}/api/lan-pack/12ab56`, {
        headers: { Origin: 'https://127.0.0.1:3000' },
      });
      expect(res.status).toBe(404);
    } finally {
      await hub.close();
    }
  });

  test('DELETE removes the code and GET is then 404', async () => {
    const hub = await listen();
    try {
      const origin = 'https://127.0.0.1:3000';
      const minted = await fetch(`${hub.url}/api/lan-pack`, {
        method: 'POST',
        headers: { Origin: origin },
      });
      const { code } = (await minted.json()) as { code: string };
      const del = await fetch(`${hub.url}/api/lan-pack/${code}`, {
        method: 'DELETE',
        headers: { Origin: origin },
      });
      expect(del.status).toBe(204);
      const got = await fetch(`${hub.url}/api/lan-pack/${code}`, { headers: { Origin: origin } });
      expect(got.status).toBe(404);
    } finally {
      await hub.close();
    }
  });

  test('mint returns 503 when live codes are at the limit', async () => {
    const hub = await listen();
    try {
      const dir = join(hub.repoRoot, LAN_PACK_DIR_NAME);
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < LAN_PACK_LIVE_CODE_LIMIT; i += 1) {
        const code = String(i).padStart(3, '0');
        writeFileSync(join(dir, `${code}.json`), `${JSON.stringify({ createdAt: 1 })}\n`);
      }
      const minted = await fetch(`${hub.url}/api/lan-pack`, {
        method: 'POST',
        headers: { Origin: 'https://127.0.0.1:3000' },
      });
      expect(minted.status).toBe(503);
    } finally {
      await hub.close();
    }
  });

  test('sweep removes leftover six-digit transfer files', async () => {
    const hub = await listen();
    try {
      const dir = join(hub.repoRoot, LAN_PACK_DIR_NAME);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '000000.json'), `${JSON.stringify({ createdAt: 1 })}\n`);
      await fetch(`${hub.url}/api/lan-pack/health`, {
        headers: { Origin: 'https://127.0.0.1:3000' },
      });
      expect(existsSync(join(dir, '000000.json'))).toBe(false);
    } finally {
      await hub.close();
    }
  });
});
