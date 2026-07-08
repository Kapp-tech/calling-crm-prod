/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
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
