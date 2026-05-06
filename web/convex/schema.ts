import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Convex schema for the clapcheeks messaging engine.
// Postgres still owns: users, profiles, subscriptions, billing, photos, analytics.
// Convex owns: live messaging state, conversation tracking, scheduled flows, agent jobs.
//
// Linear: AI-9196 — Phase 3 messaging engine migration off pg_cron + agent_jobs_queue.

export default defineSchema({
  // One row per match the user is talking to. Keyed by Supabase user_id + external match id.
  conversations: defineTable({
    user_id: v.string(),                  // Supabase auth user id
    platform: v.union(                    // dating app of origin
      v.literal("hinge"),
      v.literal("tinder"),
      v.literal("bumble"),
      v.literal("imessage"),
      v.literal("other"),
    ),
    external_match_id: v.string(),        // platform-specific match id
    match_name: v.optional(v.string()),
    match_photo_url: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("ghosted"),
      v.literal("dating"),
      v.literal("ended"),
    ),
    last_message_at: v.optional(v.number()),
    last_inbound_at: v.optional(v.number()),
    last_outbound_at: v.optional(v.number()),
    unread_count: v.number(),
    metadata: v.optional(v.any()),        // platform-specific blob (compatibility, age, etc.)
    created_at: v.number(),
    updated_at: v.number(),
    // Multi-line iMessage fields (AI-9409)
    line: v.optional(v.number()),                  // 1-5 for fleet multi-line; sticky once set
    imessage_handle: v.optional(v.string()),       // E.164 phone or email tied to the contact
    ghl_contact_id: v.optional(v.string()),        // GoHighLevel contact UUID once linked
    // Cross-channel person identity (AI-9449)
    person_id: v.optional(v.id("people")),         // unified-person link; null until person_linker matches
  })
    .index("by_user", ["user_id"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_user_external", ["user_id", "platform", "external_match_id"])
    .index("by_last_message", ["user_id", "last_message_at"])
    .index("by_line_recent", ["line", "last_message_at"])      // AI-9409: per-line queries
    .index("by_imessage_handle", ["imessage_handle"])          // AI-9409: sticky-line lookup
    .index("by_person", ["person_id"]),                         // AI-9449: cross-channel feed per person

  // Every message in or out, both for live UI updates and AI training context.
  messages: defineTable({
    conversation_id: v.id("conversations"),
    user_id: v.string(),                  // denormalized for fast filtering
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    sent_at: v.number(),
    delivered_at: v.optional(v.number()),
    read_at: v.optional(v.number()),
    source: v.union(                      // who/what generated the message
      v.literal("user"),
      v.literal("ai_suggestion_approved"),
      v.literal("ai_auto_send"),
      v.literal("scheduled"),
      v.literal("import"),
      v.literal("bluebubbles_webhook"),   // AI-9409: inbound from BlueBubbles VPS receiver
    ),
    ai_metadata: v.optional(v.any()),     // model, tokens, prompt id, score, etc.
    // Multi-line iMessage fields (AI-9409)
    line: v.optional(v.number()),                  // 1-5 for fleet multi-line; optional — existing rows stay valid
    transport: v.optional(v.union(                 // which iMessage transport delivered/sent it
      v.literal("bluebubbles"),
      v.literal("pypush"),
      v.literal("applescript"),
      v.literal("sms"),
      v.literal("imessage_native"),               // existing clapcheeks rows
    )),
    external_guid: v.optional(v.string()),         // BlueBubbles message GUID for dedup + reaction targeting
    attachments_summary: v.optional(v.array(v.object({
      guid: v.string(),
      name: v.optional(v.string()),
      mime: v.optional(v.string()),
      size: v.optional(v.number()),
      is_audio_message: v.optional(v.boolean()),
    }))),
    send_error: v.optional(v.object({
      code: v.optional(v.number()),
      description: v.optional(v.string()),
    })),
    // Cross-channel person identity (AI-9449) — denormalized from conversations.person_id
    // so message-level queries (e.g. cadence runner reading "last 30 messages with this person")
    // don't require a join.
    person_id: v.optional(v.id("people")),
  })
    .index("by_conversation", ["conversation_id", "sent_at"])
    .index("by_user_recent", ["user_id", "sent_at"])
    .index("by_line_recent", ["line", "sent_at"])              // AI-9409: per-line feed
    .index("by_external_guid", ["external_guid"])              // AI-9409: dedup lookup
    .index("by_person_recent", ["person_id", "sent_at"]),      // AI-9449: cross-channel message feed

  // Replaces public.clapcheeks_scheduled_messages on Postgres.
  scheduled_messages: defineTable({
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    body: v.string(),
    scheduled_for: v.number(),            // unix ms
    schedule_reason: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    sent_message_id: v.optional(v.id("messages")),
    failure_reason: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_status_due", ["status", "scheduled_for"])
    .index("by_user", ["user_id", "status"])
    .index("by_conversation", ["conversation_id", "status"]),

  // Replaces public.agent_jobs_queue on Postgres. Used by the local Mac agent for work units.
  agent_jobs: defineTable({
    user_id: v.string(),
    job_type: v.string(),                 // 'fetch_messages', 'send_reply', 'score_photos', etc.
    payload: v.any(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    priority: v.number(),                 // higher = sooner
    attempts: v.number(),
    max_attempts: v.number(),
    last_error: v.optional(v.string()),
    locked_by: v.optional(v.string()),    // agent instance id
    locked_until: v.optional(v.number()),
    result: v.optional(v.any()),
    created_at: v.number(),
    updated_at: v.number(),
    completed_at: v.optional(v.number()),
  })
    .index("by_status_priority", ["status", "priority"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_user_type", ["user_id", "job_type"]),

  // Per-conversation drip / re-engagement state machine.
  drip_states: defineTable({
    conversation_id: v.id("conversations"),
    user_id: v.string(),
    state: v.string(),                    // 'cold_open', 'awaiting_reply', 'rescheduled', 'closed'
    next_action_at: v.optional(v.number()),
    cool_down_until: v.optional(v.number()),
    consecutive_no_reply: v.number(),
    metadata: v.optional(v.any()),
    updated_at: v.number(),
  })
    .index("by_next_action", ["state", "next_action_at"])
    .index("by_conversation", ["conversation_id"]),

  // -----------------------------------------------------------------------
  // AI-9449 — Unified person record across channels.
  //
  // One row per real human, regardless of how many platforms they reach you on
  // (iMessage, Hinge, Tinder, Bumble, Telegram, email, etc.). Sourced from
  // Obsidian frontmatter (interests/goals/values/cadence) and joined to
  // conversations + messages via person_id. Obsidian is canonical for "who
  // they are"; Convex is canonical for "live state" (last_inbound_at,
  // next_followup_at, style_profile).
  //
  // Companion: people.ts (upsertFromObsidian, findByHandle, dueForFollowup,
  // linkConversation). Local agent: clapcheeks-local/intel/obsidian_sync.py
  // and clapcheeks-local/intel/person_linker.py.
  // -----------------------------------------------------------------------
  people: defineTable({
    user_id: v.string(),                            // Supabase auth user (the operator)
    display_name: v.string(),

    // Obsidian linkage (one-way: Obsidian -> Convex). hash detects edits to
    // skip no-op upserts.
    obsidian_path: v.optional(v.string()),          // e.g. "People/Romantic/Sarah K.md"
    obsidian_md_hash: v.optional(v.string()),

    // Identity handles — every channel a message could land on.
    handles: v.array(v.object({
      channel: v.union(
        v.literal("imessage"), v.literal("sms"), v.literal("hinge"),
        v.literal("tinder"), v.literal("bumble"), v.literal("instagram"),
        v.literal("telegram"), v.literal("email"), v.literal("whatsapp"),
      ),
      value: v.string(),                            // E.164 phone, lowercase email, or platform user id
      verified: v.boolean(),
      primary: v.boolean(),
    })),

    // Personality (sourced from Obsidian frontmatter, refreshed by sync).
    interests: v.array(v.string()),
    goals: v.array(v.string()),
    values: v.array(v.string()),
    context_notes: v.optional(v.string()),          // free-form Obsidian body excerpt
    disc_primary: v.optional(v.string()),
    vak_primary: v.optional(v.string()),
    communication_style: v.optional(v.string()),

    // Cadence + timing — drives the cadence_runner thread.
    cadence_profile: v.union(
      v.literal("hot"),                             // reply within 5-30m
      v.literal("warm"),                            // reply within 1-4h
      v.literal("slow_burn"),                       // 1/day
      v.literal("nurture"),                         // 2-3/week
      v.literal("dormant"),                         // 1/month re-engage
    ),
    active_hours_local: v.optional(v.object({
      tz: v.string(),                               // e.g. "America/Los_Angeles"
      start_hour: v.number(),                       // 0-23
      end_hour: v.number(),
    })),

    // Live state (computed by daemon, NOT from Obsidian).
    last_inbound_at: v.optional(v.number()),
    last_outbound_at: v.optional(v.number()),
    next_followup_at: v.optional(v.number()),
    style_profile: v.optional(v.any()),             // output of comms_profiler

    // Lifecycle
    status: v.union(
      v.literal("lead"), v.literal("active"), v.literal("paused"),
      v.literal("ghosted"), v.literal("dating"), v.literal("ended"),
    ),

    // Safety brake — both Obsidian frontmatter AND this field must be true
    // for daemon to autoreply. Default false.
    whitelist_for_autoreply: v.boolean(),

    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_next_followup", ["status", "next_followup_at"])
    .index("by_obsidian_path", ["obsidian_path"]),
    // NOTE: no by_handles index — Convex doesn't index inside arrays-of-objects.
    // findByHandle does an O(N) scan filtered by user_id; fine at human-scale (<10k people).

  // -----------------------------------------------------------------------
  // AI-9449 — Pending cross-channel link queue.
  //
  // When person_linker.py sees an inbound message but can't match exactly one
  // person row (multi-match or no-match), it inserts a pending_links row. The
  // Vercel dashboard surfaces these for manual disposition.
  // -----------------------------------------------------------------------
  pending_links: defineTable({
    user_id: v.string(),
    conversation_id: v.id("conversations"),
    handle_channel: v.string(),                     // e.g. "imessage"
    handle_value: v.string(),                       // e.g. "+15551234567"
    candidate_person_ids: v.array(v.id("people")),  // empty = no match; multi = ambiguous
    raw_context: v.optional(v.string()),            // first message text snippet
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("ignored"),
    ),
    resolved_person_id: v.optional(v.id("people")),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_status", ["user_id", "status"])
    .index("by_conversation", ["conversation_id"]),
});
