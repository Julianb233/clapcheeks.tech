import withPWA from "@ducanh2912/next-pwa"
import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Sidebar IA consolidation 2026-04-27 (sidebar-audit Fix C + D).
    //   /dashboard/matches  -> /matches  (canonical match list)
    //   /dashboard/roster and /settings/ai remain live compatibility pages
    //   because production QA and older dashboard links exercise their richer
    //   roster/settings controls directly.
    return [
      {
        source: '/dashboard/matches',
        destination: '/matches',
        permanent: false,
      },
      {
        // AI-8926: sidebar label is "Pipeline" but the route is /leads.
        // Anyone typing /pipeline directly used to get a 404.
        source: '/pipeline',
        destination: '/leads',
        permanent: false,
      },
    ]
  },
}

// AI-9500 W7: Enable PWA via @ducanh2912/next-pwa so the service worker is
// generated on every build with fresh content hashes. Offline-first for
// navigation; network-first for everything else. Defensive — disables in dev.
const pwaConfig = withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  reloadOnOnline: false,
  fallbacks: {
    // Serve the ops overview as offline fallback for admin nav requests
    document: "/admin/clapcheeks-ops",
  },
  workboxOptions: {
    // Don't precache Convex/Supabase API calls — always need fresh data
    exclude: [/^https:\/\/.*\.convex\.cloud/, /^https:\/\/.*\.supabase\.co/],
    runtimeCaching: [
      {
        // Navigation: network-first, cache as fallback
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "cc-pages",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 86400 },
        },
      },
      {
        // Next.js static assets (content-addressed): cache-first forever
        urlPattern: /\/_next\/static\/.+/,
        handler: "CacheFirst",
        options: {
          cacheName: "cc-static",
          expiration: { maxEntries: 256, maxAgeSeconds: 365 * 24 * 3600 },
        },
      },
      {
        // Icons, fonts, images
        urlPattern: /\.(?:png|svg|ico|woff2?|jpg|jpeg|webp)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "cc-assets",
          expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 3600 },
        },
      },
    ],
  },
})(nextConfig)

// AI-8333 Phase 34 (Closed Alpha): wrap the final config with Sentry so
// production builds upload source maps (readable stack traces during the
// alpha) and route Sentry events through a same-origin tunnel that ad
// blockers won't drop. Build-time upload is a no-op unless SENTRY_AUTH_TOKEN
// + org/project are present in the CI/Vercel env, so local/dev builds are
// unaffected.
export default withSentryConfig(pwaConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Serve Sentry requests through /monitoring to dodge ad blockers.
  tunnelRoute: "/monitoring",
  // Tree-shake Sentry logger statements out of the client bundle.
  disableLogger: true,
  // Only attempt source-map upload when we actually have an auth token.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  widenClientFileUpload: true,
})
