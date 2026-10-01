import Peer, { type DataConnection } from 'peerjs';
import { LAN_PACK_CODE_DIGITS, isLanPackCode, padLanPackCode } from './hubUrl';

/** Pages 版 (静的ホスト) 用: PeerJS でシグナリングし、zip は WebRTC DataChannel で直接送る。 */
export const LAN_PACK_MAX_BYTES = 200 * 1024 * 1024;

const CHUNK_BYTES = 16 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const PEER_OPEN_TIMEOUT_MS = 6000;
const CONNECT_TIMEOUT_MS = 8000;
const MINT_RETRIES = 12;
const LAN_ICE = { iceServers: [] as RTCIceServer[] };

const peerId = (code: string) => `mangasketcher-lan-${code}`;

type Meta = { t: 'meta'; size: number };
type Done = { t: 'done' };
type Ack = { t: 'ack'; ok: boolean; status?: number };

let receiver: { peer: Peer; code: string; queue: File[]; waiters: Array<(f: File | null) => void> } | null =
  null;

function newPeer(id?: string): Peer {
  return id
    ? new Peer(id, { config: LAN_ICE, debug: 0 })
    : new Peer({ config: LAN_ICE, debug: 0 });
}

function whenOpen(peer: Peer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('peer-timeout')), timeoutMs);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function probeRtc(): Promise<boolean> {
  if (typeof RTCPeerConnection === 'undefined') {
    return false;
  }
  const peer = newPeer();
  try {
    await whenOpen(peer, PEER_OPEN_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  } finally {
    peer.destroy();
  }
}

function sendAck(conn: DataConnection, ack: Ack): void {
  conn.send(JSON.stringify(ack));
}

function attachReceiver(conn: DataConnection, state: NonNullable<typeof receiver>): void {
  let expected = 0;
  let got = 0;
  let parts: ArrayBuffer[] = [];
  conn.on('data', (raw) => {
    if (raw instanceof ArrayBuffer) {
      got += raw.byteLength;
      if (got > LAN_PACK_MAX_BYTES) {
        sendAck(conn, { t: 'ack', ok: false, status: 413 });
        parts = [];
        return;
      }
      parts.push(raw);
      return;
    }
    if (ArrayBuffer.isView(raw)) {
      const v = raw as ArrayBufferView;
      const copy = new Uint8Array(v.byteLength);
      copy.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      got += copy.byteLength;
      if (got > LAN_PACK_MAX_BYTES) {
        sendAck(conn, { t: 'ack', ok: false, status: 413 });
        parts = [];
        return;
      }
      parts.push(copy.buffer);
      return;
    }
    let msg: Meta | Done;
    try {
      msg = JSON.parse(String(raw)) as Meta | Done;
    } catch {
      return;
    }
    if (msg.t === 'meta') {
      expected = msg.size;
      got = 0;
      parts = [];
    } else if (msg.t === 'done') {
      if (got !== expected || expected > LAN_PACK_MAX_BYTES) {
        sendAck(conn, { t: 'ack', ok: false, status: expected > LAN_PACK_MAX_BYTES ? 413 : 500 });
        return;
      }
      const file = new File(parts, 'lan-pack.zip', { type: 'application/zip' });
      parts = [];
      sendAck(conn, { t: 'ack', ok: true });
      const waiter = state.waiters.shift();
      if (waiter) {
        waiter(file);
      } else {
        state.queue.push(file);
      }
    }
  });
}

/** 受信側: 空いている3桁コードで待受を登録する。 */
export async function mintRtcCode(): Promise<{ code: string }> {
  releaseRtcCode();
  for (let i = 0; i < MINT_RETRIES; i += 1) {
    const code = padLanPackCode(Math.floor(Math.random() * 10 ** LAN_PACK_CODE_DIGITS));
    const peer = newPeer(peerId(code));
    try {
      await whenOpen(peer, PEER_OPEN_TIMEOUT_MS);
    } catch (err) {
      peer.destroy();
      const type = (err as { type?: string }).type;
      if (type === 'unavailable-id') {
        continue;
      }
      throw new Error('mint');
    }
    const state = { peer, code, queue: [] as File[], waiters: [] as Array<(f: File | null) => void> };
    peer.on('connection', (conn) => attachReceiver(conn, state));
    // 致命的エラー等で peer が閉じたら待受を解放し、受信ループに番号を取り直させる
    peer.on('close', () => {
      if (receiver === state) {
        releaseRtcCode();
      }
    });
    peer.on('disconnected', () => {
      // シグナリング切断時は再接続を試みる (登録IDを保つ)
      if (!peer.destroyed) {
        peer.reconnect();
      }
    });
    receiver = state;
    return { code };
  }
  throw new Error('mint');
}

export function releaseRtcCode(): void {
  if (!receiver) {
    return;
  }
  const { peer, waiters } = receiver;
  receiver = null;
  for (const w of waiters.splice(0)) {
    w(null);
  }
  peer.destroy();
}

/** 受信側: zip が届くまで待つ。abort されたら 404 相当で返す。 */
export function waitRtcZip(
  code: string,
  signal?: AbortSignal,
): Promise<{ status: number; file: File | null }> {
  return new Promise((resolve) => {
    const state = receiver;
    if (!state || state.code !== code || state.peer.destroyed) {
      resolve({ status: 404, file: null });
      return;
    }
    const queued = state.queue.shift();
    if (queued) {
      resolve({ status: 200, file: queued });
      return;
    }
    const waiter = (file: File | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(file ? { status: 200, file } : { status: 404, file: null });
    };
    const onAbort = () => {
      const idx = state.waiters.indexOf(waiter);
      if (idx >= 0) {
        state.waiters.splice(idx, 1);
      }
      resolve({ status: 404, file: null });
    };
    signal?.addEventListener('abort', onAbort);
    state.waiters.push(waiter);
  });
}

/** 送信側: 同コードの受信側へ直接接続して zip を送る。戻り値は HTTP 版と同じステータス。 */
export async function sendRtcZip(code: string, file: File, signal?: AbortSignal): Promise<number> {
  if (!isLanPackCode(code)) {
    return 404;
  }
  if (file.size > LAN_PACK_MAX_BYTES) {
    return 413;
  }
  const peer = newPeer();
  try {
    await whenOpen(peer, PEER_OPEN_TIMEOUT_MS);
    const conn = peer.connect(peerId(code), { reliable: true, serialization: 'raw' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect-timeout')), CONNECT_TIMEOUT_MS);
      conn.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      conn.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      peer.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const ackPromise = new Promise<Ack>((resolve) => {
      conn.on('data', (raw) => {
        if (typeof raw !== 'string') {
          return;
        }
        try {
          const msg = JSON.parse(raw) as Ack;
          if (msg.t === 'ack') {
            resolve(msg);
          }
        } catch {
          // ignore
        }
      });
      conn.once('close', () => resolve({ t: 'ack', ok: false, status: 502 }));
    });
    // serialization: 'raw' は文字列/バッファのみ通すため、制御メッセージは JSON 文字列で送る
    const rawConn = conn as DataConnection & { dataChannel: RTCDataChannel };
    const dc = rawConn.dataChannel;
    dc.send(JSON.stringify({ t: 'meta', size: file.size } satisfies Meta));
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (signal?.aborted) {
        conn.close();
        return 0;
      }
      while (dc.bufferedAmount > BUFFER_HIGH) {
        await new Promise((r) => setTimeout(r, 20));
        if (signal?.aborted) {
          conn.close();
          return 0;
        }
      }
      dc.send(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    }
    dc.send(JSON.stringify({ t: 'done' } satisfies Done));
    const ack = await ackPromise;
    conn.close();
    if (ack.ok) {
      return 204;
    }
    return ack.status ?? 502;
  } catch (err) {
    const type = (err as { type?: string }).type;
    if (type === 'peer-unavailable') {
      return 404;
    }
    return 502;
  } finally {
    peer.destroy();
  }
}
