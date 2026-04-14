# Milestone 9 Requirements: Personal Dating Command Center (v0.9)

> Checkable requirements for transforming ClapCheeks into Julian's personal dating command center.

---

## Phase 39 — Match Profile Engine

### PROFILE-01: Match Profiles Table [P0]
New `match_profiles` Supabase table storing enriched data per match: name, phone, birthday, zodiac_sign, zodiac_element, zodiac_compatibility_score, ig_handle, ig_bio, ig_interests (JSONB), ig_photos (JSONB), ig_follower_count, ig_scraped_at, pipeline_stage (enum: new/talking/number_got/date_planned/dated/ranked), attraction_score (1-10), conversation_score (1-10), effort_score (1-10), overall_rank, communication_profile (JSONB), strategy_notes, source_platform, created_at, updated_at.
**Verify:** `SELECT * FROM match_profiles LIMIT 1` returns row with all columns. RLS policy restricts to authenticated user.

### PROFILE-02: Zodiac Calculation Engine [P0]
Pure TypeScript module that takes a date of birth and returns: sun sign, element (fire/earth/air/water), modality (cardinal/fixed/mutable), ruling planet, key traits array, and communication style hints.
**Verify:** Unit tests pass for all 12 signs including edge dates (cusps). `getZodiac('1990-11-15')` returns `{ sign: 'Scorpio', element: 'Water', modality: 'Fixed', ... }`.

### PROFILE-03: Zodiac Compatibility Scoring [P0]
Takes two zodiac signs and returns compatibility score (0-100) with breakdown: emotional, communication, physical, overall. Includes text explanation.
**Verify:** `getCompatibility('Leo', 'Sagittarius')` returns score > 80 (fire-fire). `getCompatibility('Aries', 'Cancer')` returns score < 50 (fire-water tension). All 144 pairings return valid scores.

### PROFILE-04: Instagram Profile Scraper [P0]
Given an IG handle, uses Browserbase to scrape: bio text, follower/following count, post count, recent post captions (last 12), profile photo URL. Returns structured JSON.
**Verify:** Scrape a public IG profile. Returns bio, follower count, and at least 6 post captions. Handles private profiles gracefully (returns `{ private: true, bio: "..." }`).

### PROFILE-05: Instagram Interest Extraction [P1]
Takes scraped IG data and uses Claude to extract: hobbies, travel destinations mentioned, food/drink preferences, music/entertainment, fitness activities, aesthetic style, red flags, conversation hooks.
**Verify:** Given IG data with travel photos and fitness posts, extraction returns relevant hobbies and at least 3 conversation hooks.

### PROFILE-06: Communication Profile Builder [P0]
Analyzes available data (IG, conversation history, manual notes) and generates a dating-context communication profile: estimated DISC type, preferred communication style (emoji-heavy vs. dry wit), response timing patterns, topics that get engagement, topics to avoid, suggested approach.
**Verify:** Given a match with IG data and 10+ messages, profile includes at least: DISC estimate, 3 topic recommendations, 2 avoid topics, and suggested opener style.

### PROFILE-07: Add Match Flow [P0]
UI form to add a new match: name (required), source platform (Tinder/Bumble/Hinge/IRL/Other), phone (optional), birthday (optional — auto-calculates zodiac), IG handle (optional — triggers scrape), notes. Saves to `match_profiles` and auto-generates communication profile if enough data.
**Verify:** Add match with name + birthday + IG handle. Profile card shows zodiac sign, compatibility score, and scraped IG interests within 30 seconds.

---

## Phase 40 — Pipeline Dashboard

### PIPE-01: Kanban Pipeline View [P0]
Drag-and-drop Kanban board with columns: New → Talking → Number Got → Date Planned → Dated → Ranked. Each card shows: name, photo (from IG or placeholder), zodiac sign icon, compatibility score badge, days in stage, source platform icon.
**Verify:** Load dashboard with 5+ matches across different stages. Drag a card from "Talking" to "Number Got" — stage updates in DB and persists on refresh.

