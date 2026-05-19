import { convexQuery } from '@/lib/convex/http'
import { getRuntimeHealth } from '@/lib/clapcheeks/runtime-health'

const INBOUND_WATCHER_EVENT_TYPE = 'runtime.inbound_watcher_status'
const REMOTE_STALE_MS = 3 * 60 * 1000

type TelemetryEvent = {
  _id?: string
  occurred_at?: number
  ts?: number
  data?: Record<string, unknown>
}

export type InboundWatcherHealth = {
  ok: boolean
  source: 'convex.telemetry' | 'local-status'
  running: boolean
  can_read_chatdb: boolean | null
  fda_alert_imessage_enabled: boolean
  blocker: string | null
  blockers: Array<{ name: string; reason: string }>
  message: string
  status_path: string | null
  updated_at_ms: number | null
  telemetry_event_id: string | null
  telemetry_age_ms: number | null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function defaultUserId() {
  return process.env.CONVEX_FLEET_USER_ID || 'fleet-julian'
}

function fromLocalStatus(reason?: string): InboundWatcherHealth {
  const runtime = getRuntimeHealth()
  return {
    ok: runtime.inbound_watcher.ok,
    source: 'local-status',
    running: runtime.inbound_watcher.running,
    can_read_chatdb: runtime.inbound_watcher.can_read_chatdb,
    fda_alert_imessage_enabled: runtime.inbound_watcher.fda_alert_imessage_enabled,
    blocker: runtime.inbound_watcher.blocker || (runtime.inbound_watcher.ok ? null : 'inbound_watcher_not_ready'),
    blockers: reason
      ? [...runtime.blockers, { name: 'inbound-watcher-telemetry', reason }]
      : runtime.blockers,
    message: runtime.inbound_watcher.ok
      ? 'local status: chat.db tailer can read Messages'
      : runtime.blockers.map((item) => `${item.name}: ${item.reason}`).join('; ') || reason || 'inbound watcher not ready',
    status_path: runtime.inbound_watcher.status_path,
    updated_at_ms: runtime.inbound_watcher.updated_at_ms,
    telemetry_event_id: null,
    telemetry_age_ms: null,
  }
}

function fromTelemetryEvent(event: TelemetryEvent): InboundWatcherHealth {
  const data = event.data || {}
  const updatedAt = numberValue(data.updated_at_ms) ?? numberValue(event.occurred_at) ?? numberValue(event.ts)
  const telemetryAgeMs = updatedAt ? Date.now() - updatedAt : null
  const stale = telemetryAgeMs === null || telemetryAgeMs > REMOTE_STALE_MS
  const running = data.running === true
  const canReadChatDb = data.can_read_chatdb === true
  const fdaAlertEnabled = data.fda_alert_imessage_enabled === true
  const lastErrorKind = typeof data.last_error_kind === 'string' && data.last_error_kind
    ? data.last_error_kind
    : null
  const lastError = typeof data.last_error === 'string' && data.last_error
    ? data.last_error
    : null

  const blockers: InboundWatcherHealth['blockers'] = []
  if (stale) {
    blockers.push({
      name: 'inbound-watcher',
      reason: 'Convex inbound watcher status is stale',
    })
  }
  if (!running) {
    blockers.push({
      name: 'inbound-watcher',
      reason: 'inbound watcher is not running',
    })
  }
  if (!canReadChatDb) {
    blockers.push({
      name: 'inbound-watcher',
      reason: lastErrorKind === 'full_disk_access_missing'
        ? 'Full Disk Access missing for launchd Python'
        : lastError || lastErrorKind || 'inbound watcher cannot read chat.db',
    })
  }
  if (fdaAlertEnabled) {
    blockers.push({
      name: 'inbound-watcher-alert',
      reason: 'Full Disk Access alert iMessage is enabled',
    })
  }

  const ok = blockers.length === 0
  const blocker = stale
    ? 'convex_status_stale'
    : !running
      ? 'inbound_watcher_not_running'
      : !canReadChatDb
        ? lastErrorKind || 'chatdb_unreadable'
        : fdaAlertEnabled
          ? 'fda_alert_enabled'
          : null

  return {
    ok,
    source: 'convex.telemetry',
    running,
    can_read_chatdb: data.can_read_chatdb === null || data.can_read_chatdb === undefined
      ? null
      : canReadChatDb,
    fda_alert_imessage_enabled: fdaAlertEnabled,
    blocker,
    blockers,
    message: ok
      ? 'remote Convex status: chat.db tailer can read Messages'
      : blockers.map((item) => `${item.name}: ${item.reason}`).join('; '),
    status_path: null,
    updated_at_ms: updatedAt,
    telemetry_event_id: event._id || null,
    telemetry_age_ms: telemetryAgeMs,
  }
}

export async function getInboundWatcherHealth(userId = defaultUserId()): Promise<InboundWatcherHealth> {
  try {
    const events = await convexQuery<TelemetryEvent[]>('telemetry:listEventsForUser', {
      user_id: userId,
      event_type: INBOUND_WATCHER_EVENT_TYPE,
      limit: 1,
    })
    const event = Array.isArray(events) ? events[0] : null
    if (event?.data && typeof event.data === 'object') {
      return fromTelemetryEvent(event)
    }
    return fromLocalStatus('Convex inbound watcher telemetry event missing')
  } catch (error) {
    return fromLocalStatus(
      error instanceof Error
        ? `Convex inbound watcher telemetry unavailable: ${error.message}`
        : 'Convex inbound watcher telemetry unavailable',
    )
  }
}
