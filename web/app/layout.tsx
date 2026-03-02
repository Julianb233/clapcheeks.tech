import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Outward — AI Dating Co-Pilot',
  description:
    'The privacy-first AI dating assistant. Automate swipes, manage conversations in your voice, track analytics, and get coaching — all running locally on your Mac.',
  keywords: [
    'AI dating assistant',
    'dating app automation',
    'Tinder automation',
    'Bumble AI',
    'Hinge AI',
    'dating analytics',
    'iMessage AI dating',
    'dating co-pilot',
  ],
  openGraph: {
    title: 'Outward — AI Dating Co-Pilot',
    description: 'Privacy-first AI dating assistant that runs locally on your Mac.',
    url: 'https://clapcheeks.tech',
    siteName: 'Outward',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Outward — AI Dating Co-Pilot',
    description: 'Privacy-first AI dating assistant that runs locally on your Mac.',
  },
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
