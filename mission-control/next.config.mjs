/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compress: true,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
  async rewrites() {
    return [
      {
        source: '/gw/:path*',
        destination: 'http://127.0.0.1:18789/:path*',
      },
    ]
  },
}

export default nextConfig
