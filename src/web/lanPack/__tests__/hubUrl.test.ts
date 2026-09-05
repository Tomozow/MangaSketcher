import { describe, expect, test } from 'vitest';
import {
  isLanPackCode,
  lanPackApiUrl,
  lanPackOriginKind,
  normalizeLanPackDigits,
  resolveLanPackHubBase,
} from '../hubUrl';

describe('lan pack hub URL', () => {
  test('same origin on 3443 uses relative API', () => {
    expect(
      resolveLanPackHubBase({ protocol: 'https:', hostname: '192.168.0.2', port: '3443' }),
    ).toBe('');
    expect(lanPackApiUrl('', '/api/lan-pack/health')).toBe('/api/lan-pack/health');
  });

  test('dev :3000 points at same hostname :3443', () => {
    expect(
      resolveLanPackHubBase({ protocol: 'https:', hostname: '127.0.0.1', port: '3000' }),
    ).toBe('https://127.0.0.1:3443');
    expect(
      resolveLanPackHubBase({ protocol: 'https:', hostname: '192.168.0.8', port: '3000' }),
    ).toBe('https://192.168.0.8:3443');
  });

  test('static :3001 uses same-origin API (PC HTTP; no fetch to :3443 cert)', () => {
    expect(
      resolveLanPackHubBase({ protocol: 'http:', hostname: '127.0.0.1', port: '3001' }),
    ).toBe('');
    expect(
      resolveLanPackHubBase({ protocol: 'http:', hostname: 'localhost', port: '3001' }),
    ).toBe('');
  });

  test('unknown origins have no hub', () => {
    expect(
      resolveLanPackHubBase({ protocol: 'https:', hostname: 'example.com', port: '443' }),
    ).toBeNull();
  });
});

describe('lan pack codes and CORS kinds', () => {
  const ips = ['192.168.0.2', '10.0.0.4'];

  test('three digit codes only', () => {
    expect(isLanPackCode('000')).toBe(true);
    expect(isLanPackCode('123')).toBe(true);
    expect(isLanPackCode('12')).toBe(false);
    expect(isLanPackCode('1234')).toBe(false);
    expect(isLanPackCode('12a')).toBe(false);
  });

  test('normalizes fullwidth digits and strips other glyphs', () => {
    expect(normalizeLanPackDigits('１２３')).toBe('123');
    expect(normalizeLanPackDigits('12a45')).toBe('124');
    expect(normalizeLanPackDigits('1234')).toBe('123');
  });

  test('allows PC origins and hub origins', () => {
    expect(lanPackOriginKind('https://127.0.0.1:3000', ips)).toBe('pc');
    expect(lanPackOriginKind('https://localhost:3000', ips)).toBe('pc');
    expect(lanPackOriginKind('https://192.168.0.2:3000', ips)).toBe('pc');
    expect(lanPackOriginKind('http://127.0.0.1:3001', ips)).toBe('pc');
    expect(lanPackOriginKind('https://10.0.0.4:3443', ips)).toBe('hub');
    expect(lanPackOriginKind(null, ips)).toBe('hub');
  });

  test('rejects unknown origins', () => {
    expect(lanPackOriginKind('https://evil.example:3000', ips)).toBe('reject');
    expect(lanPackOriginKind('http://192.168.0.2:3001', ips)).toBe('reject');
    expect(lanPackOriginKind('https://192.168.0.2:3001', ips)).toBe('reject');
  });
});
