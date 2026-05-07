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

    // Google Contacts linkage. Populated by intel/google_contacts_sync.py for
    // every contact carrying the configured membership label (default: "CC TECH").
    // The presence of the label name in google_contacts_labels is what flags
    // a person as "in the clapcheeks network" — Obsidian no longer governs
    // membership.
    google_contact_id: v.optional(v.string()),                       // resourceName, e.g. "people/c123..."
    google_contact_etag: v.optional(v.string()),                     // for change detection
    google_contacts_labels: v.optional(v.array(v.string())),         // ["CC TECH", "Family", ...]
    google_account_source: v.optional(v.union(                       // which gws profile this came from
      v.literal("personal"),                                          // julianb233@gmail.com
      v.literal("workspace"),                                         // julian@aiacrobatics.com
      v.literal("both"),                                              // dedupe matched same person across both
    )),

    // Cross-system foreign keys (for backfill + bidirectional sync verification).
    supabase_people_id: v.optional(v.string()),                       // public.people.id from Dashboard Daddy
    ghl_contact_id: v.optional(v.string()),                           // GoHighLevel CRM
    notion_page_id: v.optional(v.string()),                           // Notion person page

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

    // -----------------------------------------------------------------
    // OPERATOR-SET enrichment (sourced from Obsidian Templates/Person.md
    // + Google Contacts user-defined fields + dashboard manual edits).
    // -----------------------------------------------------------------
    interests: v.array(v.string()),
    goals: v.array(v.string()),
    values: v.array(v.string()),
    context_notes: v.optional(v.string()),          // free-form Obsidian body excerpt
    domain: v.optional(v.array(v.string())),        // ["business", "personal", "creative", ...]
    disc_primary: v.optional(v.string()),           // D / I / S / C
    disc_secondary: v.optional(v.string()),
    disc_type: v.optional(v.string()),              // composite, e.g. "I/D"
    vak_primary: v.optional(v.string()),            // visual / auditory / kinesthetic
    communication_style: v.optional(v.string()),
    formality: v.optional(v.string()),              // casual / professional / formal
    best_contact_time: v.optional(v.string()),
    preferred_channel: v.optional(v.string()),
    business_potential: v.optional(v.string()),     // low / medium / high
    company: v.optional(v.string()),
    profession: v.optional(v.string()),
    faith_stage: v.optional(v.string()),
    is_discipleship: v.optional(v.boolean()),
    is_client: v.optional(v.boolean()),
    client_project: v.optional(v.string()),
    relationship_strength: v.optional(v.number()),  // 1-10
    cialdini_principle: v.optional(v.string()),     // reciprocity / commitment / social_proof / authority / liking / scarcity / unity
    rapport_phrases: v.optional(v.array(v.string())),  // operator-curated phrases that build rapport

    // Interests refinement (Julian: "interests")
    interest_categories: v.optional(v.array(v.string())),  // top-level: sports, music, food, travel, fitness, etc.
    passions: v.optional(v.array(v.string())),             // deeper than interests
    dislikes: v.optional(v.array(v.string())),
    topics_to_avoid: v.optional(v.array(v.string())),

    // -----------------------------------------------------------------
    // AUTO-COMPUTED enrichment (mirrors Supabase contact_communication_profiles
    // — populated by comms_profiler / convex_runner enrich_person job).
    // -----------------------------------------------------------------
    motivation: v.optional(v.string()),             // toward / away
    reference_style: v.optional(v.string()),
    approach: v.optional(v.string()),               // suggested communication approach
    energy: v.optional(v.string()),                 // high / medium / low
    rapport_markers: v.optional(v.array(v.string())),  // phrases observed to land well
    avg_message_length: v.optional(v.number()),
    emoji_frequency: v.optional(v.number()),        // 0.0 - 1.0
    recommendations: v.optional(v.array(v.string())),  // coaching suggestions for next reply
    raw_profile: v.optional(v.any()),               // full LLM analysis blob
    message_count: v.optional(v.number()),
    last_analyzed: v.optional(v.number()),          // unix ms
    observed_response_window: v.optional(v.any()),  // {start_hour, end_hour, p50_minutes, ...}
    julian_style_with_contact: v.optional(v.string()),  // how Julian's voice should mirror this person
    best_channels: v.optional(v.array(v.string())),     // observed-best channels for this person
    contact_history_summary: v.optional(v.string()),
    relationship_dynamic: v.optional(v.string()),
    sentiment_trend: v.optional(v.union(
      v.literal("improving"), v.literal("stable"), v.literal("declining"),
    )),
    avg_sentiment_score: v.optional(v.number()),    // -1.0 to 1.0
    last_sentiment_at: v.optional(v.number()),

    // -----------------------------------------------------------------
    // DATING / TALKING ACTIVITY INDICATORS (Julian: "dating and talking
    // indicators"). Computed from Convex messages + observed reply patterns.
    // Refreshed by enrich_person + a periodic sweep.
    // -----------------------------------------------------------------
    is_actively_dating: v.optional(v.boolean()),    // vibe=dating AND has reciprocal messages last 30d
    is_actively_talking: v.optional(v.boolean()),   // any reciprocal messages last 30d
    engagement_score: v.optional(v.number()),       // 0.0 - 1.0 composite
    response_rate: v.optional(v.number()),          // 0.0 - 1.0 — fraction of your outbound that gets a reply
    avg_response_time_minutes: v.optional(v.number()),
    conversation_temperature: v.optional(v.union(   // OBSERVED state (not target — see cadence_profile)
      v.literal("hot"), v.literal("warm"), v.literal("cool"),
      v.literal("cold"), v.literal("dormant"),
    )),
    days_since_last_reply: v.optional(v.number()),
    total_messages_30d: v.optional(v.number()),

    // -----------------------------------------------------------------
    // TRUST + COURTSHIP INTELLIGENCE (Julian: "build trust and court a
    // girl and the things they like"). Populated by the convex_runner
    // job enrich_courtship after the chat.db backfill — Gemini reads
    // the last 100 messages and outputs structured signals about where
    // the relationship is, what she values, and what your next move
    // should be.
    // -----------------------------------------------------------------
    trust_score: v.optional(v.number()),              // 0.0 - 1.0 — observed trust level
    courtship_stage: v.optional(v.union(
      v.literal("matched"),                            // dating-app match, no number swap yet
      v.literal("early_chat"),                         // exchanging messages, low context
      v.literal("phone_swap"),                         // off the app, on iMessage
      v.literal("pre_date"),                           // confirmed but date hasn't happened
      v.literal("first_date_done"),                    // had one in-person meeting
      v.literal("ongoing"),                            // dating actively, multiple meetings
      v.literal("exclusive"),                          // monogamy / committed
      v.literal("ghosted"),                            // unilateral silence on her end
      v.literal("ended"),                              // explicit end
    )),
    trust_signals_observed: v.optional(v.array(v.string())),    // e.g. ["shares vulnerable details", "follows through on plans"]
    trust_signals_missing: v.optional(v.array(v.string())),     // e.g. ["never initiates", "only talks late at night"]
    things_she_loves: v.optional(v.array(v.string())),          // her stated favorite topics / hooks for the next message
    things_she_dislikes: v.optional(v.array(v.string())),
    boundaries_stated: v.optional(v.array(v.string())),         // explicit "I don't do X" lines she's drawn
    green_flags: v.optional(v.array(v.string())),               // positives observed in the convo
    red_flags: v.optional(v.array(v.string())),                 // warning signs to be aware of
    compliments_that_landed: v.optional(v.array(v.string())),   // past compliments that got positive response
    references_to_callback: v.optional(v.array(v.string())),    // inside jokes / shared memories to invoke
    her_love_languages: v.optional(v.array(v.string())),        // words / time / gifts / acts / touch (1+ if mentioned)
    next_best_move: v.optional(v.string()),                     // 1-sentence Gemini-suggested next message / move
    next_best_move_confidence: v.optional(v.number()),          // 0.0 - 1.0
    courtship_last_analyzed: v.optional(v.number()),            // unix ms of last enrich_courtship run

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

    // Vibe classification — LLM-driven hint for "is this person in the
    // dating ecosystem?". Computed by convex_runner job classify_conversation_vibe
    // against the last 50 messages. Surfaces in the dashboard as a candidate
    // suggestion (NOT auto-applied — Julian still has to add the CC TECH
    // label in Google Contacts to make them a member of the network).
    vibe_classification: v.optional(v.union(
      v.literal("dating"),     // romantic / dating-app context
      v.literal("platonic"),   // friend / family / coach style
      v.literal("professional"),  // work / client / vendor
      v.literal("unclear"),    // not enough signal
    )),
    vibe_confidence: v.optional(v.number()),        // 0.0 - 1.0
    vibe_classified_at: v.optional(v.number()),     // unix ms — last time job ran
    vibe_evidence: v.optional(v.string()),          // 1-2 sentences from Claude explaining

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

  // -----------------------------------------------------------------------
  // AI-9449 Phase A — scheduled_touches (replaces global polling crons).
  //
  // Per-row scheduling: each touch self-schedules via ctx.scheduler.runAt at
  // exactly the right moment instead of a global cron scanning for due rows.
  // Powers ask-for-the-date, logistics cascade, ghost-recovery, hot-fast-track,
  // birthday/event-day, and the daily digest queue.
  //
  // AI-9500 Wave 2.4D — added fired_body_shape for anti-loop dedup.
  // -----------------------------------------------------------------------
  scheduled_touches: defineTable({
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    type: v.union(
      v.literal("reply"),                  // standard cadence reply
      v.literal("nudge"),                  // soft re-engage
      v.literal("callback_reference"),     // "did you end up doing X?"
      v.literal("date_ask"),               // propose a date
      v.literal("date_confirm_24h"),       // T-24h confirmation
      v.literal("date_dayof"),             // T-3h / day-of
      v.literal("date_postmortem"),        // next-morning followup
      v.literal("reengage_low_temp"),      // pattern interrupt at 5+ days silent
      v.literal("birthday_wish"),
      v.literal("event_day_check"),        // her marathon / interview / etc.
      v.literal("pattern_interrupt"),      // unique soft restart
      v.literal("phone_swap_followup"),    // first-call invite 24-72h post-swap
      v.literal("first_call_invite"),
      v.literal("morning_text"),
      v.literal("digest_inclusion"),       // include this person in tomorrow's digest
    ),
    scheduled_for: v.number(),             // unix ms — exact fire time
    status: v.union(
      v.literal("scheduled"),
      v.literal("fired"),
      v.literal("skipped"),                // active-hours / cool-down / boundary
      v.literal("cancelled"),              // superseded by newer state
      v.literal("error"),
    ),
    draft_body: v.optional(v.string()),    // pre-generated draft (or generate at fire time)
    generate_at_fire_time: v.optional(v.boolean()),  // if true, defer body generation
    media_asset_id: v.optional(v.id("media_assets")),
    prompt_template: v.optional(v.string()),         // which template the AI used
    urgency: v.optional(v.union(
      v.literal("hot"), v.literal("warm"), v.literal("cool"),
    )),
    generated_by_run_id: v.optional(v.string()),    // trace id of the enrichment that generated this
    skip_reason: v.optional(v.string()),
    fired_at: v.optional(v.number()),
    // AI-9500 Wave 2.4D — anti-loop fingerprint.
    // sha1( type + ":" + draftBody[0..50] ) stored at fire time so fireOne
    // can detect duplicate-body sends across all people in the last 7 days.
    fired_body_shape: v.optional(v.string()),
    // AI-9500 Wave 2.4G — preview/compose-from-dashboard touches.
    // is_preview=true: dashboard inserted a "draft this for me" row. Mac Mini's
    // draft_preview job_handler fills draft_body and calls touches:setPreviewDraft.
    // touches:commitPreview clears is_preview and runs the standard fireOne path.
    is_preview: v.optional(v.boolean()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_status", ["user_id", "status"])
    .index("by_person_status", ["person_id", "status"])
    .index("by_due", ["status", "scheduled_for"])
    .index("by_conversation", ["conversation_id"])
    .index("by_user_fired_at", ["user_id", "fired_at"]),  // AI-9500D: recent-fired scan

  // -----------------------------------------------------------------------
  // AI-9449 — Media library. Photos / videos / voice memos / memes Julian
  // has approved for AI to send in context. AI selects from this library
  // based on conversation signals and a context-hook match.
  // -----------------------------------------------------------------------
  media_assets: defineTable({
    user_id: v.string(),
    asset_id: v.string(),                              // stable external id
    kind: v.union(
      v.literal("image"), v.literal("video"),
      v.literal("voice_memo"), v.literal("meme"), v.literal("gif"),
    ),
    storage_url: v.string(),
    thumbnail_url: v.optional(v.string()),
    file_size_bytes: v.optional(v.number()),
    mime_type: v.optional(v.string()),
    caption: v.optional(v.string()),
    tags: v.array(v.string()),
    context_hooks: v.array(v.string()),
    approval_status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("deprecated"),
    ),
    used_count: v.optional(v.number()),
    last_used_at_ms: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_status", ["user_id", "approval_status"])
    .index("by_asset_id", ["asset_id"]),
});
