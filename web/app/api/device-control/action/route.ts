import { NextRequest, NextResponse } from 'next/server'
import { existsSync, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@/lib/convex/server'
import { convexMutation, convexQuery } from '@/lib/convex/http'

const PLATFORMS = new Set(['tinder', 'hinge', 'bumble'])
const ADAPTERS = new Set(['observe-only', 'macos-screen', 'physical-ios'])
const PHYSICAL_IOS_LIVE_ACTION_ENV = 'CLAPCHEEKS_PHYSICAL_IOS_ENABLE_LIVE_ACTIONS'
const PHYSICAL_PNG_PROOF_MAX_AGE_SECONDS = Number(process.env.CLAPCHEEKS_PHYSICAL_PNG_PROOF_MAX_AGE_SECONDS || 900)

function cleanAdapter(value: unknown) {
  const adapter = String(value || 'observe-only').trim().toLowerCase().replace(/_/g, '-')
  return ADAPTERS.has(adapter) ? adapter : null
}

function physicalIOSLiveActionsEnabled() {
  return process.env[PHYSICAL_IOS_LIVE_ACTION_ENV] === '1'
}

function expandHome(rawPath: string) {
  return rawPath === '~' || rawPath.startsWith('~/')
    ? path.join(os.homedir(), rawPath.slice(2))
    : rawPath
}

function runtimeDir() {
  return expandHome(process.env.CLAPCHEEKS_RUNTIME_DIR || path.join(os.homedir(), '.clapcheeks-local'))
}

function deviceControlArtifactDir() {
  return expandHome(process.env.CLAPCHEEKS_DEVICE_CONTROL_ARTIFACT_DIR || path.join(runtimeDir(), 'device-control'))
}

function deviceControlScreenshotDir() {
  return path.resolve(deviceControlArtifactDir(), 'screenshots')
}

function validatePhysicalPngProofPath(proofPath: string | null) {
  if (!proofPath) return 'physical_png_proof_path_required'
  if (path.extname(proofPath).toLowerCase() !== '.png') return 'physical_png_proof_path_invalid'
  try {
    const resolvedProof = realpathSync(expandHome(proofPath))
    const screenshotsRoot = path.resolve(deviceControlScreenshotDir())
    const relativePath = path.relative(screenshotsRoot, resolvedProof)
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      return 'physical_png_proof_path_outside_artifact_dir'
    }
    if (!existsSync(resolvedProof)) return 'physical_png_proof_path_invalid'
    const stat = statSync(resolvedProof)
    if (!stat.isFile() || stat.size <= 0) return 'physical_png_proof_path_invalid'
    if ((Date.now() - stat.mtimeMs) / 1000 > PHYSICAL_PNG_PROOF_MAX_AGE_SECONDS) {
      return 'physical_png_proof_stale'
    }
    return null
  } catch {
    return 'physical_png_proof_path_invalid'
  }
}

const ACTIONS = new Set(['tap', 'swipe', 'type_text', 'send'])

const APPROVAL_MAX_AGE_SECONDS = 15 * 60

function cleanApprovalDecidedAt(value: unknown) {
  const decidedAt = Number(value)
  return Number.isFinite(decidedAt) && decidedAt > 0 ? decidedAt : null
}

function approvalDecidedAtSeconds(value: unknown) {
  const numeric = cleanApprovalDecidedAt(value)
  if (numeric) return numeric
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed / 1000 : null
  }
  return null
}

function isFreshApproval(decidedAt: number) {
  return (Date.now() / 1000 - decidedAt) <= APPROVAL_MAX_AGE_SECONDS
}

type ApprovalRecord = {
  _id?: unknown
  id?: unknown
  user_id?: unknown
  status?: unknown
  decided_at?: unknown
}

async function verifyApprovalRecord(userId: string, approvalId: string) {
  const approvals = await convexQuery<ApprovalRecord[]>('queues:listApprovalsForUser', { user_id: userId })
  if (!Array.isArray(approvals)) return null
  return approvals.find((approval) => (
    String(approval._id || approval.id || '') === approvalId &&
    (!approval.user_id || String(approval.user_id) === userId)
  )) || null
}

