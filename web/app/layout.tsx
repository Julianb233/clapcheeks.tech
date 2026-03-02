import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Outward — Your AI Dating Co-Pilot',
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
    title: 'Outward — Your AI Dating Co-Pilot',
    description: 'AI-powered dating assistant that runs locally on your Mac.',
    url: 'https://clapcheeks.tech',
    siteName: 'Outward',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Outward — Your AI Dating Co-Pilot',
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
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
