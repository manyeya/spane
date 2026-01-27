import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  basePath: '/spane',
  assetPrefix: '/spane',
  // Redirect root to basePath for direct domain access
  async redirects() {
    return [
      {
        source: '/',
        destination: '/spane/',
        permanent: false,
      },
    ];
  },
};

export default withMDX(config);
