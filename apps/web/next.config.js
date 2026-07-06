/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_PROXY_ORIGIN || 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      // Discord OAuth redirect is registered as http://localhost:3000/callback.
      // Proxy it to the API's OAuth callback handler so everything stays on :3000.
      { source: '/auth/:path*', destination: `${API_ORIGIN}/auth/:path*` },
      { source: '/callback', destination: `${API_ORIGIN}/auth/discord/callback` },
    ];
  },
};

module.exports = nextConfig;
