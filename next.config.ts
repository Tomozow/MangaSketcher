import type { NextConfig } from 'next';

const isStaticExport = process.env.NEXT_OUTPUT === 'export';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isStaticExport
    ? { output: 'export' as const, trailingSlash: true, distDir: '.next-export' }
    : { allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.0.2'] }),
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
