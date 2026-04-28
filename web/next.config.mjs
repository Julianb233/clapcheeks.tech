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
        source: '/settings/ai',
        destination: '/settings',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
