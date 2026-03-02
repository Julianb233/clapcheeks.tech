import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Clap Cheeks — Your AI Dating Co-Pilot',
  description:
    'AI-powered dating assistant. Automate swipes, manage conversations, track analytics, and get coaching — all running privately on your Mac.',
  keywords: [
    'dating app automation',
    'AI dating assistant',
    'Tinder automation',
    'Bumble AI',
    'dating analytics',
    'iMessage AI',
    'dating co-pilot',
  ],
  openGraph: {
    title: 'Clap Cheeks — Your AI Dating Co-Pilot',
    description: 'AI-powered dating assistant that runs locally on your Mac.',
    url: 'https://clapcheeks.tech',
    siteName: 'Clap Cheeks',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clap Cheeks — Your AI Dating Co-Pilot',
    description: 'AI-powered dating assistant that runs locally on your Mac.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.variable} antialiased bg-black text-white`}>
        {children}
      </body>
    </html>
  )
}
