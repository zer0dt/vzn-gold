import path from 'path';
import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

const supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;

/** @type {(phase: string, defaultConfig: NextConfig) => Promise<NextConfig>} */
const nextConfig = async (phase: string, defaultConfig: NextConfig = {}): Promise<NextConfig> => {
  console.log('nextConfig', phase);
  /** @type {NextConfig} */
  const baseConfig: NextConfig = {
    typescript: {
      ignoreBuildErrors: true,
    },
    // Silence workspace-root inference warning by explicitly setting the tracing root
    outputFileTracingRoot: path.resolve(__dirname),
    
    images: {
      remotePatterns: [
        {
          hostname: 'a.impactradius-go.com',
        },
        {
          hostname: 'pbs.twimg.com',
        },
        {
          hostname: 'abs.twimg.com',
        },
        ...(supabaseHostname
          ? [
              {
                hostname: supabaseHostname,
              },
            ]
          : []),
      ],
    },
    devIndicators: false,
    turbopack: {
      resolveAlias: {
        'scrypt-ts': './app/lib/scrypt-ts-facade.ts',
        'scrypt-ord': './app/lib/scrypt-ord-facade.ts',
        'scrypt-ts-lib': './app/lib/empty-node-module.ts',
        fs: './app/lib/empty-node-module.ts',
        os: './app/lib/empty-node-module.ts',
        path: './app/lib/empty-node-module.ts',
        module: './app/lib/empty-node-module.ts',
      },
    },
  };

  return withBundleAnalyzer(baseConfig);
};

export default nextConfig;
