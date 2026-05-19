import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/convex/server'
import AnalyticsClient from './analytics-client'

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'View your dating app performance metrics and trends.',
}

export default async function AnalyticsPage() {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return <AnalyticsClient />
}
