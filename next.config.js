/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
    // Single build worker — the production server has 1GB RAM and parallel
    // page prerendering OOMs it. Harmless on bigger machines, just slower.
    cpus: 1,
  },
  // The 1GB server prerenders slowly under swap pressure; the default 60s
  // per-page timeout is too strict there.
  staticPageGenerationTimeout: 300,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Blocks the app from being embedded in an iframe (clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stops browsers guessing content types (MIME sniffing)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Never leak internal URLs (which contain lead ids) to other sites
          { key: 'Referrer-Policy', value: 'same-origin' },
          // The app never needs these browser capabilities
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