### PIPE-02: Match Profile Cards [P0]
Expandable card for each match showing: photo, name, zodiac (sign + element + compatibility), IG summary (bio + interests), communication profile summary, conversation strategy, pipeline stage, all scores (attraction/conversation/effort/overall), notes, and action buttons (message, schedule, move stage).
**Verify:** Click a match card. All sections render. Edit attraction score from 6 to 8 — saves immediately.

### PIPE-03: Ranking System [P0]
Multi-dimension ranking with sliders: attraction (1-10), conversation quality (1-10), compatibility (auto from zodiac + comms profile), effort level (1-10 — how much work to maintain), overall (weighted composite). Leaderboard view sorted by overall rank.
**Verify:** Rate 5 matches on all dimensions. Leaderboard shows correct ordering. Change one score — rank recalculates.

### PIPE-04: Filter & Sort [P1]
Filter matches by: pipeline stage, zodiac sign, zodiac element, source platform, score range, date range added. Sort by: overall rank, compatibility, most recent activity, days since last message.
**Verify:** Filter by "Water signs only" — shows only Cancer/Scorpio/Pisces matches. Sort by compatibility descending — highest first.

### PIPE-05: Mobile-First Responsive [P0]
Dashboard works on iPhone 14/15 screen sizes. Cards stack vertically. Kanban scrolls horizontally. Tap to expand cards. Swipe gestures for quick actions (swipe right = advance stage, swipe left = archive).
**Verify:** Open on mobile viewport (390x844). All content readable without horizontal scroll. Pipeline columns swipe smoothly.

---

## Phase 41 — Conversation Intelligence

### CONV-01: Message Analysis Engine [P0]
Ingests conversation history (from `outward_conversations` or manual paste) and extracts: topics discussed, sentiment trend, engagement level per topic, response time patterns, emoji frequency, question-to-statement ratio, flirtation level.
**Verify:** Analyze a 20-message conversation. Output includes topic list, sentiment score, and identified engagement peaks.

### CONV-02: Strategy Generator [P0]
Given a match's full profile (zodiac, IG interests, conversation analysis, communication profile), generates a dating strategy: 5 conversation topics to try, 3 topics to avoid, suggested message tone, ideal message length, best time to message, and a "move to text" readiness score (0-100).
**Verify:** Generate strategy for a match with full profile data. All 5 topics are specific to the match (not generic). Move-to-text score reflects conversation warmth.

### CONV-03: Reply Drafter [P0]
Given conversation context + strategy, drafts 3 reply options in Julian's voice: one playful, one direct, one question-based. Each reply includes a brief rationale.
**Verify:** Given a conversation where match asked about weekend plans, all 3 replies are contextually relevant, distinct in tone, and sound natural (not AI-generic).

### CONV-04: Voice Profile Calibration [P1]
Analyze Julian's actual texting style from iMessage history to calibrate voice: vocabulary, humor style, emoji usage, typical message length, flirtation patterns. Store as reusable voice profile.
**Verify:** Compare AI-drafted reply to 5 real Julian messages. Style consistency score > 70% (measured by vocabulary overlap + length similarity).

### CONV-05: Red Flag Detection [P1]
Automatically flag concerning patterns: one-word responses consistently, never initiates, asks for money/follows, catfish indicators (reverse image search hints), love-bombing, inconsistent stories.
**Verify:** Given a conversation with 80% one-word replies, flags "low effort" warning. Given a conversation asking for Venmo, flags "financial red flag."

---

## Phase 42 — Scheduled Messaging

### SCHED-01: Follow-Up Sequences [P0]
Create message sequences with configurable delays: "If no reply in X hours/days, send follow-up Y." Supports up to 3 follow-ups per match. Each follow-up is AI-drafted based on context.
**Verify:** Set 48-hour follow-up for a match. After 48 hours (or simulated), follow-up draft appears in approval queue.

### SCHED-02: god draft Integration [P0]
Scheduled messages sent via `god draft` command for iMessage delivery. Messages queue with exact send time. Status tracking: queued → sent → delivered → read (if available).
**Verify:** Schedule a message for 10 minutes from now. `god draft` fires at scheduled time. Message appears in iMessage.

