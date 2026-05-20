type MatchLike = {
  platform?: string | null
  name?: string | null
  match_name?: string | null
  match_intel?: unknown
}

type IdentityStatus = {
  displayName: string
  needsReview: boolean
  isHingeInitialOnly: boolean
  label: string | null
  helper: string | null
}

const GENERIC_NAMES = new Set([
  '',
  'unknown',
  'unknown match',
  'hinge match',
  'app match',
  'match',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getMatchIdentityStatus(match: MatchLike): IdentityStatus {
  const intel = asRecord(match.match_intel)
  const platform = (
    cleanString(match.platform) ||
    cleanString(intel.platform) ||
    cleanString(intel.source_platform)
  ).toLowerCase()
  const rawName =
    cleanString(match.name) ||
    cleanString(match.match_name) ||
    cleanString(intel.name) ||
    cleanString(intel.match_name)
  const normalized = rawName.toLowerCase()
  const displayName = rawName && !GENERIC_NAMES.has(normalized) ? rawName : 'Unknown'
  const isHingeInitialOnly = platform === 'hinge' && /^[A-Za-z]$/.test(displayName)
  const markedNeedsReview = Boolean(
    intel.identity_needs_review ||
      intel.identity_status === 'initial_only' ||
      intel.identity_quality === 'hinge_initial_only',
  )
  const needsReview = isHingeInitialOnly || markedNeedsReview

  return {
    displayName,
    needsReview,
    isHingeInitialOnly,
    label: isHingeInitialOnly ? 'Hinge initial only' : needsReview ? 'Identity review' : null,
    helper: isHingeInitialOnly
      ? 'Hinge currently exposes only this initial; photos and profile prompts are synced.'
      : needsReview
        ? 'Review this identity before treating the name as confirmed.'
        : null,
  }
}
