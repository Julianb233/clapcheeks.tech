import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/convex/server'
import { convexMutation } from '@/lib/convex/http'

const PLATFORMS = new Set(['tinder', 'hinge', 'bumble'])
const ADAPTERS = new Set(['observe-only', 'macos-screen', 'physical-ios'])

function cleanAdapter(value: unknown) {
  const adapter = String(value || 'observe-only').trim().toLowerCase().replace(/_/g, '-')
  return ADAPTERS.has(adapter) ? adapter : null
}


function cleanPlatform(value: unknown) {
  const platform = String(value || '').trim().toLowerCase()
  return PLATFORMS.has(platform) ? platform : null
}

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

  const platform = cleanPlatform(body.platform)
  const line = cleanLine(body.line)
  const adapter = cleanAdapter(body.adapter)
  if (!platform) return NextResponse.json({ error: 'platform must be tinder, hinge, or bumble' }, { status: 400 })
  if (!line) return NextResponse.json({ error: 'line must be a secondary line number >= 2' }, { status: 400 })
  if (!adapter) return NextResponse.json({ error: 'adapter must be observe-only, macos-screen, or physical-ios' }, { status: 400 })

  const payload = {
    platform,
    line,
    adapter,
    capture_screenshot: body.capture_screenshot !== false,
    app_bundle_id: typeof body.app_bundle_id === 'string' ? body.app_bundle_id : undefined,
    device_label: typeof body.device_label === 'string' ? body.device_label : undefined,
    account_label: typeof body.account_label === 'string' ? body.account_label : undefined,
    source: 'dashboard_device_control_observe',
  }

  try {
    const jobId = await convexMutation<string>('agent_jobs:enqueue', {
      user_id: user.id,
      job_type: 'device_observe',
      payload,
      priority: 4,
      max_attempts: 1,
    })
    return NextResponse.json({ queued: true, job_id: jobId, job_type: 'device_observe', payload })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enqueue device observe job', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
