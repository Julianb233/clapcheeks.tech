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
      v.literal("instagram"),
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

    // -----------------------------------------------------------------
    // FEELS-SEEN-HEARD intelligence — populated by enrich_courtship.
    // -----------------------------------------------------------------
    personal_details: v.optional(v.array(v.object({
      fact: v.string(),
      source_msg_external_guid: v.optional(v.string()),
      learned_at: v.number(),
      validated_by_julian: v.optional(v.boolean()),
    }))),
    recent_life_events: v.optional(v.array(v.object({
      event: v.string(),
      date_mentioned_ms: v.number(),
      event_date_estimated_ms: v.optional(v.number()),
      status: v.union(
        v.literal("pending"), v.literal("happened"),
        v.literal("missed"), v.literal("faded"),
      ),
    }))),
    topics_that_lit_her_up: v.optional(v.array(v.object({
      topic: v.string(),
      signal_count: v.number(),
      last_lit_at_ms: v.number(),
      signal_strength: v.optional(v.number()),
    }))),
    curiosity_ledger: v.optional(v.array(v.object({
      question: v.string(),
      topic: v.optional(v.string()),
      priority: v.number(),
      status: v.union(
        v.literal("pending"), v.literal("asked"),
        v.literal("answered"), v.literal("retired"),
      ),
      added_at_ms: v.number(),
      asked_at_ms: v.optional(v.number()),
    }))),
    emotional_state_recent: v.optional(v.array(v.object({
      state: v.union(
        v.literal("stressed"), v.literal("excited"), v.literal("playful"),
        v.literal("vulnerable"), v.literal("flirty"), v.literal("bored"),
        v.literal("tired"), v.literal("proud"), v.literal("anxious"), v.literal("neutral"),
      ),
      intensity: v.number(),
      observed_at_ms: v.number(),
      message_external_guid: v.optional(v.string()),
    }))),

    // -----------------------------------------------------------------
    // Wave 2.4A — Profile-screenshot import enrichment (set when imported).
    // -----------------------------------------------------------------
    age: v.optional(v.number()),
    zodiac_sign: v.optional(v.union(
      v.literal("aries"), v.literal("taurus"), v.literal("gemini"),
      v.literal("cancer"), v.literal("leo"), v.literal("virgo"),
      v.literal("libra"), v.literal("scorpio"), v.literal("sagittarius"),
      v.literal("capricorn"), v.literal("aquarius"), v.literal("pisces"),
    )),
    zodiac_analysis: v.optional(v.string()),
    disc_inference: v.optional(v.string()),
    disc_inference_reasoning: v.optional(v.string()),
    opener_suggestions: v.optional(v.array(v.string())),
    location_observed: v.optional(v.string()),
    occupation_observed: v.optional(v.string()),
    bio_text: v.optional(v.string()),
    profile_prompts_observed: v.optional(v.array(v.object({
      prompt: v.string(),
      answer: v.string(),
    }))),
    photos_observed: v.optional(v.array(v.string())),
    imported_from_profile_screenshot: v.optional(v.boolean()),
    imported_from_platform: v.optional(v.union(
      v.literal("tinder"), v.literal("bumble"), v.literal("hinge"),
      v.literal("instagram"), v.literal("other"),
    )),

    // -----------------------------------------------------------------
    // AI-9500-E — Per-person cadence overrides (auto-tuned weekly).
    // -----------------------------------------------------------------
    cadence_overrides: v.optional(v.object({
      min_reply_gap_ms: v.optional(v.number()),
      max_reply_gap_ms: v.optional(v.number()),
      preferred_send_hour_local: v.optional(v.number()),
      compliment_throttle_ms: v.optional(v.number()),
      banter_density_target: v.optional(v.number()),
      emoji_density_target: v.optional(v.number()),
      message_length_target: v.optional(v.number()),
    })),
    time_to_ask_score: v.optional(v.number()),
    last_ask_attempted_at: v.optional(v.number()),

    // -----------------------------------------------------------------
    // Wave 2.4 Task J — Operator-facing ratings + nurture state.
    // Editable from the dossier page; AI uses these to prioritize attention.
    // -----------------------------------------------------------------
    hotness_rating: v.optional(v.number()),       // 1-10, operator-set
    effort_rating: v.optional(v.number()),        // 1-5, operator's effort budget
    nurture_state: v.optional(v.union(            // explicit nurture mode
      v.literal("active_pursuit"),                // chase, fast cadence, willing to put in
      v.literal("steady"),                        // consistent but not aggressive
      v.literal("nurture"),                       // light-touch keep-warm
      v.literal("dormant"),                       // re-awaken occasionally
      v.literal("close"),                         // wind down — stop sending
    )),
    next_followup_kind: v.optional(v.union(       // what we should send next
      v.literal("reply"),
      v.literal("nudge"),
      v.literal("date_ask"),
      v.literal("pattern_interrupt"),
      v.literal("event_followup"),
      v.literal("none"),
    )),
    operator_notes: v.optional(v.string()),       // free-form notes from dashboard

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

    // AI-9500 #1 — her question-asking ratio over last 7 days. Single best
    // engagement signal. When < 0.15 AND last_inbound > 24h, daemon picks
    // an easy_question_revival template instead of a generic pattern_interrupt.
    her_question_ratio_7d: v.optional(v.number()),
    her_question_ratio_computed_at: v.optional(v.number()),
    // AI-9500 #1 — track consecutive easy_question_revival sends so we don't
    // loop on the same revival pattern.
    easy_question_streak: v.optional(v.number()),

    // AI-9500 Wave2 #A — competition-signal score: how much she's juggling.
    // Computed from reply-time variance + life-event-mention frequency
    // + ghosting-recovery patterns. 0=she's all-in on you, 1=she's juggling 5+ men.
    competition_signal_score: v.optional(v.number()),
    competition_signal_evidence: v.optional(v.string()),
    competition_signal_computed_at: v.optional(v.number()),

    // AI-9500 Wave2 #C — Tier 2 LLM scoring (computed by enrichCourtshipForOne).
    flirtation_level: v.optional(v.number()),                  // 0-10 sexual tension reading
    attachment_style: v.optional(v.union(
      v.literal("anxious"), v.literal("avoidant"),
      v.literal("secure"), v.literal("fearful"), v.literal("unclear"),
    )),
    love_languages_top2: v.optional(v.array(v.union(
      v.literal("words_of_affirmation"), v.literal("acts_of_service"),
      v.literal("receiving_gifts"), v.literal("quality_time"), v.literal("physical_touch"),
    ))),
    ask_yes_prob_now: v.optional(v.number()),                  // 0.0-1.0 predicted yes rate if asked now

    // AI-9500 Wave2 #K — pre-date debrief tag system. tags = freeform short
    // labels operator adds. things_mentioned = LLM-extracted (or operator-added)
    // memory of what she said matters to her — used to brief Julian before a date.
    tags: v.optional(v.array(v.string())),
    things_mentioned: v.optional(v.array(v.object({
      topic: v.string(),
      detail: v.optional(v.string()),
      said_at_ms: v.number(),
      source_msg_id: v.optional(v.id("messages")),
      source: v.optional(v.string()),                          // "auto" | "operator"
    }))),

    // AI-9500 Wave2 #E — cut-workflow lifecycle. Operators can mark a thread
    // formally archived (different from ghosted — operator-initiated). Auto-cut
    // detection runs at 30d ghosted.
    archived_at: v.optional(v.number()),
    archive_reason: v.optional(v.string()),

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
  // AI-9500 #8 — Opener A/B experiments. Every opener fired records 1 row.
  // archetype is a coarse bucket of her profile (DISC + emoji + age band)
  // so we can score variants per-archetype rather than per-person. epsilon-
  // greedy picker reads winner once N >= 30 samples per archetype.
  // -----------------------------------------------------------------------
  opener_experiments: defineTable({
    user_id: v.string(),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    message_id: v.optional(v.id("messages")),
    archetype: v.string(),                  // e.g. "DI:high_emoji:24-29"
    variant_id: v.string(),                 // identifier for the variant prompt path
    variant_kind: v.optional(v.string()),   // "humor" | "callback" | "warm" | "curious"
    body_preview: v.optional(v.string()),   // first 80 chars for offline review
    sent_at: v.number(),
    outcome: v.optional(v.union(
      v.literal("replied_in_4h"),
      v.literal("replied_in_24h"),
      v.literal("replied_later"),
      v.literal("ghosted"),
      v.literal("unknown"),
    )),
    outcome_at: v.optional(v.number()),
    her_first_reply_minutes: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_user", ["user_id"])
    .index("by_archetype", ["archetype"])
    .index("by_user_outcome", ["user_id", "outcome"])
    .index("by_person", ["person_id"]),

  // -----------------------------------------------------------------------
  // AI-9500 #8 — Per-archetype winners. Updated by weekly cohort cron once
  // sample size is sufficient. Convex_runner reads this before firing an
  // opener; falls back to uniform-random if archetype has < 30 samples.
  // -----------------------------------------------------------------------
  opener_winners: defineTable({
    user_id: v.string(),
    archetype: v.string(),
    winning_variant_id: v.string(),
    samples: v.number(),
    win_rate: v.number(),                   // 0.0-1.0
    runner_up_variant_id: v.optional(v.string()),
    confidence: v.optional(v.number()),
    computed_at: v.number(),
  })
    .index("by_user_archetype", ["user_id", "archetype"]),

  // -----------------------------------------------------------------------
  // AI-9500 Wave2 #F — Operator profile singleton. One row per operator;
  // captures their north-star (intent, target roster size, etc.) which
  // shapes every model recommendation. Look up by user_id.
  // -----------------------------------------------------------------------
  operator_profile: defineTable({
    user_id: v.string(),
    your_dating_intent: v.optional(v.union(
      v.literal("serious_relationship"),
      v.literal("serious_with_fwb_openness"),     // Julian's stated goal
      v.literal("casual_exploration"),
      v.literal("sexual_variety_only"),
      v.literal("friendship_pipeline_with_dating"),
      v.literal("unclear"),
    )),
    target_concurrent_active: v.optional(v.number()),  // Julian: 10
    transparency_rule: v.optional(v.string()),         // e.g. "be honest about wanting relationship when she asks"
    home_city: v.optional(v.string()),
    home_tz: v.optional(v.string()),
    self_dietary_prefs: v.optional(v.array(v.string())),
    self_drink_style: v.optional(v.string()),
    operator_notes: v.optional(v.string()),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // -----------------------------------------------------------------------
  // AI-9500 Wave2 #I — Date logistics checklist. When ask_outcome=yes lands,
  // a row is auto-created so operator can tick off pre-date logistics.
  // -----------------------------------------------------------------------
  date_logistics_checklists: defineTable({
    user_id: v.string(),
    person_id: v.id("people"),
    touch_id: v.optional(v.id("scheduled_touches")),  // the date_ask touch this descends from
    date_time_ms: v.number(),
    venue: v.optional(v.string()),
    items: v.array(v.object({
      key: v.string(),                         // "reservation_made" | "meeting_place_sent" | "weather_backup" | "drink_pre_order" | "transit_ping_scheduled" | "outfit_set" | "post_date_recovery_plan"
      label: v.string(),
      done: v.boolean(),
      done_at_ms: v.optional(v.number()),
      notes: v.optional(v.string()),
    })),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_person", ["person_id"])
    .index("by_status", ["status"]),

  // -----------------------------------------------------------------------
  // AI-9500 Wave2 #M — Cohort retro snapshots. One row per retro run.
  // Stores the report so the dashboard can show progression over time.
  // -----------------------------------------------------------------------
  cohort_retros: defineTable({
    user_id: v.string(),
    period_start_ms: v.number(),
    period_end_ms: v.number(),
    summary: v.any(),                          // free-form report blob
    funnel: v.optional(v.object({
      matched: v.number(),
      first_message: v.number(),
      reply: v.number(),
      ongoing_chat: v.number(),
      phone_swap: v.number(),
      first_date_done: v.number(),
      second_date_done: v.number(),
      ongoing: v.number(),
      ended: v.number(),
      ghosted: v.number(),
    })),
    insights: v.optional(v.array(v.string())),  // surprising findings
    computed_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // -----------------------------------------------------------------------
  // AI-9500 Wave2 #E13 — Call log. Twilio + iMessage call detection feed
  // into here. Surfaces in unified thread + on /coach.
  // -----------------------------------------------------------------------
  calls: defineTable({
    user_id: v.string(),
    person_id: v.optional(v.id("people")),
    direction: v.union(v.literal("inbound"), v.literal("outbound"), v.literal("missed")),
    started_at_ms: v.number(),
    duration_seconds: v.optional(v.number()),
    handle_value: v.optional(v.string()),       // phone E.164
    platform: v.optional(v.union(
      v.literal("imessage_native"),
      v.literal("facetime"),
      v.literal("twilio"),
      v.literal("phone_native"),
    )),
    notes: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_person", ["person_id"])
    .index("by_user_started", ["user_id", "started_at_ms"]),

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
      v.literal("date_dayof_transit"),     // AI-9500 #5 — 90min-before transit ping
      v.literal("date_check_in"),          // AI-9500 #5 — 30min-before silence check
      v.literal("date_postmortem"),        // next-morning followup
      v.literal("post_date_calibration"),  // AI-9500 #6 — +18h post-date 3-candidate calibrator
      v.literal("pre_date_debrief"),       // AI-9500 W2 #K — debrief Julian 2h before a date
      v.literal("soft_no_recovery"),       // AI-9500 W2 #B — +14d re-ask after soft_no
      v.literal("voice_memo"),             // AI-9500 W2 #G — send a voice memo at high-leverage moment
      v.literal("reengage_low_temp"),      // pattern interrupt at 5+ days silent
      v.literal("easy_question_revival"),  // AI-9500 #1 — low-effort question to revive cooling
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
    // AI-9500 #2 — ask_outcome tracking. When a date_ask touch fires, the
    // outcome (her reply or 7d ghost) is patched here so the A/B engine
    // can score timing strategies (active-typing-window vs static stagger).
    ask_outcome: v.optional(v.union(
      v.literal("yes"),
      v.literal("soft_no"),
      v.literal("hard_no"),
      v.literal("no_reply"),
    )),
    // AI-9500 #6 — post-date calibrator. date_done_at is set by operator
    // (or auto-detected from calendar) when an actual date completed.
    // date_notes_text is the operator-typed memory of specific moments
    // the post_date_calibration template should reference.
    date_done_at: v.optional(v.number()),
    date_notes_text: v.optional(v.string()),
    // AI-9500 #6 — when fireOne handles post_date_calibration, _draft_with_template
    // returns 3 candidate drafts (callback / photo / generic) instead of 1.
    // The compose UI lets the operator pick one before commitPreview.
    candidate_drafts: v.optional(v.array(v.object({
      kind: v.string(),                  // "callback" | "photo" | "generic"
      body: v.string(),
      reasoning: v.optional(v.string()),
    }))),
    // AI-9500 W2 #B — soft_no recovery tracking. When ask_outcome=soft_no is
    // patched onto a date_ask touch, _scheduleSoftNoRecovery fires and inserts a
    // soft_no_recovery touch +14d. This field records the unix ms when that recovery
    // touch was scheduled (or "skipped" sentinel "-1") so the 6h sweep cron can
    // detect un-processed soft_no touches without re-querying scheduled_touches.
    recovery_scheduled_at: v.optional(v.number()),
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
    vibe: v.optional(v.union(
      v.literal("playful"), v.literal("flex"), v.literal("vulnerable"),
      v.literal("funny"), v.literal("adventurous"), v.literal("romantic"),
      v.literal("mundane"),
    )),
    flex_level: v.optional(v.number()),
    smile_detected: v.optional(v.boolean()),
    with_friends: v.optional(v.boolean()),
    with_pet: v.optional(v.boolean()),
    upload_source: v.optional(v.union(
      v.literal("iphone"), v.literal("google_drive"),
      v.literal("manual"), v.literal("vps_cli"),
    )),
    approval_status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("deprecated"),
    ),
    auto_tag_run_id: v.optional(v.string()),
    // Wave 2.4A — profile screenshot mode.
    analysis_kind: v.optional(v.union(
      v.literal("media"),
      v.literal("profile_screenshot"),
    )),
    profile_screenshot_data: v.optional(v.any()),
    profile_imported_to_person_id: v.optional(v.id("people")),
    used_count: v.optional(v.number()),
    last_used_at_ms: v.optional(v.number()),
    last_used_with_person_id: v.optional(v.id("people")),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_status", ["user_id", "approval_status"])
    .index("by_asset_id", ["asset_id"]),

  // -----------------------------------------------------------------------
  // AI-9449 Wave 2.2 — calendar_slots cache.
  // Mac Mini periodically pulls Julian's gws calendars and writes free-busy
  // windows here. Date-ask drafts read from this so AI never proposes a
  // time he's already booked.
  // -----------------------------------------------------------------------
  calendar_slots: defineTable({
    user_id: v.string(),
    slot_start_ms: v.number(),
    slot_end_ms: v.number(),
    slot_kind: v.union(
      v.literal("free"),
      v.literal("busy"),
      v.literal("date_proposed"),
      v.literal("date_confirmed"),
    ),
    label_local: v.optional(v.string()),
    proposed_to_person_id: v.optional(v.id("people")),
    fetched_at_ms: v.number(),
  })
    .index("by_user_start", ["user_id", "slot_start_ms"])
    .index("by_user_kind", ["user_id", "slot_kind"]),

  // Tracks asset usage to prevent repeats per girl + cool-down across girls.
  media_uses: defineTable({
    user_id: v.string(),
    asset_id: v.id("media_assets"),
    person_id: v.id("people"),
    conversation_id: v.optional(v.id("conversations")),
    sent_at: v.number(),
    message_external_guid: v.optional(v.string()),
    fire_context: v.optional(v.string()),
  })
    .index("by_user_recent", ["user_id", "sent_at"])
    .index("by_asset", ["asset_id"])
    .index("by_person", ["person_id"]),

  // -----------------------------------------------------------------------
  // AI-9524 — Platform auth-token vault. Replaces Supabase
  // clapcheeks_user_settings.{tinder,hinge,instagram}_auth_token_enc and
  // bumble_session_enc. The ciphertext is AES-256-GCM produced by
  // web/lib/crypto/token-vault.ts (Node) or clapcheeks/auth/token_vault.py
  // (Python) — wire-compatible. Decryption happens client-side (the VPS
  // daemon already has CLAPCHEEKS_TOKEN_MASTER_KEY).
  //
  // One row per (user_id, platform). The composite index by_user_platform
  // lets the upsert lookup a single row in a single fetch.
  // -----------------------------------------------------------------------
  platform_tokens: defineTable({
    user_id: v.string(),                 // Supabase auth uuid (existing identifier)
    platform: v.union(
      v.literal("tinder"),
      v.literal("hinge"),
      v.literal("instagram"),
      v.literal("bumble"),
    ),
    ciphertext: v.bytes(),               // AES-256-GCM blob (wire format from token-vault.ts)
    enc_version: v.number(),             // currently 1
    source: v.string(),                  // "chrome-extension" | "mitmproxy-mac-mini" | "manual" | "supabase-backfill-*"
    updated_at: v.number(),              // unix ms
    device_name: v.optional(v.string()),
  })
    .index("by_user_platform", ["user_id", "platform"])
    .index("by_user", ["user_id"]),

  // -----------------------------------------------------------------------
  // AI-9524 — Device tokens for the Chrome extension + Mac Mini mitmproxy
  // ingest path. Replaces Supabase clapcheeks_agent_tokens. Each opaque
  // token is bound to a user_id; the ingest endpoint validates by token
  // before writing platform_tokens.
  // -----------------------------------------------------------------------
  agent_device_tokens: defineTable({
    token: v.string(),                   // opaque random string (32+ bytes base64)
    user_id: v.string(),
    device_name: v.optional(v.string()),
    last_seen_at: v.optional(v.number()),
    created_at: v.number(),
    revoked: v.boolean(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["user_id"]),

  // --------------------------------------------------------------------------
  // AI-9535 outbound migration — tables migrated from Supabase off the legacy
  // clapcheeks_* schemas. These mirror the public.clapcheeks_* shapes 1:1 so
  // the existing Next.js routes + Mac Mini Python pollers can swap call sites
  // with minimal logic changes. Auth still resolves user_id via Supabase.
  // --------------------------------------------------------------------------

  // AI-9535 outbound migration — replaces public.clapcheeks_scheduled_messages
  // (legacy match-name-keyed scheduled outbound messages — separate from the
  // AI-9196 conversation-keyed `scheduled_messages` table above).
  outbound_scheduled_messages: defineTable({
    user_id: v.string(),                  // Supabase auth uuid
    match_id: v.optional(v.string()),     // platform-specific match id (text)
    match_name: v.string(),
    platform: v.string(),                 // "iMessage", "tinder", "hinge", etc.
    phone: v.optional(v.string()),
    message_text: v.string(),
    scheduled_at: v.number(),             // unix ms (was timestamptz on Postgres)
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    sequence_type: v.union(
      v.literal("follow_up"),
      v.literal("manual"),
      v.literal("app_to_text"),
    ),
    sequence_step: v.optional(v.number()),
    delay_hours: v.optional(v.number()),
    rejection_reason: v.optional(v.string()),
    sent_at: v.optional(v.number()),
    god_draft_id: v.optional(v.string()),
    legacy_id: v.optional(v.string()),    // backfill: original Supabase UUID
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_status", ["user_id", "status"])
    .index("by_user_match", ["user_id", "match_id"])
    .index("by_status_due", ["status", "scheduled_at"])
    .index("by_legacy_id", ["legacy_id"]),

  // AI-9535 outbound migration — replaces public.clapcheeks_followup_sequences
  // (per-user drip cadence config). One row per user_id (uniqueness enforced
  // in mutation logic, not at index level).
  followup_sequences: defineTable({
    user_id: v.string(),
    enabled: v.boolean(),
    delays_hours: v.array(v.number()),    // ordered list, e.g. [24, 72, 168]
    max_followups: v.number(),
    app_to_text_enabled: v.boolean(),
    warmth_threshold: v.number(),         // 0..1
    min_messages_before_transition: v.number(),
    optimal_send_start_hour: v.number(),  // 0-23
    optimal_send_end_hour: v.number(),
    quiet_hours_start: v.number(),
    quiet_hours_end: v.number(),
    timezone: v.string(),
    legacy_id: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_legacy_id", ["legacy_id"]),

  // AI-9535 outbound migration — replaces public.clapcheeks_queued_replies.
  // Operator-approved or AI-drafted iMessage queue consumed by the Mac Mini
  // queue_poller within ~30s.
  queued_replies: defineTable({
    user_id: v.string(),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    text: v.optional(v.string()),         // legacy column name
    body: v.optional(v.string()),         // newer column name (imessage/test)
    recipient_handle: v.optional(v.string()),
    source: v.optional(v.string()),       // "web_test", "drip", "ai_suggestion", etc.
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    legacy_id: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_user_status", ["user_id", "status"])
    .index("by_user_created", ["user_id", "created_at"])
    .index("by_user_source", ["user_id", "source"])
    .index("by_legacy_id", ["legacy_id"]),

  // AI-9535 outbound migration — replaces public.clapcheeks_posting_queue.
  // 7-day rolling outbound posting schedule consumed by the publisher.
  posting_queue: defineTable({
    user_id: v.string(),
    content_library_id: v.string(),       // FK to clapcheeks_content_library on PG; remains string until that table migrates
    scheduled_for: v.number(),            // unix ms
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("posted"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    agent_job_id: v.optional(v.string()), // FK to agent_jobs row id (text); null until claimed
    posted_at: v.optional(v.number()),
    error: v.optional(v.string()),
    legacy_id: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_status_due", ["status", "scheduled_for"])
    .index("by_user_scheduled", ["user_id", "scheduled_for"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_content_library", ["content_library_id"])
    .index("by_legacy_id", ["legacy_id"]),

  // AI-9535 outbound migration — replaces public.clapcheeks_approval_queue.
  // Generic per-action approval queue used by the autonomy engine. Operator
  // approves/rejects via /autonomy dashboard.
  approval_queue: defineTable({
    user_id: v.string(),
    action_type: v.string(),
    match_id: v.optional(v.string()),
    match_name: v.optional(v.string()),
    platform: v.optional(v.string()),
    proposed_text: v.optional(v.string()),
    proposed_data: v.optional(v.any()),
    confidence: v.number(),               // 0..1
    ai_reasoning: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    expires_at: v.number(),               // unix ms
    decided_at: v.optional(v.number()),
    legacy_id: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_user_status", ["user_id", "status"])
    .index("by_status_expires", ["status", "expires_at"])
    .index("by_legacy_id", ["legacy_id"]),

  // --------------------------------------------------------------------------
  // AI-9537 billing+misc migration
  // Replaces Supabase tables: clapcheeks_subscriptions, dunning_events,
  // clapcheeks_voice_profiles, user_voice_context, clapcheeks_notification_prefs,
  // clapcheeks_outbound_notifications, clapcheeks_push_queue,
  // clapcheeks_report_preferences, clapcheeks_coaching_sessions,
  // clapcheeks_tip_feedback, clapcheeks_memos, clapcheeks_referrals,
  // notifications, devices, google_calendar_tokens.
  //
  // Stripe webhook reliability: subscriptions + dunning_events run in
  // parallel-write mode (Supabase + Convex) on first deploy cycle, reads
  // can flip to Convex once parity is confirmed.
  // --------------------------------------------------------------------------

  // AI-9537 — Stripe subscription state per user. Mirror of Supabase
  // clapcheeks_subscriptions. Money-flow: read by dashboard / weekly reports
  // cron / dogfood / usage gates. Writes happen on Stripe webhook + admin
  // tooling (parallel-write window).
  subscriptions: defineTable({
    user_id: v.string(),                      // Supabase auth uuid
    stripe_subscription_id: v.optional(v.string()),
    plan: v.union(
      v.literal("starter"),
      v.literal("pro"),
      v.literal("elite"),
    ),
    status: v.string(),                       // active | past_due | canceled | trialing | ...
    current_period_start: v.optional(v.number()),  // unix ms
    current_period_end: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_stripe_id", ["stripe_subscription_id"])
    .index("by_status", ["status"]),

  // AI-9537 — Failed-payment / grace-period / recovery audit log.
  // Reads: admin dashboards, dunning cron. Writes: stripe webhook +
  // dunning helper.
  dunning_events: defineTable({
    user_id: v.optional(v.string()),
    stripe_customer_id: v.optional(v.string()),
    stripe_invoice_id: v.optional(v.string()),
    event_type: v.union(
      v.literal("payment_failed"),
      v.literal("payment_recovered"),
      v.literal("grace_period_expired"),
      v.literal("manual_retry"),
      v.literal("subscription_canceled"),
    ),
    attempt_number: v.optional(v.number()),
    grace_period_end: v.optional(v.number()),  // unix ms
    metadata: v.optional(v.any()),
    created_at: v.number(),
  })
    .index("by_user_ts", ["user_id", "created_at"])
    .index("by_customer_ts", ["stripe_customer_id", "created_at"]),

  // AI-9537 — Voice cloning settings per user (replaces clapcheeks_voice_profiles).
  voice_profiles: defineTable({
    user_id: v.string(),
    style_summary: v.optional(v.string()),
    sample_phrases: v.optional(v.array(v.any())),
    tone: v.optional(v.string()),                 // casual | formal | playful
    profile_data: v.optional(v.any()),
    messages_analyzed: v.optional(v.number()),
    digest: v.optional(v.any()),                  // chat.db-derived style digest
    boosted_samples: v.optional(v.any()),
    last_scan_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // AI-9537 — AI First Date interview answers / voice context corpus
  // (replaces user_voice_context).
  voice_context: defineTable({
    user_id: v.string(),
    answers: v.optional(v.any()),                 // {question_id: answer}
    summary: v.optional(v.string()),
    persona_blob: v.optional(v.string()),
    completed_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // AI-9537 — Notification on/off per channel per event-type
  // (replaces clapcheeks_notification_prefs).
  notification_prefs: defineTable({
    user_id: v.string(),
    email: v.optional(v.string()),
    phone_e164: v.optional(v.string()),
    channels_per_event: v.any(),                  // {event_type: [channel_ids]}
    quiet_hours_start: v.number(),                // 0-23
    quiet_hours_end: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // AI-9537 — iMessage outbound queue
  // (replaces clapcheeks_outbound_notifications).
  outbound_notifications: defineTable({
    user_id: v.string(),
    channel: v.string(),                          // "imessage"
    phone_e164: v.string(),
    body: v.string(),
    event_type: v.optional(v.string()),
    status: v.string(),                           // pending | sent | failed
    attempts: v.number(),
    last_error: v.optional(v.string()),
    created_at: v.number(),
    sent_at: v.optional(v.number()),
  })
    .index("by_user_pending", ["user_id", "status", "created_at"]),

  // AI-9537 — Web push queue (replaces clapcheeks_push_queue).
  push_queue: defineTable({
    user_id: v.string(),
    title: v.string(),
    body: v.string(),
    event_type: v.optional(v.string()),
    payload: v.optional(v.any()),
    status: v.string(),                           // pending | sent | failed
    created_at: v.number(),
    sent_at: v.optional(v.number()),
  })
    .index("by_user_pending", ["user_id", "status", "created_at"]),

  // AI-9537 — Weekly report email settings
  // (replaces clapcheeks_report_preferences).
  report_preferences: defineTable({
    user_id: v.string(),
    email_enabled: v.boolean(),
    send_day: v.string(),                         // monday..sunday
    send_hour: v.number(),                        // 0-23
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"]),

  // AI-9537 — AI coaching session transcripts (one per user per week_start).
  // Replaces clapcheeks_coaching_sessions.
  coaching_sessions: defineTable({
    user_id: v.string(),
    generated_at: v.number(),
    week_start: v.string(),                       // ISO date YYYY-MM-DD
    tips: v.any(),                                // JSON array
    stats_snapshot: v.optional(v.any()),
    feedback_score: v.optional(v.number()),
    model_used: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_week", ["user_id", "week_start"]),

  // AI-9537 — Per-tip feedback (helpful y/n) per coaching session.
  tip_feedback: defineTable({
    user_id: v.string(),
    coaching_session_id: v.id("coaching_sessions"),
    tip_index: v.number(),
    helpful: v.boolean(),
    created_at: v.number(),
  })
    .index("by_session", ["coaching_session_id"])
    .index("by_user_session_tip", ["user_id", "coaching_session_id", "tip_index"]),

  // AI-9537 — Operator memo history per contact handle (replaces clapcheeks_memos).
  memos: defineTable({
    user_id: v.string(),
    contact_handle: v.string(),                   // E.164 phone or "tinder:abc123"
    content: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user_handle", ["user_id", "contact_handle"]),

  // AI-9537 — Referral codes / credits (replaces clapcheeks_referrals).
  referrals: defineTable({
    referrer_id: v.string(),
    referred_id: v.optional(v.string()),
    referral_code: v.string(),
    status: v.string(),                           // pending | converted | rewarded
    converted_at: v.optional(v.number()),
    rewarded_at: v.optional(v.number()),
    created_at: v.number(),
  })
    .index("by_referrer", ["referrer_id"])
    .index("by_code", ["referral_code"])
    .index("by_referred", ["referred_id"]),

  // AI-9537 — In-app notification list (replaces public.notifications).
  notifications: defineTable({
    user_id: v.string(),
    title: v.string(),
    message: v.optional(v.string()),
    type: v.optional(v.string()),
    read: v.boolean(),
    action_url: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_user_unread", ["user_id", "read"])
    .index("by_user_recent", ["user_id", "created_at"]),

  // AI-9537 — Registered iOS / Mac devices per user (replaces public.devices).
  devices: defineTable({
    user_id: v.string(),
    device_name: v.string(),
    platform: v.string(),                         // ios | mac | linux | windows | other
    agent_version: v.optional(v.string()),
    last_seen_at: v.number(),
    is_active: v.boolean(),
    created_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_user_active", ["user_id", "is_active"]),

  // AI-9537 — Google Calendar OAuth refresh tokens (replaces google_calendar_tokens).
  // SENSITIVE: refresh_token + access_token MUST be encrypted at rest with
  // the same per-user AES-256-GCM key vault used for platform_tokens
  // (web/lib/crypto/token-vault.ts).
  google_calendar_tokens: defineTable({
    user_id: v.string(),
    google_email: v.string(),
    google_sub: v.optional(v.string()),
    // Encrypted access_token — rotates on refresh.
    access_token_encrypted: v.bytes(),
    // Encrypted long-lived refresh_token — never plaintext at rest.
    refresh_token_encrypted: v.bytes(),
    enc_version: v.number(),                      // currently 1
    expires_at: v.number(),                       // unix ms
    scopes: v.array(v.string()),
    calendar_id: v.string(),                      // default "primary"
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_user", ["user_id"])
    .index("by_email", ["google_email"]),

  // =====================================================================
  // BEGIN AI-9526 (matches-on-convex) — owned by AI-9526-matches-on-convex
  // Sibling agent (AI-9526-outbound-on-convex) owns clapcheeks_scheduled_messages
  // / clapcheeks_followup_sequences / clapcheeks_queued_replies /
  // clapcheeks_posting_queue / clapcheeks_approval_queue. Don't touch those.
  // =====================================================================

  // -----------------------------------------------------------------------
  // AI-9526 — Match metadata + photos. Replaces Supabase clapcheeks_matches.
  // Photo binaries move from Supabase Storage bucket `clapcheeks-match-photos`
  // (or `match-photos`) into Convex File Storage. The URL field is preserved
  // for backward-compat during the migration window (rollback insurance).
  //
  // Auth still lives on Supabase (supabase.auth.getUser); user_id is the
  // Supabase auth uuid. Idempotent upsert key: (user_id, platform, external_match_id).
  // -----------------------------------------------------------------------
  matches: defineTable({
    user_id: v.string(),                          // Supabase auth uuid
    external_match_id: v.string(),                // platform's id (Tinder _id, Hinge id, etc.)
    platform: v.union(
      v.literal("hinge"),
      v.literal("tinder"),
      v.literal("bumble"),
      v.literal("imessage"),
      v.literal("offline"),                        // OfflineContactForm path
    ),
    person_id: v.optional(v.id("people")),        // unified-person link (AI-9449)
    match_name: v.optional(v.string()),
    name: v.optional(v.string()),
    age: v.optional(v.number()),
    bio: v.optional(v.string()),
    status: v.optional(v.string()),               // 'new' | 'opened' | 'conversing' | 'stalled' | 'date_proposed' | 'date_booked' | 'dated' | 'ghosted'
    photos: v.optional(v.array(v.object({         // photos_jsonb flattened to typed array
      storage_id: v.optional(v.id("_storage")),   // Convex File Storage ID (preferred)
      url: v.optional(v.string()),                 // direct URL when not in storage
      supabase_path: v.optional(v.string()),       // legacy Supabase Storage path (rollback)
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      primary: v.optional(v.boolean()),
      idx: v.optional(v.number()),
    }))),
    instagram_handle: v.optional(v.string()),
    zodiac: v.optional(v.string()),
    job: v.optional(v.string()),
    school: v.optional(v.string()),
    stage: v.optional(v.string()),                // RosterStage
    health_score: v.optional(v.number()),
    final_score: v.optional(v.number()),
    julian_rank: v.optional(v.number()),
    match_intel: v.optional(v.any()),             // jsonb blob
    attributes: v.optional(v.any()),              // AI-8814 attribute tags blob
    created_at: v.number(),
    updated_at: v.number(),
    last_activity_at: v.optional(v.number()),
    // Optional: Supabase-source tracking so backfill is idempotent + auditable
    supabase_match_id: v.optional(v.string()),    // original public.clapcheeks_matches.id
  })
    .index("by_user_platform_external", ["user_id", "platform", "external_match_id"])
    .index("by_user_rank", ["user_id", "julian_rank"])
    .index("by_user_last_activity", ["user_id", "last_activity_at"])
    .index("by_user", ["user_id"])
    .index("by_user_status", ["user_id", "status"])
    .index("by_supabase_match_id", ["supabase_match_id"]),
  // ---------------------------------------------------------------------
  // END AI-9526 (matches-on-convex)
  // ---------------------------------------------------------------------

  // AI-9536 telemetry migration -----------------------------------------
  //
  // Replaces 6 Supabase telemetry / report tables. Each table here is
  // index-tuned for the high-write paths the Mac Mini agent and the web
  // dashboard hit constantly. day_iso is "YYYY-MM-DD" so range queries
  // stay lexicographic; ts is unix ms (float64) for sub-day granularity.
  //
  // Source migrations:
  //   analytics_daily   ← clapcheeks_analytics_daily (rename of analytics_daily, mig 9 + 30002)
  //   weekly_reports    ← clapcheeks_weekly_reports  (mig 12 / archived 009_reports)
  //   agent_events      ← clapcheeks_agent_events    (mig 8)
  //   usage_daily       ← clapcheeks_usage_daily     (mig 12 / archived 008_usage_limits)
  //   friction_points   ← clapcheeks_friction_points (mig 20260420600000)
  //   device_heartbeats ← clapcheeks_device_heartbeats (mig 20260428080000)
  // ---------------------------------------------------------------------

  // AI-9536 telemetry migration — clapcheeks_analytics_daily
  // Per-(user, app, day) rollup of swipes/matches/messages/dates/spend.
  // Upserted by Mac Mini match_sync.py + dashboard read paths.
  analytics_daily: defineTable({
    user_id: v.string(),                   // Supabase auth uuid string
    day_iso: v.string(),                   // "YYYY-MM-DD" (Pacific local convention)
    app: v.union(
      v.literal("tinder"),
      v.literal("bumble"),
      v.literal("hinge"),
    ),
    swipes_right: v.number(),
    swipes_left: v.number(),
    matches: v.number(),
    conversations_started: v.number(),
    dates_booked: v.number(),
    money_spent: v.number(),               // USD numeric
    created_at: v.number(),                // unix ms
    updated_at: v.number(),                // unix ms
  })
    // by_user_day: dashboard reads "last 30 days for user X"
    .index("by_user_day", ["user_id", "day_iso"])
    // by_user_app_day: idempotent upsert key
    .index("by_user_app_day", ["user_id", "app", "day_iso"]),

  // AI-9536 telemetry migration — clapcheeks_weekly_reports
  // One row per (user, week_start). Stores generated digest snapshot + PDF.
  weekly_reports: defineTable({
    user_id: v.string(),
    week_start_ms: v.number(),             // unix ms — Monday 00:00 local
    week_end_ms: v.number(),               // unix ms — Sunday 23:59 local
    week_start_iso: v.string(),            // "YYYY-MM-DD" for human queries
    metrics_snapshot: v.any(),             // JSONB blob — flexible schema
    pdf_url: v.optional(v.string()),
    sent_at: v.optional(v.number()),       // unix ms when delivered
    report_type: v.optional(v.string()),   // "standard" | "dogfood" | "weekly"
    created_at: v.number(),
  })
    // by_user_week: idempotent upsert + most-recent-report query
    .index("by_user_week", ["user_id", "week_start_ms"])
    // by_user_week_iso: legacy date-string lookup path
    .index("by_user_week_iso", ["user_id", "week_start_iso"]),

  // AI-9536 telemetry migration — clapcheeks_agent_events
  // Granular event log. HIGH WRITE VOLUME — Mac agent emits on every
  // swipe/match/error/session event. Index for write throughput first.
  agent_events: defineTable({
    user_id: v.string(),
    event_type: v.string(),                // "match_received", "swipe_left", "ban_detected", ...
    platform: v.optional(v.string()),      // "tinder" | "bumble" | "hinge" | null
    data: v.optional(v.any()),             // JSONB payload — schema-free
    occurred_at: v.optional(v.number()),   // unix ms — when it happened on the daemon
    ts: v.number(),                        // unix ms — server-assigned, used for ordering
  })
    // by_user_ts: feed query "events for user X newest-first"
    .index("by_user_ts", ["user_id", "ts"])
    // by_user_type_ts: filtered feed (admin events page)
    .index("by_user_type_ts", ["user_id", "event_type", "ts"])
    // by_type_ts: cross-user admin feed
    .index("by_type_ts", ["event_type", "ts"]),

  // AI-9536 telemetry migration — clapcheeks_usage_daily
  // Per-(user, day) billing-adjacent counters. Bumped by lib/usage.ts.
  // Increments come from web requests so write rate ≈ user actions / day.
  usage_daily: defineTable({
    user_id: v.string(),
    day_iso: v.string(),                   // "YYYY-MM-DD"
    swipes_used: v.number(),
    coaching_calls_used: v.number(),
    ai_replies_used: v.number(),
    created_at: v.number(),
    updated_at: v.number(),
  })
    // by_user_day: idempotent upsert + lookup path for checkLimit/getUsageSummary
    .index("by_user_day", ["user_id", "day_iso"]),

  // AI-9536 telemetry migration — clapcheeks_friction_points
  // UX-friction event log from the dogfood instrumentation.
  friction_points: defineTable({
    user_id: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    severity: v.union(
      v.literal("blocker"),
      v.literal("major"),
      v.literal("minor"),
      v.literal("cosmetic"),
    ),
    category: v.union(
      v.literal("swiping"),
      v.literal("conversation"),
      v.literal("agent_setup"),
      v.literal("auth"),
      v.literal("stripe"),
      v.literal("dashboard"),
      v.literal("reports"),
      v.literal("performance"),
      v.literal("crash"),
      v.literal("ux"),
      v.literal("other"),
    ),
    platform: v.optional(v.string()),
    auto_detected: v.boolean(),
    context: v.optional(v.any()),          // free-form JSONB
    resolved: v.boolean(),
    resolution: v.optional(v.string()),
    resolved_at: v.optional(v.number()),
    created_at: v.number(),
  })
    .index("by_user_created", ["user_id", "created_at"])
    .index("by_user_resolved", ["user_id", "resolved"])
    .index("by_user_severity", ["user_id", "severity"]),

  // AI-9536 telemetry migration — clapcheeks_device_heartbeats
  // One row per agent_device_token; upserted on every heartbeat.
  device_heartbeats: defineTable({
    device_token_id: v.id("agent_device_tokens"),  // FK into agent_device_tokens
    user_id: v.string(),
    device_id: v.optional(v.string()),     // friendly device label, echoed from POST body
    daemon_version: v.optional(v.string()),
    last_sync_at: v.optional(v.number()),  // unix ms
    errors_jsonb: v.optional(v.any()),
    last_heartbeat_at: v.number(),         // unix ms — fast staleness query
    created_at: v.number(),
  })
    // by_device: upsert key — one row per token
    .index("by_device", ["device_token_id"])
    // by_user_heartbeat: dashboard "most recent heartbeat for user X"
    .index("by_user_heartbeat", ["user_id", "last_heartbeat_at"]),
});
