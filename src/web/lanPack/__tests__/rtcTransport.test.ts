import { afterEach, describe, expect, test, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

class FakeEmitter {
  private handlers = new Map<string, Handler[]>();
  on(event: string, fn: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  once(event: string, fn: Handler) {
    return this.on(event, fn);
  }
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) {
      fn(...args);
    }
  }
}

class FakeConn extends FakeEmitter {
  sent: unknown[] = [];
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.emit('close');
  }
}

const peers: FakePeer[] = [];

class FakePeer extends FakeEmitter {
  destroyed = false;
  constructor() {
    super();
    peers.push(this);
    queueMicrotask(() => this.emit('open'));
  }
  destroy() {
    this.destroyed = true;
  }
  reconnect() {}
}

vi.mock('peerjs', () => ({ default: FakePeer }));

const { mintRtcCode, releaseRtcCode, setRtcOfferHandler, waitRtcZip } = await import('../rtcTransport');

async function receiverConn(): Promise<{ code: string; conn: FakeConn }> {
  const { code } = await mintRtcCode();
  const conn = new FakeConn();
  peers[peers.length - 1].emit('connection', conn);
  return { code, conn };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  releaseRtcCode();
  setRtcOfferHandler(null);
  peers.length = 0;
});

describe('rtcTransport receiver', () => {
  test('declined offers are refused and their bytes are never kept', async () => {
    const asked = vi.fn(() => false);
    setRtcOfferHandler(asked);
    const { code, conn } = await receiverConn();
    const got = vi.fn();
    void waitRtcZip(code).then(got);

    conn.emit('data', JSON.stringify({ t: 'offer', size: 4, name: 'x' }));
    await flush();
    conn.emit('data', new Uint8Array([1, 2, 3, 4]).buffer);
    conn.emit('data', JSON.stringify({ t: 'done' }));
    await flush();

    expect(asked).toHaveBeenCalledWith({ name: 'x', size: 4 });
    expect(conn.sent.map((m) => JSON.parse(String(m)))).toEqual([{ t: 'ack', ok: false, status: 403 }]);
    expect(got).not.toHaveBeenCalled();
  });

  test('without a handler every offer is refused', async () => {
    const { conn } = await receiverConn();
    conn.emit('data', JSON.stringify({ t: 'offer', size: 4, name: 'x' }));
    await flush();
    expect(JSON.parse(String(conn.sent[0]))).toMatchObject({ ok: false, status: 403 });
  });

  test('bytes before acceptance are refused', async () => {
    setRtcOfferHandler(() => true);
    const { conn } = await receiverConn();
    conn.emit('data', new Uint8Array([1]).buffer);
    expect(JSON.parse(String(conn.sent[0]))).toMatchObject({ ok: false, status: 400 });
  });

  test('accepted offer delivers the file', async () => {
    setRtcOfferHandler(() => true);
    const { code, conn } = await receiverConn();
    const result = waitRtcZip(code);

    conn.emit('data', JSON.stringify({ t: 'offer', size: 4, name: 'x' }));
    await flush();
    expect(JSON.parse(String(conn.sent[0]))).toEqual({ t: 'accept' });
    conn.emit('data', new Uint8Array([1, 2]).buffer);
    conn.emit('data', new Uint8Array([3, 4]).buffer);
    conn.emit('data', JSON.stringify({ t: 'done' }));

    const { status, file } = await result;
    expect(status).toBe(200);
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test('more bytes than offered are refused', async () => {
    setRtcOfferHandler(() => true);
    const { conn } = await receiverConn();
    conn.emit('data', JSON.stringify({ t: 'offer', size: 1, name: 'x' }));
    await flush();
    conn.emit('data', new Uint8Array([1, 2]).buffer);
    expect(JSON.parse(String(conn.sent[1]))).toMatchObject({ ok: false, status: 413 });
  });
});
