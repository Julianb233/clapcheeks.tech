# Clapcheeks Wave 2.4 — Bussit Task Package

**Linear epic**: AI-9449 (Clapcheeks AI dating co-pilot, full system)
**This wave's parent**: AI-9500 (Wave 2.4 — profile import, multi-platform polling, dossier)
**Created**: 2026-05-06 by agent11

This file lets multiple Claude Code terminals work in parallel via the `/bussit` flow.
Each task below is **independent** of the others (no shared file edits in flight) so two
to four terminals can claim + execute concurrently with zero merge conflicts.

## How to claim a task (per terminal)

1. Open a fresh Claude Code session at `cd /opt/agency-workspace/clapcheeks.tech`.
2. Read this file. Pick a task with no `OWNER:` line.
3. **Edit this file** and add `OWNER: <your agent name> <YYYY-MM-DD HH:MM>` under the chosen task.
4. Commit `chore(planning): claim AI-9500-<task-letter>` immediately so other terminals see the lock.
5. Branch: `git checkout -b AI-9500-<task-letter>-<slug>`.
6. Ship to PR. Auto-merge per fleet rule.

## Critical context every terminal needs

- **Convex**: `valiant-oriole-651` dev. Deploy with `CONVEX_DEPLOY_KEY` from 1Password (`op item get "CONVEX-clapcheeks-dev-admin-key" --vault API-Keys --fields credential --reveal`). Schema in `web/convex/schema.ts`.
- **Mac Mini daemon**: `tech.clapcheeks.runner` + `tech.clapcheeks.mediawatcher` launchd plists already loaded. Source code in `/opt/agency-workspace/clapcheeks-local/clapcheeks/`. Sync to Mac via `scp ... thewizzard@100.108.83.124:~/clapcheeks-local/`.
- **gws on Mac Mini**: installed at `~/.local/bin/gws`, profile at `~/.config/gws-profiles/workspace/`. Set `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file`. Calendars: `julian@aiacrobatics.com` + `c_3084e8452ab4cd8bad2d7a18411144ebb54765a5462d3a8c79375b3041e35bf2@group.calendar.google.com` (Dating).
- **LLM cascade (Convex side)**: `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` set. Use Gemini Vision for image work.
- **Dashboard**: routes under `/admin/clapcheeks-ops/`. Layout at `web/app/admin/layout.tsx`.
- **Whitelist brake**: `people.whitelist_for_autoreply` must be true before AI sends anything to a person.
- **Read first**: `obsidian-vault/Projects/ClapCheeks/2026-05-06-fleet-architecture.md` (full layered architecture).

## Tasks

---

### TASK A — Profile screenshot importer (Tinder/Bumble/Hinge/IG → person row + zodiac + DISC)

OWNER: agent11 2026-05-06 17:30

**Goal**: Julian screenshots a girl's dating-app profile, drops it in via iPhone Shortcut (with `x-cc-kind: profile` header) or via dashboard upload. AI analyzes the screenshot, extracts everything visible, generates a Convex `people` row pre-filled with name, age, location, interests, zodiac analysis, DISC inference, opener suggestions.

**Files to touch**:
- `web/convex/schema.ts` — extend `media_assets` with `analysis_kind` enum (`media | profile_screenshot`) and `profile_screenshot_data` jsonb-style field; new optional fields on `people` for `zodiac_sign`, `zodiac_analysis`, `disc_inference`, `opener_suggestions`, `imported_from_profile_screenshot`.
- `web/convex/media.ts` — new internalAction `analyzeAsProfile` (Gemini Vision with deep-context prompt: bio, age, occupation, location, photos, prompts, zodiac inference + interpretation, DISC style inference, communication tendencies, openers, red/green flags).
- `web/convex/people.ts` — new mutation `createFromProfileAnalysis(media_id)` that pulls extracted profile data and creates a `people` row with `status="lead"`, `whitelist_for_autoreply=false` (safety default), and full enrichment.
- `web/convex/http.ts` — extend `/clapcheeks/media-upload` to read `x-cc-kind` header and route to `analyzeAsProfile` instead of regular `autoTagMedia` when `kind=profile`.
- `web/app/admin/clapcheeks-ops/profile-imports/page.tsx` — new dashboard route showing pending profile-screenshot analyses with: extracted fields, zodiac wisdom block, suggested openers, "Create person row" + "Discard" buttons.