### SCHED-03: Optimal Send Timing [P1]
Analyze match's response patterns to determine best send window (e.g., "responds fastest between 8-10pm"). Auto-adjust scheduled message times to hit optimal windows.
**Verify:** Given a match who consistently replies within 5 min between 8-10pm but 3+ hours during daytime, system recommends evening send window.

### SCHED-04: App-to-Text Transition [P1]
When conversation warmth score crosses threshold (from CONV-02), auto-generate a "let's move to text" message appropriate to the platform and conversation tone. Queue for approval.
**Verify:** Match with warmth score > 75 and 15+ messages triggers transition suggestion. Message references something specific from their conversation.

### SCHED-05: Approval Queue [P0]
Dashboard page showing all pending scheduled/drafted messages. Each shows: match name, message preview, scheduled time, context (why this message). Approve, edit, or reject with one tap.
**Verify:** 3 messages in queue. Approve one (sends at scheduled time). Edit one (saves changes). Reject one (removes from queue). All actions work on mobile.

---

## Phase 43 — Date Planner

### DATE-01: Date Idea Generator [P1]
Given match interests (IG + conversation), suggest 5 personalized date ideas with: venue name, location (San Diego area), estimated cost, why it matches their interests, best day/time.
**Verify:** Match who likes hiking and craft beer gets suggestions including a trail + brewery, not a generic "dinner and movie."

### DATE-02: Google Calendar Integration [P0]
Create calendar events for planned dates: match name, venue, time, pre-date notes (conversation topics to bring up), budget. Bi-directional — creating in ClapCheeks adds to Google Calendar and vice versa.
**Verify:** Plan a date in dashboard. Event appears in Google Calendar within 30 seconds. Edit time in Google Calendar — ClapCheeks reflects change.

### DATE-03: Budget Tracking [P1]
Log actual spend per date: venue, drinks, food, activities, transport, total. Running total across all dates. Cost-per-date average. Monthly budget with alerts.
**Verify:** Log $85 for a date (dinner $45, drinks $25, parking $15). Dashboard shows running total and updated average.

### DATE-04: Post-Date Notes [P0]
After a date, quick-entry form: overall rating (1-10), vibe check (great/good/meh/bad), physical chemistry (1-10), would go again (yes/maybe/no), notes (freeform), next step (plan another/keep talking/fade/block). Updates match ranking.
**Verify:** Submit post-date rating of 8 with "great conversation, wants to try rock climbing next." Match overall rank updates. Notes visible on profile card.

### DATE-05: Date History Timeline [P1]
Visual timeline per match showing: all dates with ratings, spending, photos (optional), milestone moments (first kiss, met friends, etc.).
**Verify:** Match with 3 dates shows timeline with dates, ratings, and total spent. Can expand each for notes.

---

## Phase 44 — Autonomy Engine

### AUTO-01: Preference Learning [P0]
Track Julian's swiping patterns to build preference model: which profiles get liked (physical traits, bio keywords, interests), which get passed. Model updates after every 50 swipes.
**Verify:** After 200 swipes, model predicts Julian's swipe with > 70% accuracy on a held-out set of 20 profiles.

### AUTO-02: Auto-Swipe Mode [P0]
Toggleable mode where agent swipes based on learned preferences. Respects per-platform rate limits. Logs every decision with confidence score. Stops if confidence drops below threshold.
**Verify:** Enable auto-swipe on Tinder. Agent makes 20 swipes. Review log — decisions align with Julian's patterns. Low-confidence swipes (< 60%) are skipped.

### AUTO-03: Auto-Respond [P0]
When a match messages, auto-draft reply in Julian's voice using conversation context + strategy. If confidence > 80%, send immediately. If 50-80%, queue for approval. If < 50%, notify Julian.
**Verify:** New message from match about weekend plans. Auto-reply sends within 2 minutes (high confidence). New message with ambiguous intent queues for approval.

