import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Clapcheeks — AI Dating Co-Pilot',
    short_name: 'Clapcheeks',
    description:
      'Your private dating CRM. Roster, voice-aware reply drafting, and pre-date briefs.',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#0a0a0a',
    scope: '/',
    categories: ['lifestyle', 'productivity', 'social'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  }
}
