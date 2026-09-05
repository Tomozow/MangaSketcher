import { isLoopbackHost } from '@/src/web/displayMode';

export const CA_PORT = '3002';

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function caPageUrlForLanIp(ip: string): string {
  return `http://${ip}:${CA_PORT}/`;
}

export function caPageUrlFromHostname(hostname: string): string | null {
  if (isLoopbackHost(hostname) || !IPV4.test(hostname)) {
    return null;
  }
  return caPageUrlForLanIp(hostname);
}

export function parseCaPageUrlPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('caPageUrl' in data)) {
    return null;
  }
  const url = data.caPageUrl;
  if (typeof url !== 'string' || !url.startsWith('http://') || !url.endsWith(`:${CA_PORT}/`)) {
    return null;
  }
  return url;
}

export async function loadCaPageUrl(location: { hostname: string }): Promise<string | null> {
  const fromHost = caPageUrlFromHostname(location.hostname);
  if (fromHost) {
    return fromHost;
  }
  try {
    const response = await fetch('/api/lan-setup', { cache: 'no-store' });
    if (response.ok) {
      const parsed = parseCaPageUrlPayload(await response.json());
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // static :3001 has no Next route
  }
  if (!isLoopbackHost(location.hostname)) {
    return null;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${CA_PORT}/setup.json`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return parseCaPageUrlPayload(await response.json());
  } catch {
    return null;
  }
}
