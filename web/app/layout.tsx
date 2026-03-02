import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Outward — AI Dating Co-Pilot',
  description:
    'Your unfair advantage. AI that automates your dating apps — swipes, messages, and dates booked on autopilot. Privacy-first, runs locally on your Mac.',
  keywords: [
    'AI dating assistant',
    'dating app automation',
    'Tinder automation',
    'Bumble AI',
    'Hinge AI',
    'dating analytics',
    'dating co-pilot',
    'auto swipe',
    'dating AI',
  ],
  manifest: '/manifest.json',
  openGraph: {
    title: 'Outward — AI Dating Co-Pilot',
    description: 'AI that automates your dating apps. Swipes, messages, and dates — all on autopilot.',
    url: 'https://clapcheeks.tech',
    siteName: 'Outward',
    type: 'website',
    images: [{ url: 'https://clapcheeks.tech/og-image.png', width: 1200, height: 630, alt: 'Outward — AI Dating Co-Pilot' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Outward — AI Dating Co-Pilot',
    description: 'AI that automates your dating apps. Swipes, messages, and dates — all on autopilot.',
    images: ['https://clapcheeks.tech/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black',
  },
  other: {
    'theme-color': '#000000',
  },
  robots: { index: true, follow: true },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className="font-sans antialiased bg-black text-white">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
