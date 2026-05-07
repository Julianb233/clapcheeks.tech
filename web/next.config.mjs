import withPWA from "@ducanh2912/next-pwa"

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
    //   /dashboard/roster   -> /leads    (canonical Pipeline)
    //   /settings/ai        -> /settings (Persona/Drip/Reports/Calendar/Approval tabs)
    // The page-level redirects in app/(main)/dashboard/{matches,roster}/page.tsx
    // and app/(main)/settings/ai/page.tsx are belt + suspenders alongside these.
    return [
      {
        source: '/dashboard/matches',
        destination: '/matches',
        permanent: false,
      },
      {
        source: '/dashboard/roster',
        destination: '/leads',
        permanent: false,
      },
      {
        // AI-8926: sidebar label is "Pipeline" but the route is /leads.
        // Anyone typing /pipeline directly used to get a 404.
        source: '/pipeline',
        destination: '/leads',
        permanent: false,
      },
      {
        source: '/settings/ai',
        destination: '/settings',
        permanent: false,
      },
    ]
  },
}

// AI-9500 W7: Enable PWA via @ducanh2912/next-pwa so the service worker is
// generated on every build with fresh content hashes. Offline-first for
// navigation; network-first for everything else. Defensive — disables in dev.
export default withPWA({
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
