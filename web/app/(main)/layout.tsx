import type { Metadata } from 'next'
import Navbar from '@/components/layout/navbar'
import Footer from '@/components/layout/footer'
import PageOrbs from '@/components/page-orbs'

export const metadata: Metadata = {
  title: {
    template: '%s | Clapcheeks',
    default: 'Clapcheeks',
  },
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageOrbs subtle />
      <div className="relative" style={{ zIndex: 1 }}>
        <Navbar />
        <main>{children}</main>
        <Footer />
      </div>
    </>
  )
}
