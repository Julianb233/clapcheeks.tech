import { Metadata } from 'next'
import { AiFirstDateClient } from './client'

export const metadata: Metadata = {
  title: 'AI First Date — Clapcheeks',
  description: 'Answer a few questions so your AI co-pilot knows who you really are.',
}

export default function AiFirstDatePage() {
  return <AiFirstDateClient />
}
