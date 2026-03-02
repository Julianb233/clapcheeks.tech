import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Clapcheeks — AI Dating Co-Pilot',
  description:
    'Your unfair advantage. AI-powered dating automation across 10 platforms — personalized openers, NLP conversation analysis, automatic date booking.',
  keywords: [
    'AI dating assistant',
    'dating app automation',
    'Tinder automation',
    'Bumble AI',
    'Hinge AI',
    'dating analytics',
    'dating co-pilot',
    'Grindr automation',
    'auto swipe',
  ],
  manifest: '/manifest.json',
  openGraph: {
    title: 'Clapcheeks — AI Dating Co-Pilot',
    description: 'Your unfair advantage. AI-powered dating automation across 10 platforms.',
    url: 'https://clapcheeks.tech',
    siteName: 'Clapcheeks',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clapcheeks — AI Dating Co-Pilot',
    description: 'Your unfair advantage. AI-powered dating automation across 10 platforms.',
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
    <html lang="en" className="scroll-smooth">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
