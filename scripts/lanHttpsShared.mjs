import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const MKCERT_URL =
  'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe';

export const HTTPS_PORT = 3443;
export const CA_PORT = 3002;
export const DEV_HTTPS_PORT = 3000;

export function certPaths(root) {
  const certDir = join(root, 'certs');
  const caDir = join(certDir, 'ca');
  return {
    certDir,
    caDir,
    mkcertPath: join(certDir, 'mkcert.exe'),
    certFile: join(certDir, 'lan.pem'),
    keyFile: join(certDir, 'lan-key.pem'),
    caPem: join(caDir, 'rootCA.pem'),
  };
}

export function lanIPv4Entries() {
  const seen = new Set();
  const entries = [];
  const nets = networkInterfaces();
  for (const [name, list] of Object.entries(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) {
        continue;
      }
      if (net.address.startsWith('169.254.') || seen.has(net.address)) {
        continue;
      }
      seen.add(net.address);
      entries.push({ address: net.address, iface: name });
    }
  }
  return entries;
}

export function lanIPv4s() {
  return lanIPv4Entries().map((item) => item.address);
}

export function lanIPv4() {
  const ips = lanIPv4s();
  return ips.find((ip) => ip.startsWith('192.168.')) ?? ips[0] ?? '192.168.0.2';
}

export async function ensureMkcert(root) {
  const { certDir, mkcertPath } = certPaths(root);
  if (existsSync(mkcertPath)) {
    return;
  }
  mkdirSync(certDir, { recursive: true });
  const res = await fetch(MKCERT_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`mkcert download failed: ${res.status}`);
  }
  await pipeline(res.body, createWriteStream(mkcertPath));
}

export function runMkcert(root, args) {
  const { mkcertPath, caDir } = certPaths(root);
  const result = spawnSync(mkcertPath, args, {
    cwd: root,
    env: { ...process.env, CAROOT: caDir },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `mkcert ${args.join(' ')} failed`);
  }
}

/** Issue (or refresh) the LAN leaf for current IPv4s + localhost. Does not recreate the CA. */
export async function ensureLanLeaf(root) {
  const { caDir, caPem, certFile, keyFile } = certPaths(root);
  mkdirSync(caDir, { recursive: true });
  await ensureMkcert(root);
  if (!existsSync(caPem)) {
    try {
      runMkcert(root, ['-install']);
    } catch {
      // iPad trusts via mobileconfig from start:https-lan.
    }
  }
  const ip = lanIPv4();
  const extraIps = lanIPv4s().filter((item) => item !== ip);
  runMkcert(root, ['-cert-file', certFile, '-key-file', keyFile, ip, ...extraIps, '127.0.0.1', 'localhost']);
  return { ip, ips: lanIPv4s(), certFile, keyFile };
}
