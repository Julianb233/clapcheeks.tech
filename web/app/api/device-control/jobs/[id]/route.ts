import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { convexQuery } from '@/lib/convex/http'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = await context.params
  const id = String(params.id || '').trim()
  if (!id) {
    return NextResponse.json({ error: 'job id is required' }, { status: 400 })
  }

  try {
    const job = await convexQuery<Record<string, unknown> | null>('agent_jobs:getById', {
      id,
      user_id: user.id,
    })
    if (job && job.status === 'error') {
      throw new Error(String(job.errorMessage || job.error || 'Convex query returned status=error'))
    }
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    return NextResponse.json({ job, source: 'agent_jobs:getById' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    try {
      const jobs = await convexQuery<Array<Record<string, unknown>>>('agent_jobs:listForUser', {
        user_id: user.id,
      })
      const activeJob = jobs.find((job) => String(job._id || '') === id)
      if (activeJob) {
        return NextResponse.json({ job: activeJob, source: 'agent_jobs:listForUser', warning: detail })
      }
      return NextResponse.json({ error: 'Job not found', detail }, { status: 404 })
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error: 'Failed to load device-control job',
          detail,
          fallback_detail: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        },
        { status: 500 },
      )
    }
  }
}
