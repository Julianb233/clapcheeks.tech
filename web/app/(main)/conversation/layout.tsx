import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Conversation',
  description: 'AI conversation suggestions and voice profile for dating apps.',
}

export default function ConversationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
