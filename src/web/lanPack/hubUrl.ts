export const LAN_PACK_HUB_DOWN_MESSAGE =
  'LAN転送には PC版の起動（ポート3443）が必要です。';

export const LAN_PACK_PDF_NOTICE =
  '参照PDFは含まれません。送り先で付け直してください。相手の一覧には複製として追加されます。';

export const LAN_PACK_KEEP_FOREGROUND = 'この画面を前面のままにしてください。';

export const LAN_PACK_SENT = '送りました。受け側の一覧に複製が追加されます。';

export const LAN_PACK_BAD_CODE = '番号が違います。受け側の番号を確認してください。';

export const LAN_PACK_TOO_LARGE = 'サイズが上限（200MB）を超えています。';

const HUB_PORT = '3443';

export const LAN_PACK_CODE_DIGITS = 3;

export function isLanPackCode(value: string): boolean {
  return new RegExp(`^[0-9]{${LAN_PACK_CODE_DIGITS}}$`).test(value);
}

export function normalizeLanPackDigits(raw: string): string {
  const halfWidth = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return halfWidth.replace(/\D/g, '').slice(0, LAN_PACK_CODE_DIGITS);
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
