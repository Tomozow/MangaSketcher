export const LAN_PACK_HUB_DOWN_MESSAGE =
  'LAN転送には PC版の起動（ポート3443）が必要です。';

export const LAN_PACK_RTC_DOWN_MESSAGE =
  'LAN転送の接続準備に失敗しました。同じWi-Fiか、ネット接続を確認してください。';

export const LAN_PACK_DECLINED = '受け取られませんでした。相手の画面で「受け取る」を選んでもらってください。';

export const LAN_PACK_RECEIVE_MINUTES = 5;

export const LAN_PACK_PDF_NOTICE =
  '参照PDFは含まれません。送り先で付け直してください。相手の一覧には複製として追加されます。';

export const LAN_PACK_KEEP_FOREGROUND = 'この画面を前面のままにしてください。';

export const LAN_PACK_SENT = '送りました。受け側の一覧に複製が追加されます。';

export const LAN_PACK_BAD_CODE = '番号が違います。受け側の番号を確認してください。';

export const LAN_PACK_TOO_LARGE = 'サイズが上限（200MB）を超えています。';

const HUB_PORT = '3443';

/** Pages 版 (静的ホスト): ハブの代わりに WebRTC で端末間直結する印。 */
export const LAN_PACK_RTC_BASE = 'rtc:';

export function isLanPackRtcBase(hubBase: string | null): boolean {
  return hubBase === LAN_PACK_RTC_BASE;
}

function isPagesHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'github.io' || host.endsWith('.github.io');
}

export const LAN_PACK_CODE_DIGITS = 3;

export function isLanPackCode(value: string): boolean {
  return new RegExp(`^[0-9]{${LAN_PACK_CODE_DIGITS}}$`).test(value);
}

export function normalizeLanPackDigits(raw: string): string {
  const halfWidth = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return halfWidth.replace(/\D/g, '').slice(0, LAN_PACK_CODE_DIGITS);
}

/**
 * Pages 版の番号: 数字3桁 + 英字2文字 (I/O は除外)。PeerJS の名前空間は全利用者で共有なので、
 * 3桁 (1000通り) だと買い占め・誤送信が容易になる。
 */
const RTC_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const LAN_PACK_RTC_CODE_LENGTH = LAN_PACK_CODE_DIGITS + 2;

export function isLanPackRtcCode(value: string): boolean {
  return /^[0-9]{3}[A-HJ-NP-Z]{2}$/.test(value);
}

export function normalizeLanPackRtcCode(raw: string): string {
  const halfWidth = raw.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return halfWidth.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, LAN_PACK_RTC_CODE_LENGTH);
}

export function randomLanPackRtcCode(): string {
  const r = new Uint32Array(LAN_PACK_RTC_CODE_LENGTH);
  crypto.getRandomValues(r);
  let code = '';
  for (let i = 0; i < LAN_PACK_CODE_DIGITS; i += 1) {
    code += String(r[i] % 10);
  }
  for (let i = LAN_PACK_CODE_DIGITS; i < LAN_PACK_RTC_CODE_LENGTH; i += 1) {
    code += RTC_CODE_LETTERS[r[i] % RTC_CODE_LETTERS.length];
  }
  return code;
}

export function padLanPackCode(n: number): string {
  return String(n).padStart(LAN_PACK_CODE_DIGITS, '0');
}

export function resolveLanPackHubBase(location: {
  protocol: string;
  hostname: string;
  port: string;
}): string | null {
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  if (port === HUB_PORT && location.protocol === 'https:') {
    return '';
  }
  if (port === '3000' && location.protocol === 'https:') {
    return '';
  }
  if (port === '3001' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    return '';
  }
  if (isPagesHost(location.hostname)) {
    return LAN_PACK_RTC_BASE;
  }
  return null;
}

export function lanPackApiUrl(hubBase: string, path: string): string {
  if (!path.startsWith('/')) {
    throw new Error('path');
  }
  return `${hubBase}${path}`;
}

export type LanPackCorsKind = 'pc' | 'hub' | 'reject';

export function lanPackOriginKind(
  origin: string | null | undefined,
  lanIPv4s: readonly string[],
): LanPackCorsKind {
  if (!origin) {
    return 'hub';
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return 'reject';
  }
  const hosts = new Set(['127.0.0.1', 'localhost', ...lanIPv4s]);
  if (!hosts.has(url.hostname)) {
    return 'reject';
  }
  if (url.protocol === 'https:' && url.port === '3000') {
    return 'pc';
  }
  if (url.protocol === 'http:' && url.port === '3001' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
    return 'pc';
  }
  if (url.protocol === 'https:' && url.port === '3443') {
    return 'hub';
  }
  return 'reject';
}
