import { normalizeMatchPhotos } from '@/lib/matches/photos'

type MatchVisibilityRow = {
  status?: unknown
  stage?: unknown
  platform?: unknown
  name?: unknown
  match_name?: unknown
  photos?: unknown
  photos_jsonb?: unknown
  match_intel?: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function matchDisplayName(row: MatchVisibilityRow): string {
  return String(row.name ?? row.match_name ?? '').trim()
}

export function isArchivedMatch(row: MatchVisibilityRow): boolean {
  const status = String(row.status ?? '').trim().toLowerCase()
  const stage = String(row.stage ?? '').trim().toLowerCase()
  return status === 'archived' || stage === 'archived' || stage === 'archived_cluster_dupe'
}

export function matchPhotoCount(row: MatchVisibilityRow): number {
  return normalizeMatchPhotos([
    ...normalizeMatchPhotos(row.photos_jsonb),
    ...normalizeMatchPhotos(row.photos),
  ]).length
}

export function isTransportOnlyPlaceholder(row: MatchVisibilityRow): boolean {
  const platform = String(row.platform ?? '').trim().toLowerCase()
  if (platform !== 'hinge') return false

  const intel = asRecord(row.match_intel)
  const name = matchDisplayName(row).toLowerCase()
  const hasTransportMarker =
    intel.intel_source === 'sendbird_channel' ||
    intel.transport === 'sendbird' ||
    Boolean(intel.sendbird_channel_url || intel.sendbird_channel_url_present)

  return hasTransportMarker && matchPhotoCount(row) === 0 && (
    !name ||
    name === 'unknown' ||
    name === 'hinge chat' ||
    name === 'group channel'
  )
}

export function isDisplayableMatchProfile(row: MatchVisibilityRow): boolean {
  return !isArchivedMatch(row) && !isTransportOnlyPlaceholder(row)
}
