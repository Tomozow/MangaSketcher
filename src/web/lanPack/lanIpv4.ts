import { networkInterfaces } from 'node:os';

export function pickLanIPv4(ips: readonly string[]): string | null {
  return ips.find((item) => item.startsWith('192.168.')) ?? ips[0] ?? null;
}

export function lanIPv4s(): string[] {
  const seen = new Set<string>();
  const ips: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) {
        continue;
      }
      if (seen.has(net.address)) {
        continue;
      }
      seen.add(net.address);
      ips.push(net.address);
    }
  }
  return ips;
}

export function primaryLanIPv4(): string | null {
  return pickLanIPv4(lanIPv4s());
}
