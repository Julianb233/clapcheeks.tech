import type { Metadata } from 'next'
import { Bebas_Neue, DM_Sans, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import PWAProvider from '@/components/pwa/pwa-provider'
import PostHogProvider from '@/components/providers/posthog-provider'
import './globals.css'
import './landing.css'

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Clapcheeks — AI Dating Co-Pilot',
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
    title: 'Clapcheeks — AI Dating Co-Pilot',
    description: 'AI that automates your dating apps. Swipes, messages, and dates — all on autopilot.',
    url: 'https://clapcheeks.tech',
    siteName: 'Clapcheeks',
    type: 'website',
    images: [{ url: 'https://clapcheeks.tech/og-image.png', width: 1200, height: 630, alt: 'Clapcheeks — AI Dating Co-Pilot' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clapcheeks — AI Dating Co-Pilot',
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
    <html lang="en" className={`dark scroll-smooth ${bebasNeue.variable} ${dmSans.variable}`}>
      <body className="font-body antialiased bg-black text-white">
        {children}
        <PWAProvider />
        <PostHogProvider />
        <Analytics />
      </body>
    </html>
  )
}
