const BRAND_FILES = ['/icon.webp', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/logo.svg'];

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/robots.txt', destination: '/api/robots' },
        { source: '/sitemap.xml', destination: '/api/sitemap' },
        { source: '/media/:id', destination: '/api/media/:id' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return BRAND_FILES.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] }));
  },
};