function cleanPlatform(value: unknown) {
  const platform = String(value || '').trim().toLowerCase()
  return PLATFORMS.has(platform) ? platform : null
}

function cleanAction(value: unknown) {
  const action = String(value || '').trim().toLowerCase().replace(/-/g, '_')
  return ACTIONS.has(action) ? action : null
}

function cleanLine(value: unknown) {
  const line = Number(value || 2)
  return Number.isInteger(line) && line >= 2 ? line : null
}

function safePayloadForResponse(payload: Record<string, unknown>) {
  const safe = { ...payload }
  const actionPayload = typeof safe.action_payload === 'object' && safe.action_payload
    ? { ...(safe.action_payload as Record<string, unknown>) }
    : {}
  for (const key of ['message', 'text', 'body']) {
    if (typeof actionPayload[key] === 'string') {
      actionPayload[`${key}_length`] = actionPayload[key].length
      actionPayload[key] = '[redacted]'
    }
  }
  safe.action_payload = actionPayload
  return safe
}

function cleanActionPayload(value: unknown) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isFiniteNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric)
}

function hasPoint(payload: Record<string, unknown>) {
  const point = typeof payload.point === 'object' && payload.point && !Array.isArray(payload.point)
    ? payload.point as Record<string, unknown>
    : payload
  return isFiniteNumber(point.x) && isFiniteNumber(point.y)
}

function hasText(payload: Record<string, unknown>) {
  return ['message', 'text', 'body'].some((key) => typeof payload[key] === 'string' && payload[key].trim().length > 0)
}

