import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

const isStaticExport = process.env.NEXT_OUTPUT === 'export';

function lanDevOrigins(): string[] {
  const hosts = ['127.0.0.1', 'localhost'];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) {
        continue;
      }
      hosts.push(net.address);
    }
  }
  return [...new Set(hosts)];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isStaticExport
    ? { output: 'export' as const, trailingSlash: true, distDir: '.next-export' }
    : { allowedDevOrigins: lanDevOrigins() }),
  serverExternalPackages: ['pdfjs-dist', 'fflate'],
  turbopack: {
    resolveAlias: {
      fflate: 'fflate/browser',
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
      fflate: 'fflate/browser',
    };
    if (!isServer) {
      config.output.globalObject = 'self';
    }
    return config;
  },
  typescript: {
    // Pre-existing src/web type errors must not block Next boot or static export.
    ignoreBuildErrors: true,
    tsconfigPath: './tsconfig.next.json',
  },
};

export default nextConfig;
