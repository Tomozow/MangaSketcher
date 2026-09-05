import { Agent, request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { IncomingMessage } from 'node:http';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HUB = { hostname: '127.0.0.1', port: 3443 };
const tlsAgent = new Agent({ rejectUnauthorized: false });
const DROP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function hubPath(slug: string[] | undefined, search: string): string {
  const extra = slug?.length ? `/${slug.join('/')}` : '';
  return `/api/lan-pack${extra}${search}`;
}

function incomingToWeb(msg: IncomingMessage): ReadableStream<Uint8Array> {
  return Readable.toWeb(msg) as unknown as ReadableStream<Uint8Array>;
}

function proxy(req: NextRequest, slug: string[] | undefined): Promise<Response> {
  const method = req.method.toUpperCase();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!DROP.has(key.toLowerCase())) {
      headers[key] = value;
    }
  });
  return new Promise((resolve) => {
    const upstream = httpsRequest(
      {
        ...HUB,
        path: hubPath(slug, req.nextUrl.search),
        method,
        headers,
        agent: tlsAgent,
      },
      (up) => {
        const status = up.statusCode ?? 502;
        const outHeaders = new Headers();
        for (const [key, value] of Object.entries(up.headers)) {
          if (!value || DROP.has(key.toLowerCase())) {
            continue;
          }
          if (Array.isArray(value)) {
            for (const item of value) {
              outHeaders.append(key, item);
            }
          } else {
            outHeaders.set(key, value);
          }
        }
        const empty = method === 'HEAD' || status === 204 || status === 205 || status === 304;
        if (empty) {
          up.resume();
          resolve(new Response(null, { status, headers: outHeaders }));
          return;
        }
        resolve(new Response(incomingToWeb(up), { status, headers: outHeaders }));
      },
    );
    upstream.on('error', () => {
      resolve(
        new Response(null, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }),
      );
    });
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') {
      upstream.end();
      return;
    }
    if (!req.body) {
      upstream.end();
      return;
    }
    Readable.fromWeb(req.body as unknown as NodeReadableStream).pipe(upstream);
  });
}

type Ctx = { params: Promise<{ slug?: string[] }> };

async function run(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { slug } = await ctx.params;
  return proxy(req, slug);
}

export const GET = run;
export const HEAD = run;
export const POST = run;
export const PUT = run;
export const DELETE = run;
export const OPTIONS = run;