**Required prompt depth (zodiac + DISC + tendencies)**:

The Gemini Vision prompt MUST include built-in wisdom blocks for all 12 zodiac signs (Aries through Pisces) covering:
- Core motivation
- Communication style preference (direct/indirect, formal/casual, playful/grounded)
- What earns trust with this sign (specific behaviors)
- What kills it (specific behaviors)
- Best opener pattern for this sign
- 2-3 example openers calibrated to the sign
- Compatibility/friction notes when paired with Julian (capture his sign in env CC_USER_ZODIAC if set)

DISC inference: from her bio's word choice + sentence structure + photo selection, infer Dominance / Influence / Steadiness / Conscientiousness profile and surface 2-3 communication tactics for that profile.

**Acceptance**:
- Upload `samples/sample-tinder-profile.jpg` (you'll need to drop a real screenshot in the Drive folder OR provide via a curl test). Returns extracted: `name, age, occupation, location, bio, prompts, photos_described, zodiac_sign, zodiac_block, disc, opener_suggestions[3]`.
- Dashboard `/admin/clapcheeks-ops/profile-imports` shows pending uploads with all extracted fields. "Create person row" button calls `people:createFromProfileAnalysis` and the row appears in `/admin/clapcheeks-ops/network` with status=lead.

---

### TASK B — Person dossier deep-dive route

OWNER: _(unclaimed)_

**Goal**: Click any person in `/admin/clapcheeks-ops/network` → land on a per-person page that shows everything we know about her: full message timeline, personal_details ledger, curiosity_ledger, recent_life_events, emotional_state_recent (mini-chart), trust_score over time, courtship_stage, scheduled_touches, media_uses (which photos we've sent her), zodiac block, DISC notes.

**Files to touch**:
- `web/convex/people.ts` — new query `getDossier(person_id)` joining people + last 100 messages + scheduled_touches + media_uses + pending_touches.
- `web/app/admin/clapcheeks-ops/people/[id]/page.tsx` — new dynamic route. Layout: header card (name, stage, trust, vibe, ask-readiness), tabs (Timeline / Memory / Schedule / Media / Profile / Notes).
- `web/app/admin/clapcheeks-ops/network/page.tsx` — wrap each PersonRow in a `<Link>` to the dossier.

**Acceptance**:
- Click any name in /network → land on /people/<id> showing full dossier.
- "Send a touch now" button enqueues a manual scheduled_touch (type=reply, scheduled_for=now+5min).

---

### TASK C — Hinge SendBird poller (claims `sync_hinge` agent_jobs)

OWNER: agent3-bussit-C 2026-05-06 17:45 (Linear: AI-9507)

**Goal**: Wire the existing `clapcheeks/platforms/hinge_api.py` + `hinge_auth.py` to poll the SendBird API for new conversations + messages, post each to `messages:upsertFromWebhook` with `transport=hinge_sendbird`.

**Prerequisite**: Julian needs to capture Hinge tokens via mitmproxy (one-time iPhone step). Tokens land at `~/hinge-auth.json` + `~/sendbird-session.json` on Mac Mini. **DO NOT block on this** — write the poller to gracefully degrade with `{skipped:true, reason:"no_tokens"}` if files absent.

**Files to touch**:
- `clapcheeks-local/clapcheeks/intel/hinge_poller.py` — new module. Reads tokens, lists active SendBird channels, fetches new messages since last poll cursor, posts to Convex.
- `clapcheeks-local/clapcheeks/convex_runner.py` — register `sync_hinge` handler.
- `clapcheeks-local/scripts/run-hinge-poller.sh` + `tech.clapcheeks.hingepoller.plist` — separate launchd job polling every 5 min.
- `web/convex/crons.ts` — 5min cron `enqueueHingeSync` that drops a `sync_hinge` agent_job.

**Acceptance**:
- Run on Mac Mini with token files present → reads N new SendBird messages, lands them in Convex `messages` table with `platform=hinge`, `person_id` linked via handle match (already covered by upsertFromWebhook).

---

### TASK D — Anti-loop + boundary-respect enforcer

OWNER: agent3-bussit-D 2026-05-06 17:45 (Linear: AI-9508)

**Goal**: Two safety layers around outbound:
1. **Anti-loop**: AI never sends the same template + same draft pattern to two different girls within 7 days (so Sarah and Kate don't both get the identical "btw you mentioned…" line within a week).
2. **Boundary respect**: If `person.boundaries_stated` contains things like "no texting late", "I don't drink", "slow it down", AI's reply generator MUST respect them — refuse to send templates that violate.

**Files to touch**:
- `web/convex/touches.ts` — in `fireOne`, before enqueueing the send_imessage job: check the last 7d of fired touches for the user's other people, hash the draft body shape (first-50-chars + template), refuse to send if collision.
- `clapcheeks-local/clapcheeks/convex_runner.py` — in `_draft_with_template`, inject boundaries_stated into the system prompt as HARD RULES. Also add a post-draft validation pass: if draft contains banned-phrase tokens (configurable), regenerate once.

**Acceptance**:
- Fire two `pattern_interrupt` touches to two different test girls back-to-back. Second one regenerates to a different shape OR skips with `skip_reason: anti_loop_collision`.

---

### TASK E — Reply-velocity mirror + active-hours auto-tune

OWNER: _(unclaimed)_

**Goal**: AI replies should mirror her response time. If she takes 4h, AI replies in 3-5h, not 30s. AI also learns her active-hours preference automatically over 14d of observations.

**Files to touch**:
- `web/convex/enrichment.ts` — new internal action `recalibrateCadenceForOne(person_id)`: reads last 30d of message timestamps both directions, fits her median reply time, picks a target reply-gap distribution, updates `person.cadence_overrides.{min_reply_gap_ms, max_reply_gap_ms}` and `person.active_hours_local`.
- `web/convex/crons.ts` — weekly cron `recalibrateCadenceSweep`.
- `web/convex/touches.ts` — `fireOne` already respects active_hours; add reply-gap respect: if scheduled_for is too close to her last message gap, push it out.

**Acceptance**:
- Run `recalibrateCadenceForOne` on a person with 30+ messages — produces cadence_overrides matching her actual rhythm. Visible in /admin/clapcheeks-ops/people/<id>.

---

### TASK F — Conversation-fatigue + pattern-interrupt scheduler

OWNER: agent3-bussit-F 2026-05-06 17:45 (Linear: AI-9509)

**Goal**: Detect when a conversation is dying (declining engagement_score over last 5 messages, or 5+ days silent). Auto-schedule a `pattern_interrupt` touch with one of 5 calibrated templates (callback, meme-reference, low-pressure check-in, bold direct, seasonal hook).

**Files to touch**:
- `web/convex/enrichment.ts` — new sweep `sweepFatigueDetection`: scans CC TECH people, computes 5-message engagement slope, schedules pattern_interrupt for those trending negative + silent >3d.
- `web/convex/crons.ts` — every 12h cron.
- `clapcheeks-local/clapcheeks/convex_runner.py` — extend the `pattern_interrupt` template with 5 sub-styles, AI picks one based on her style_profile + courtship_stage.

**Acceptance**:
- A person with declining engagement gets a pattern_interrupt scheduled within 12h. Style choice varies based on her DISC.

---

### TASK G — Dashboard person dossier "Send a touch now" + draft preview

OWNER: _(unclaimed)_

**Goal**: From the dossier page (Task B), Julian can manually trigger a touch + preview the draft + edit before sending.

**Files to touch**:
- `web/convex/touches.ts` — extend `scheduleOne` with `preview_only: true` flag that returns the generated draft without enqueueing. Add `commit` mutation that takes a touch_id + edited_body and fires it.
- `web/app/admin/clapcheeks-ops/people/[id]/page.tsx` — add "Compose" panel: pick template, click Preview → AI drafts → editable textarea → Send button.

**Acceptance**:
- From any person's dossier, click "Compose → Hot Reply" → preview appears in editable box → Send → message lands on her phone within 30s.

---

### TASK H — Sample data seeder (so dashboard isn't empty during demo)

OWNER: agent3-bussit-H 2026-05-06 17:45 (Linear: AI-9510)

**Goal**: Write a one-shot script that creates 3 fake people in Convex (lead status, not whitelisted) with realistic mock data so all 7 dashboard pages have content during dev / demo.

**Files to touch**:
- `clapcheeks-local/scripts/seed_demo_data.py` — new script. Creates 3 fake people with handles, interests, courtship_stage, personal_details, curiosity_ledger entries, recent_life_events, emotional_state samples, fake conversation/messages.
- Document in this file's "Decommission" section how to wipe demo data when done.

**Acceptance**:
- Run script → /admin/clapcheeks-ops shows 3 candidates, /touches has 3-5 demo touches scheduled, /pending-links shows 1 demo ambiguous match.

---

## Dependency map (parallel-safe pairings)

```
Independent: A, C, D, E, F, H — claim any, no conflicts.
Sequential:  B → G  (G needs B's dossier route).
```

You can run **two terminals on (A + C)**, **three on (A + C + H)**, or **four on (A + C + D + H)** without merge conflicts. **B + G must be the same terminal** OR coordinate by claiming `web/app/admin/clapcheeks-ops/people/[id]/page.tsx` only once.

---

## What's NOT in this wave (Wave 2.5+)

- Tinder + Bumble pollers (similar pattern to Hinge — Task C, just swap the platform). Defer until Hinge is proven.
- Instagram poller via browser-harness on Mac Mini's logged-in Chrome. Anti-bot risk; defer until rest of system is humming.
- Photo A/B testing of Julian's profile photos. Need photo-scoring data + match-rate-per-photo tracking.
- Place suggester (Foursquare API) for date_ask drafts. Currently AI proposes free hours from calendar; venue suggestion is layer 2.
- Cross-platform person consolidation (Hinge match shares phone → auto-merge to iMessage thread). Half-built via handles[]; needs a `personLinker:autoMerge` action.

---

## Decommission / cleanup checklist (when wave is done)

- Delete demo seed data (Task H) once real data flows.
- Remove `OWNER:` lines from this file once tasks ship to main.
- Tag PRs with `AI-9500-X` so Linear auto-progress fires.

### Task H — Demo data wipe procedure

Run from the repo root (VPS or Mac Mini with `NEXT_PUBLIC_CONVEX_URL` or
`CONVEX_URL` in environment / web/.env.local):

```bash
cd /opt/agency-workspace/clapcheeks.tech
python clapcheeks-local/scripts/seed_demo_data.py --wipe
```

Or with an explicit deployment URL:

```bash
python clapcheeks-local/scripts/seed_demo_data.py --wipe \
  --convex-url https://valiant-oriole-651.convex.cloud
```

The wipe uses `display_name LIKE 'Demo: %'` as the filter — it calls the
`people:deleteDemoRows` mutation which cascades to conversations, messages,
scheduled_touches, and pending_links. It does NOT touch any row where
`display_name` does not start with `"Demo: "`, so real data is safe.

Verify clean: `/admin/clapcheeks-ops/network` should show 0 people after wipe.

---

— End Wave 2.4 bussit package
