/** @type {import('next').NextConfig} */
const nextConfig = {
  // Azure Static Web Apps serves the exported files from /out; all server work
  // lives in the Azure Functions app under /api.
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@tda/shared'],
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? '/api',
  },
};

export default nextConfig;
