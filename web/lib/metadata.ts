import type { Metadata } from 'next'

const SITE_NAME = 'Clapcheeks'
const SITE_URL = 'https://clapcheeks.tech'
const DEFAULT_DESCRIPTION = 'Your AI dating co-pilot. Automate smarter, not harder. Runs on your Mac.'
const OG_IMAGE = `${SITE_URL}/og-image.png`

export function createMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      siteName: SITE_NAME,
      type: 'website',
      images: [{ url: OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
    },
    ...overrides,
  }
}
