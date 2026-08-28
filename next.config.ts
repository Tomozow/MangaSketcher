import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // Gate 2 owns src/domain type fixes; Next boot should not block on legacy RN types.
    tsconfigPath: './tsconfig.next.json',
  },
};

export default nextConfig;
