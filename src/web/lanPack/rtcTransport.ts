import Peer, { type DataConnection } from 'peerjs';
import { isLanPackRtcCode, randomLanPackRtcCode } from './hubUrl';

/** Pages 版 (静的ホスト) 用: PeerJS でシグナリングし、zip は WebRTC DataChannel で直接送る。 */
export const LAN_PACK_MAX_BYTES = 200 * 1024 * 1024;

const CHUNK_BYTES = 16 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const PEER_OPEN_TIMEOUT_MS = 6000;
const CONNECT_TIMEOUT_MS = 8000;
/** 受け側が確認ダイアログに答えるまでの猶予。 */
const ACCEPT_TIMEOUT_MS = 90_000;
const MINT_RETRIES = 12;
const NAME_MAX = 80;
/** STUN/TURN なし: 同じ LAN の host candidate でしかつながらない。 */
const LAN_ICE = { iceServers: [] as RTCIceServer[] };

const peerId = (code: string) => `mangasketcher-lan-${code}`;

/** 送り手 → 受け手: 送りたい作品。受け手は accept か ack(ok:false) で答える。 */
type Offer = { t: 'offer'; size: number; name: string };
type Accept = { t: 'accept' };
type Done = { t: 'done' };
type Ack = { t: 'ack'; ok: boolean; status?: number };
type Msg = Offer | Accept | Done | Ack;

export type LanPackOffer = { name: string; size: number };
type OfferHandler = (offer: LanPackOffer) => boolean | Promise<boolean>;

let offerHandler: OfferHandler | null = null;

/** 受け取り前の確認。未設定なら全部断る。 */
export function setRtcOfferHandler(handler: OfferHandler | null): void {
  offerHandler = handler;
}

type ReceiverState = {
  peer: Peer;
  code: string;
  queue: File[];
  waiters: Array<(f: File | null) => void>;
};

let receiver: ReceiverState | null = null;

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

function sendMsg(conn: DataConnection, msg: Msg): void {
  conn.send(JSON.stringify(msg));
}

function parseMsg(raw: unknown): Msg | null {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    const msg = JSON.parse(raw) as Msg;
    return msg && typeof msg.t === 'string' ? msg : null;
  } catch {
    return null;
  }
}

function toArrayBuffer(raw: unknown): ArrayBuffer | null {
  if (raw instanceof ArrayBuffer) {
    return raw;
  }
  if (ArrayBuffer.isView(raw)) {
    const copy = new Uint8Array(raw.byteLength);
    copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    return copy.buffer;
  }
  return null;
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

/** 1 接続 = 1 作品。確認で承諾されるまでバイナリは受け取らない。 */
function attachReceiver(conn: DataConnection, state: ReceiverState): void {
  let phase: 'offer' | 'asking' | 'data' | 'closed' = 'offer';
  let expected = 0;
  let got = 0;
  let parts: ArrayBuffer[] = [];
  const refuse = (status: number) => {
    phase = 'closed';
    parts = [];
    sendMsg(conn, { t: 'ack', ok: false, status });
    setTimeout(() => conn.close(), 500);
  };
  conn.on('data', (raw) => {
    if (phase === 'closed') {
      return;
    }
    const buf = toArrayBuffer(raw);
    if (buf) {
      if (phase !== 'data') {
        refuse(400);
        return;
      }
      got += buf.byteLength;
      if (got > expected) {
        refuse(413);
        return;
      }
      parts.push(buf);
      return;
    }
    const msg = parseMsg(raw);
    if (!msg) {
      return;
    }
    if (msg.t === 'offer' && phase === 'offer') {
      const size = Number(msg.size);
      if (!Number.isSafeInteger(size) || size <= 0) {
        refuse(400);
        return;
      }
      if (size > LAN_PACK_MAX_BYTES) {
        refuse(413);
        return;
      }
      const name = String(msg.name ?? '').slice(0, NAME_MAX);
      phase = 'asking';
      void Promise.resolve(offerHandler ? offerHandler({ name, size }) : false)
        .catch(() => false)
        .then((ok) => {
          if (phase !== 'asking') {
            return;
          }
          if (!ok || receiver !== state) {
            refuse(403);
            return;
          }
          expected = size;
          phase = 'data';
          sendMsg(conn, { t: 'accept' });
        });
      return;
    }
    if (msg.t === 'done' && phase === 'data') {
      if (got !== expected) {
        refuse(400);
        return;
      }
      const file = new File(parts, 'lan-pack.zip', { type: 'application/zip' });
      parts = [];
      phase = 'closed';
      sendMsg(conn, { t: 'ack', ok: true });
      const waiter = state.waiters.shift();
      if (waiter) {
        waiter(file);
      } else {
        state.queue.push(file);
      }
    }
  });
  conn.on('close', () => {
    phase = 'closed';
    parts = [];
  });
}

/** 受信側: 空いているコードで待受を登録する。 */
export async function mintRtcCode(): Promise<{ code: string }> {
  releaseRtcCode();
  for (let i = 0; i < MINT_RETRIES; i += 1) {
    const code = randomLanPackRtcCode();
    const peer = newPeer(peerId(code));
    try {
      await whenOpen(peer, PEER_OPEN_TIMEOUT_MS);
    } catch (err) {
      peer.destroy();
      if ((err as { type?: string }).type === 'unavailable-id') {
        continue;
      }
      throw new Error('mint');
    }
    const state: ReceiverState = { peer, code, queue: [], waiters: [] };
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

/** 受信側: zip が届くまで待つ。abort / 解放されたら 404 相当で返す。 */
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

/**
 * 送信側: 同コードの受信側へ直接接続し、承諾されたら zip を送る。
 * 戻り値は HTTP 版と同じステータス (403 = 断られた / 時間切れ)。
 */
export async function sendRtcZip(code: string, file: File, name: string, signal?: AbortSignal): Promise<number> {
  if (!isLanPackRtcCode(code)) {
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
    const inbox: Msg[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    conn.on('data', (raw) => {
      const msg = parseMsg(raw);
      if (msg) {
        inbox.push(msg);
        wake?.();
      }
    });
    conn.once('close', () => {
      closed = true;
      wake?.();
    });
    const nextMsg = async (timeoutMs: number): Promise<Msg | null> => {
      const deadline = Date.now() + timeoutMs;
      while (inbox.length === 0 && !closed && !signal?.aborted && Date.now() < deadline) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 250);
        });
        wake = null;
      }
      return inbox.shift() ?? null;
    };

    sendMsg(conn, { t: 'offer', size: file.size, name: name.slice(0, NAME_MAX) });
    const answer = await nextMsg(ACCEPT_TIMEOUT_MS);
    if (signal?.aborted) {
      conn.close();
      return 0;
    }
    if (!answer || answer.t !== 'accept') {
      conn.close();
      return answer?.t === 'ack' ? (answer.status ?? 403) : 403;
    }
    // serialization: 'raw' は文字列/バッファのみ通すため、制御メッセージは JSON 文字列で送る
    const dc = (conn as DataConnection & { dataChannel: RTCDataChannel }).dataChannel;
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (signal?.aborted || closed) {
        conn.close();
        return signal?.aborted ? 0 : 502;
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
    sendMsg(conn, { t: 'done' });
    const ack = await nextMsg(ACCEPT_TIMEOUT_MS);
    conn.close();
    if (ack?.t === 'ack') {
      return ack.ok ? 204 : (ack.status ?? 502);
    }
    return 502;
  } catch (err) {
    if ((err as { type?: string }).type === 'peer-unavailable') {
      return 404;
    }
    return 502;
  } finally {
    peer.destroy();
  }
}
