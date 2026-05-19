import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { convexMutation } from '@/lib/convex/http'

const PLATFORMS = ['hinge', 'tinder', 'bumble'] as const

function cleanLine(value: unknown) {
  const line = Number(value || 2)
  return Number.isInteger(line) && line >= 2 ? line : null
}

export async function POST(request: NextRequest) {
  const convex = await createClient()
  const { data: { user } } = await convex.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const line = cleanLine(body.line)
  if (!line) return NextResponse.json({ error: 'line must be a secondary line number >= 2' }, { status: 400 })

  const jobs = []
  try {
    for (const platform of PLATFORMS) {
      const payload = {
        platform,
        line,
        adapter: 'physical-ios',
        capture_screenshot: true,
        require_physical_png: true,
        device_label: typeof body.device_label === 'string' ? body.device_label : 'secondary-iphone',
        account_label: typeof body.account_label === 'string' ? body.account_label : undefined,
        source: 'dashboard_device_control_proof_all',
      }
      const jobId = await convexMutation<string>('agent_jobs:enqueue', {
        user_id: user.id,
        job_type: 'device_observe',
        payload,
        priority: 3,
        max_attempts: 1,
      })
      jobs.push({ platform, job_id: jobId, job_type: 'device_observe', payload })
    }

    return NextResponse.json({ queued: true, job_ids: jobs.map((job) => job.job_id), jobs })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enqueue all-platform device proof jobs', detail: error instanceof Error ? error.message : String(error), jobs },
      { status: 500 },
    )
  }
}
