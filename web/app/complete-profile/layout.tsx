import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Complete Your Profile | Clapcheeks',
  description: 'Set up your preferences to personalize your Clapcheeks experience.',
}

export default function CompleteProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
