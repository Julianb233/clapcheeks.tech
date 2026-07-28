import { describe, expect, it } from "vitest"

import { isDatingRelevantPerson } from "../lib/clapcheeks/dating-relevance"

const active = { status: "active" }

describe("isDatingRelevantPerson", () => {
  it("rejects recent iMessage-only and CC TECH-only contacts", () => {
    expect(isDatingRelevantPerson({
      ...active,
      last_inbound_at: Date.now(),
      handles: [{ channel: "imessage", value: "opaque" }],
    })).toBe(false)
    expect(isDatingRelevantPerson({
      ...active,
      google_contacts_labels: ["CC TECH"],
    })).toBe(false)
  })

  it("accepts explicit CCT Dating membership and native dating identities", () => {
    expect(isDatingRelevantPerson({
      ...active,
      google_contacts_labels: ["CC TECH", "CCT Dating"],
    })).toBe(true)
    expect(isDatingRelevantPerson({
      ...active,
      handles: [{ channel: "hinge", value: "opaque" }],
    })).toBe(true)
  })

  it("rejects clients and non-dating classifications without explicit evidence", () => {
    expect(isDatingRelevantPerson({
      ...active,
      is_client: true,
      vibe_classification: "dating",
      vibe_confidence: 0.99,
    })).toBe(false)
    expect(isDatingRelevantPerson({
      ...active,
      vibe_classification: "professional",
      hotness_rating: 8,
    })).toBe(false)
  })

  it("requires a confident dating classification", () => {
    expect(isDatingRelevantPerson({
      ...active,
      vibe_classification: "dating",
      vibe_confidence: 0.64,
    })).toBe(false)
    expect(isDatingRelevantPerson({
      ...active,
      vibe_classification: "dating",
      vibe_confidence: 0.65,
    })).toBe(true)
  })

  it("rejects inactive lifecycle states before any other signal", () => {
    expect(isDatingRelevantPerson({
      status: "ended",
      google_contacts_labels: ["CCT Dating"],
    })).toBe(false)
  })
})
