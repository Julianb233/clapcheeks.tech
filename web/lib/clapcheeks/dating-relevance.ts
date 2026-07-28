const ACTIVE_DATING_STATUSES = new Set(["lead", "active", "dating", "paused"])
const DATING_ONLY_CHANNELS = new Set([
  "hinge",
  "tinder",
  "bumble",
  "feeld",
  "cmb",
  "coffeemeetsbagel",
])
const NON_DATING_VIBES = new Set(["platonic", "professional"])

function labelsFor(person: any): string[] {
  return Array.isArray(person?.google_contacts_labels)
    ? person.google_contacts_labels.map((label: unknown) => String(label).trim())
    : []
}

function hasDatingHandle(person: any): boolean {
  if (!Array.isArray(person?.handles)) return false
  return person.handles.some((handle: any) =>
    DATING_ONLY_CHANNELS.has(String(handle?.channel ?? "").toLowerCase()),
  )
}

/**
 * Shared fail-closed dating-roster gate for the dashboard and Convex sweeps.
 *
 * General-purpose channels and recency are deliberately insufficient. A
 * recent iMessage can be a client, relative, vendor, or friend. Explicit CCT
 * membership and native dating-app identity are stronger than a stale model
 * classification; otherwise professional/platonic classifications stop the
 * row before courtship automation sees it.
 */
export function isDatingRelevantPerson(person: any): boolean {
  if (!ACTIVE_DATING_STATUSES.has(String(person?.status ?? ""))) return false

  const labels = labelsFor(person)
  const explicitlyCctDating = labels.includes("CCT Dating")
  const importedDatingProfile = person?.imported_from_profile_screenshot === true
  const nativeDatingIdentity = hasDatingHandle(person)

  if (explicitlyCctDating || importedDatingProfile || nativeDatingIdentity) {
    return true
  }

  if (person?.is_client === true || person?.is_discipleship === true) {
    return false
  }

  const vibe = String(person?.vibe_classification ?? "").toLowerCase()
  if (NON_DATING_VIBES.has(vibe)) return false

  const confidentDatingVibe =
    vibe === "dating" && Number(person?.vibe_confidence ?? 0) >= 0.65
  const hasOperatorRating =
    person?.hotness_rating !== undefined || person?.effort_rating !== undefined

  return confidentDatingVibe || hasOperatorRating
}