### AUTO-04: Stale Conversation Recovery [P1]
Detect conversations with no activity for 48+ hours. Auto-generate re-engagement message based on last topics discussed. Queue for approval unless autonomy is set to "full."
**Verify:** 3 conversations go stale. System generates unique re-engagement messages for each (not the same template). Messages reference specific prior topics.

### AUTO-05: Approval Gates [P0]
Configurable autonomy levels: "supervised" (approve everything), "semi-auto" (approve dates + transitions only), "full-auto" (approve only date booking). Toggle per-match or globally.
**Verify:** Set global to "semi-auto." Auto-replies send without approval. Transition-to-text message queues for approval. Date booking queues for approval.

### AUTO-06: Confidence Dashboard [P1]
Real-time view showing autonomy status: which matches are on auto-respond, confidence scores, recent auto-sent messages, queue depth, any degraded states. Push notification when human input needed.
**Verify:** Dashboard shows 5 active auto-conversations with confidence scores. One drops below threshold — notification fires to Julian's phone.

---

## Phase 45 — Polish & Integration

### POLISH-01: End-to-End Flow Test [P0]
Complete flow works: add match → IG scrape → zodiac calc → comms profile → pipeline card → conversation → scheduled follow-ups → date planning → post-date rating → ranking update.
**Verify:** Walk through full flow with a real match. All steps complete without errors. Data persists correctly across all tables.

### POLISH-02: Obsidian Dating Profile Sync [P1]
When a match reaches "Date Planned" stage, auto-create/update an Obsidian profile in `Contacts/Dating/` using the existing template. Include zodiac, IG interests, communication profile, conversation highlights, date plans.
**Verify:** Move match to "Date Planned." Obsidian file created at `Contacts/Dating/{Name}.md` with all sections populated from Supabase data.

### POLISH-03: Push Notifications [P1]
Notify Julian via iMessage (god mac send) for: new match requiring attention, approval queue items, date reminders (1 hour before), stale conversation alerts, autonomy confidence drops.
**Verify:** Schedule a date for 1 hour from now. Notification fires. Add item to approval queue. Notification fires within 1 minute.

### POLISH-04: Mobile UX Refinement [P0]
All pages pass mobile usability: touch targets ≥ 44px, no horizontal scroll, fast page transitions (< 200ms), pull-to-refresh on pipeline, bottom nav bar for quick access to pipeline/messages/dates/settings.
**Verify:** Use on iPhone 14. Navigate all major flows. No layout breaks. Bottom nav accessible with one thumb.

### POLISH-05: Data Privacy & Cleanup [P1]
Match data deletable (hard delete from all tables). IG scraped data auto-expires after 30 days (re-scrape if needed). No match data syncs to cloud analytics. All data stays in Julian's Supabase instance.
**Verify:** Delete a match. Confirm gone from match_profiles, conversations, scheduled messages, and date history. IG data older than 30 days is flagged for refresh.

---

## Requirement Summary

| Phase | Category | P0 | P1 | Total |
|-------|----------|---:|---:|------:|
| 39 | Match Profile Engine | 5 | 2 | 7 |
| 40 | Pipeline Dashboard | 4 | 1 | 5 |
| 41 | Conversation Intelligence | 3 | 2 | 5 |
| 42 | Scheduled Messaging | 3 | 2 | 5 |
| 43 | Date Planner | 2 | 3 | 5 |
| 44 | Autonomy Engine | 4 | 2 | 6 |
| 45 | Polish & Integration | 2 | 3 | 5 |
| **Total** | | **23** | **15** | **38** |

---

## Out of Scope (v0.9)

- Multi-user support (this is Julian's personal tool)
- Billing/subscription for this feature set (already built in M5)
- Dating app account creation automation
- Photo optimization/scoring for Julian's own profile (already built in M4)
- Video call integration
- Shared matchmaking with friends
- Export/import from other dating management tools

---

## Deferred to v1.0+

- Moon sign / rising sign calculation (requires birth time + location)
- Mutual friends detection via IG
- Voice note analysis (analyze voice messages for tone)
- Multi-city venue database (currently San Diego only)
- AI-generated date recap summaries
- Long-term relationship tracking beyond dating phase
