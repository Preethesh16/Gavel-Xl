import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@gavel-xi/shared'],
  poweredByHeader: false,
};

export default nextConfig;
