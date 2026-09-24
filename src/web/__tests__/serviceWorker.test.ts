import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  isAppleTouchDevice,
  isGitHubPagesApp,
  isLoopbackHost,
  isStandaloneDisplay,
  shouldShowIpadCaQr,
} from '../displayMode';

const here = dirname(fileURLToPath(import.meta.url));
const swSrc = readFileSync(join(here, '../../../public/sw.js'), 'utf8');
const layoutSrc = readFileSync(join(here, '../../../app/layout.tsx'), 'utf8');
const registrarSrc = readFileSync(join(here, '../ServiceWorkerRegistrar.tsx'), 'utf8');

describe('offline home-screen shell', () => {
  test('iPad Safari is an Apple touch device; desktop Mac is not', () => {
    expect(isAppleTouchDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isAppleTouchDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isAppleTouchDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isAppleTouchDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false);
  });

  test('standalone is true for home-screen web app, false for Safari tab', () => {
    expect(isStandaloneDisplay({ standalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeFullscreen: true })).toBe(true);
    expect(isStandaloneDisplay({})).toBe(false);
  });

  test('iPad CA QR shows on loopback PC even in Chrome app standalone', () => {
    expect(
      shouldShowIpadCaQr({ hostname: '127.0.0.1', standalone: true, appleTouch: false }),
    ).toBe(true);
    expect(
      shouldShowIpadCaQr({ hostname: 'localhost', standalone: true, appleTouch: false }),
    ).toBe(true);
    expect(
      shouldShowIpadCaQr({ hostname: '192.168.0.2', standalone: true, appleTouch: true }),
    ).toBe(false);
    expect(
      shouldShowIpadCaQr({ hostname: '192.168.0.2', standalone: false, appleTouch: false }),
    ).toBe(true);
    expect(
      shouldShowIpadCaQr({ hostname: 'tomozow.github.io', standalone: false, appleTouch: false }),
    ).toBe(false);
    const previous = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = '/MangaSketcher';
    expect(isGitHubPagesApp()).toBe(true);
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = previous;
    }
  });

  test('sw.js precaches the shell and does not unregister itself', () => {
    expect(swSrc).toContain("caches.open(SHELL_CACHE)");
    expect(swSrc).toContain('/precache-manifest.json');
    expect(swSrc).toContain('/page_template.jpg');
    expect(swSrc).toContain('/pdf.worker.min.mjs');
    expect(swSrc).toMatch(/addEventListener\('fetch'/);
    expect(swSrc).not.toMatch(/registration\s*\n\s*\.unregister\(/);
    expect(swSrc).not.toContain('self.registration.unregister');
  });

  test('navigation is cache-first with a short network timeout', () => {
    expect(swSrc).toContain('function fetchWithTimeout');
    expect(swSrc).toContain('NETWORK_TIMEOUT_MS = 4000');
    expect(swSrc).toContain('event.respondWith(respondProjectNavigation(url, keys))');
    expect(swSrc).toContain('respondProjectNavigation');
    expect(swSrc).toContain('response.redirected');
    expect(swSrc).toContain("url.pathname === withBase('/sw.js')");
    expect(swSrc).toContain("url.pathname === withBase('/precache-manifest.json')");
    expect(swSrc).toContain("event.data.type === 'SKIP_WAITING'");
    expect(swSrc).not.toMatch(/fetch\(request\)\s*\n\s*\.then\(\(response\) =>/);
  });

  test('layout does not unregister service workers on every page load', () => {
    expect(layoutSrc).not.toContain('x.unregister()');
    expect(layoutSrc).not.toContain('getRegistrations()');
    expect(layoutSrc).toContain('MARK_STANDALONE_SCRIPT');
  });

  test('iOS Safari tabs skip registration; standalone registers', () => {
    expect(registrarSrc).toContain('readAppleTouchDevice() && !readStandaloneDisplay()');
    expect(registrarSrc).toContain("register(publicUrl('/sw.js')");
    expect(registrarSrc).toContain('restoreShellUpdateSession');
    expect(registrarSrc).toContain('runShellStartup');
    expect(registrarSrc).toContain('probeShellServer');
    expect(registrarSrc).toContain('isLoopbackHost(window.location.hostname)');
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('192.168.0.2')).toBe(false);
  });
});