function validateLiveActionPayload(actionKind: string, payload: Record<string, unknown>) {
  if (actionKind === 'tap') {
    return hasPoint(payload) ? null : 'tap_coordinates_required'
  }
  if (actionKind === 'swipe') {
    for (const key of ['start_x', 'start_y', 'end_x', 'end_y']) {
      if (!isFiniteNumber(payload[key])) return `${key}_coordinate_required`
    }
    if (payload.duration_ms !== undefined && !isFiniteNumber(payload.duration_ms)) {
      return 'duration_ms_coordinate_required'
    }
    return null
  }
  if (actionKind === 'type_text') {
    return hasText(payload) ? null : 'text_required'
  }
  if (actionKind === 'send') {
    if (!hasText(payload)) return 'text_required'
    const sendButton = typeof payload.send_button === 'object' && payload.send_button && !Array.isArray(payload.send_button)
      ? payload.send_button as Record<string, unknown>
      : null
    if (!sendButton || !isFiniteNumber(sendButton.x) || !isFiniteNumber(sendButton.y)) {
      return 'send_button_coordinates_required'
    }
    return null
  }
  return null
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
  const actionKind = cleanAction(body.action_kind)
  const line = cleanLine(body.line)
  const adapter = cleanAdapter(body.adapter)
  if (!platform) return NextResponse.json({ error: 'platform must be tinder, hinge, or bumble' }, { status: 400 })
  if (!actionKind) return NextResponse.json({ error: 'action_kind must be tap, swipe, type_text, or send' }, { status: 400 })
  if (!line) return NextResponse.json({ error: 'line must be a secondary line number >= 2' }, { status: 400 })
  if (!adapter) return NextResponse.json({ error: 'adapter must be observe-only, macos-screen, or physical-ios' }, { status: 400 })

  const dryRun = body.dry_run !== false
  const approvalId = typeof body.approval_id === 'string' && body.approval_id.trim() ? body.approval_id.trim() : null
  let approvalStatus = typeof body.approval_status === 'string' ? body.approval_status : 'missing'
  let approvalDecidedAt = cleanApprovalDecidedAt(body.approval_decided_at)
  const confirmLiveAction = body.confirm_live_action === true
  const confirmPhysicalPngProof = body.confirm_physical_png_proof === true
  const physicalPngProofPath = typeof body.physical_png_proof_path === 'string' && body.physical_png_proof_path.trim() ? body.physical_png_proof_path.trim() : null
  const confirmOutboundSend = body.confirm_outbound_send === true
  const actionPayload = cleanActionPayload(body.action_payload)

  if (!actionPayload) {
    return NextResponse.json({ error: 'action_payload must be an object' }, { status: 400 })
  }

  if (!dryRun) {
    if (!approvalId) {
      return NextResponse.json({ error: 'live device actions require approved approval_id' }, { status: 403 })
    }
    let approvalRecord: ApprovalRecord | null = null
    try {
      approvalRecord = await verifyApprovalRecord(user.id, approvalId)
    } catch (error) {
      return NextResponse.json(
        { error: 'live device actions require Convex approval verification', detail: error instanceof Error ? error.message : String(error) },
        { status: 403 },
      )
    }
    if (!approvalRecord || approvalRecord.status !== 'approved') {
      return NextResponse.json({ error: 'live device actions require approved approval_id' }, { status: 403 })
    }
    approvalStatus = 'approved'
    approvalDecidedAt = approvalDecidedAtSeconds(approvalRecord.decided_at)
    if (!approvalDecidedAt) {
      return NextResponse.json({ error: 'live device actions require approval_decided_at' }, { status: 403 })
    }
    if (!isFreshApproval(approvalDecidedAt)) {
      return NextResponse.json({ error: 'live device action approval is expired' }, { status: 403 })
    }
    if (!confirmLiveAction) {
      return NextResponse.json({ error: 'live device actions require confirm_live_action=true' }, { status: 403 })
    }
    if (!confirmPhysicalPngProof) {
      return NextResponse.json({ error: 'live device actions require confirm_physical_png_proof=true' }, { status: 403 })
    }
    const physicalPngProofDenial = validatePhysicalPngProofPath(physicalPngProofPath)
    if (physicalPngProofDenial) {
      return NextResponse.json({ error: 'live device actions require a fresh physical PNG proof under the device-control screenshot directory', reason: physicalPngProofDenial }, { status: 403 })
    }
    const liveActionPayloadDenial = validateLiveActionPayload(actionKind, actionPayload)
    if (liveActionPayloadDenial) {
      return NextResponse.json({ error: 'live device actions require action_payload matching the requested action kind', reason: liveActionPayloadDenial }, { status: 403 })
    }
    if (actionKind === 'send' && !confirmOutboundSend) {
      return NextResponse.json({ error: 'live sends require confirm_outbound_send=true' }, { status: 403 })
    }
    if (adapter === 'physical-ios' && !physicalIOSLiveActionsEnabled()) {
      return NextResponse.json({ error: 'physical-ios live actions require CLAPCHEEKS_PHYSICAL_IOS_ENABLE_LIVE_ACTIONS=1' }, { status: 403 })
    }
  }

  const payload = {
    platform,
    line,
    action_kind: actionKind,
    action_payload: actionPayload,
    adapter,
    approval_id: approvalId || undefined,
    approval_status: approvalStatus,
    approval_decided_at: approvalDecidedAt || undefined,
    confirm_live_action: confirmLiveAction,
    confirm_physical_png_proof: confirmPhysicalPngProof,
    physical_png_proof_path: physicalPngProofPath || undefined,
    confirm_outbound_send: confirmOutboundSend,
    dry_run: dryRun,
    app_bundle_id: typeof body.app_bundle_id === 'string' ? body.app_bundle_id : undefined,
    device_label: typeof body.device_label === 'string' ? body.device_label : undefined,
    account_label: typeof body.account_label === 'string' ? body.account_label : undefined,
    source: 'dashboard_device_control_action',
  }

  try {
    const jobId = await convexMutation<string>('agent_jobs:enqueue', {
      user_id: user.id,
      job_type: 'device_action',
      payload,
      priority: 4,
      max_attempts: 1,
    })
    return NextResponse.json({ queued: true, job_id: jobId, job_type: 'device_action', payload: safePayloadForResponse(payload) })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enqueue device action job', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
