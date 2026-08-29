import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.0.2'],
  serverExternalPackages: ['pdfjs-dist'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
  typescript: {
    // Gate 2 owns src/domain type fixes; Next boot should not block on legacy RN types.
    tsconfigPath: './tsconfig.next.json',
  },
};

export default nextConfig;
