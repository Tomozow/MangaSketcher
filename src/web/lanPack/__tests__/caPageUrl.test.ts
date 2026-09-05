import { describe, expect, test, vi } from 'vitest';
import { pickLanIPv4 } from '../lanIpv4';
import {
  caPageUrlForLanIp,
  caPageUrlFromHostname,
  loadCaPageUrl,
  parseCaPageUrlPayload,
} from '../caPageUrl';

describe('ca page URL', () => {
  test('builds http :3002 for a LAN ip', () => {
    expect(caPageUrlForLanIp('192.168.0.2')).toBe('http://192.168.0.2:3002/');
  });

  test('uses the page hostname when it is a LAN IPv4', () => {
    expect(caPageUrlFromHostname('10.0.0.4')).toBe('http://10.0.0.4:3002/');
    expect(caPageUrlFromHostname('127.0.0.1')).toBeNull();
    expect(caPageUrlFromHostname('localhost')).toBeNull();
    expect(caPageUrlFromHostname('example.local')).toBeNull();
  });

  test('prefers 192.168 when picking among NICs', () => {
    expect(pickLanIPv4(['10.0.0.4', '192.168.0.8'])).toBe('192.168.0.8');
    expect(pickLanIPv4([])).toBeNull();
  });

  test('rejects payloads that are not the CA page', () => {
    expect(parseCaPageUrlPayload({ caPageUrl: 'http://192.168.0.2:3002/' })).toBe(
      'http://192.168.0.2:3002/',
    );
    expect(parseCaPageUrlPayload({ caPageUrl: 'https://192.168.0.2:3443/' })).toBeNull();
    expect(parseCaPageUrlPayload({})).toBeNull();
  });

  test('loadCaPageUrl prefers hostname then /api/lan-setup', async () => {
    expect(await loadCaPageUrl({ hostname: '192.168.0.2' })).toBe('http://192.168.0.2:3002/');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ caPageUrl: 'http://192.168.0.8:3002/' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadCaPageUrl({ hostname: '127.0.0.1' })).toBe('http://192.168.0.8:3002/');
    expect(fetchMock).toHaveBeenCalledWith('/api/lan-setup', { cache: 'no-store' });
    vi.unstubAllGlobals();
  });
});
