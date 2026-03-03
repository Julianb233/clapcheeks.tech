import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Activate Your Account | Clapcheeks',
  description: 'Activate your Clapcheeks account to get started.',
}

export default function ActivateLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
