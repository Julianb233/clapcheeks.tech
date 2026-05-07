# Clapcheeks — AI Dating Co-Pilot (Operator-Only)

## ⚠️ CRITICAL BRAND RULE — DO NOT CHANGE

**The product is called "Clapcheeks", NOT "Outward".**

This codebase was previously associated with a product called "Outward" but has been fully rebranded to **Clapcheeks**. Any references to "Outward" in the codebase are bugs and must be changed to "Clapcheeks".

- Brand name: **Clapcheeks**
- Domain: **clapcheeks.tech**
- Do NOT rename back to Outward
- Do NOT change "Clapcheeks" to "Outward" in any file

## What This System Is

Clapcheeks is Julian's **personal AI dating co-pilot** running on Mac Mini + Convex + Vercel.
The marketing site is at the root domain; the operator-only ops dashboard is at
`/admin/clapcheeks-ops/*` (auth-gated to four admin emails).

The system reads inbound iMessages from `chat.db` via BlueBubbles, analyzes them
via an LLM cascade (Claude Sonnet → Gemini 2.0 Flash → DeepSeek → Grok 2),
schedules per-person touches with strict safety brakes, suggests calibrated
replies via the four hard rules, manages a media library of approved photos,
imports dating-app profile screenshots into person rows with zodiac + DISC +
opener calibration, and drives every send through a whitelist + active-hours +
anti-loop + boundary-respect enforcement chain.

**Outcome the system is built for:** Julian sees one digest per day, taps Send
on suggestions he agrees with, and gets to dates without manually drafting
every message — while never sending anything tone-deaf, repetitive, or
boundary-violating.

## Architecture (5 layers, top to bottom)

1. **Operator dashboard** — Next.js 15 App Router pages under `web/app/admin/clapcheeks-ops/*`. Reads/writes Convex via `useQuery` / `useMutation`.
2. **Convex** (`web/convex/*.ts`) — schema + queries + mutations + crons + httpActions. Source of truth for live state.
3. **Mac Mini daemon** (`/Users/thewizzard/clapcheeks-local/clapcheeks/`) — long-running Python process under launchd. Polls `agent_jobs` queue, drafts replies via the LLM cascade, sends via BlueBubbles, reads chat.db for inbound, syncs Obsidian + Google Contacts, fetches gws calendar slots.
4. **BlueBubbles** — Mac-resident HTTP/webhook server bridging iMessage to Convex. Inbound webhook → VPS receiver → `messages.upsertFromWebhook`. Outbound send via Mac BlueBubbles HTTP API.
5. **Obsidian + Google Contacts** — operator's source of truth for "who they are" (interests, goals, values, communication style, boundaries). One-way sync into Convex; the daemon never writes back.

## Project Structure

```
web/                                          — Next.js 15 SaaS app + ops dashboard
  app/admin/clapcheeks-ops/                   — operator-only routes (auth-gated)
    page.tsx                                  — overview
    network/page.tsx                          — list of dating-relevant people
    people/[id]/page.tsx                      — per-person dossier + Compose panel
    media/page.tsx                            — media library approval queue
    touches/page.tsx                          — upcoming + recent fires
    calendar/page.tsx                         — calendar_slots cache view
    pending-links/page.tsx                    — handle → person link queue
    profile-imports/page.tsx                  — screenshot → person row review
  convex/                                     — schema, queries, mutations, crons, httpActions
clapcheeks-local/                             — separate repo on Mac Mini (Python daemon)
supabase/migrations/                          — landing-site users/billing tables
```

## Convex deployment

- **Dev deployment:** `valiant-oriole-651` (live)
- **Convex URL:** https://valiant-oriole-651.convex.cloud
- **Deploy key:** `op item get "CONVEX-clapcheeks-dev-admin-key" --vault API-Keys --fields credential --reveal`
- **Deploy command:**
  ```bash
  cd web
  CONVEX_DEPLOY_KEY="$(op item get 'CONVEX-clapcheeks-dev-admin-key' --vault API-Keys --fields credential --reveal)" \
    npx convex deploy -y
  ```
- **Run a single function for verification:**
  ```bash
  CONVEX_DEPLOY_KEY="..." npx convex run people:listForUser '{"user_id":"fleet-julian","limit":10}'
  ```
- **Function inventory:** `npx convex function-spec --prod`

**IMPORTANT:** Convex deploys are full-source replacements. If you push source missing a module that's deployed live, those functions get DELETED. Always verify the local source has every module before `convex deploy`.

## Vercel deployment

- **Project:** `clapcheeks-tech` (linked via `web/.vercel/project.json` → `prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki`)
- **Auto-deploy** on push to main/integration branches.
- **Manual deploy:** `cd web && VERCEL_TOKEN="..." npx vercel --prod --yes`

## Mac Mini daemon

Lives at `/Users/thewizzard/clapcheeks-local/`. Three launchd jobs:
- `tech.clapcheeks.runner` — main loop, claims `agent_jobs` from Convex
- `tech.clapcheeks.mediawatcher` — polls Google Drive for new media uploads
- `tech.clapcheeks.hingepoller` — pulls SendBird for new Hinge messages (when tokens captured)

**SSH:** `ssh thewizzard@100.108.83.124`. Logs at `~/.clapcheeks/daemon.log`.

**Key handlers in `convex_runner.py`:**
- `send_imessage` — outbound send via BlueBubbles, drafts via `_draft_with_template`
- `draft_preview` — operator clicked Preview in dossier compose panel
- `send_digest_to_julian` — daily morning digest delivery
- `fetch_calendar_slots` — gws calendar pull → calendar_slots upsert
- `enrich_courtship` — re-extract personal_details / curiosity / events / boundaries / emotional_state
- `cadence_evaluate_one` — recompute next_followup_at, time_to_ask_score, conversation_temperature
- `auto_tag_media` — Gemini Vision tags an uploaded photo
- `analyze_profile_screenshot` — Gemini Vision extracts profile info from a screenshot
- `classify_conversation_vibe` — dating | platonic | professional | unclear

## Safety brakes (every send goes through ALL of these)

Order of evaluation in `touches.fireOne`:
1. **Whitelist:** `people.whitelist_for_autoreply` MUST be true. Default false. Operator flips manually in the dossier.
2. **Status:** Person not paused / ended.
3. **Active hours:** If `active_hours_local` is set, current hour in her tz must be within the window. Otherwise the touch reschedules itself to the next window start.
4. **Anti-loop (Wave 2.4D):** `fired_body_shape = sha1(type + ":" + draft[0:50])`. If any other person for this user got the same shape in the last 7 days, skip with `anti_loop_collision`.
5. **Cadence-mirror (Wave 2.4E):** If `cadence_overrides.min_reply_gap_ms` is set and we're firing too soon after her last reply, push the touch out by `min_reply_gap + 0..30s jitter`.
6. **Boundary respect (Wave 2.4D, Mac Mini side):** `_draft_with_template` injects `boundaries_stated` as `## HARD RULES — DO NOT VIOLATE` at the top of the system prompt. Post-draft validation scans for banned tokens (`drink`, `wine`, `late night`, etc. mapped per boundary). One regen pass; if still violating, returns `__BOUNDARY_VIOLATION__` sentinel and the send is skipped.

## The 4 Hard Rules (drafting on Mac Mini)

Every reply template injects these at the top of the system prompt:
1. **Reference at least one specific thing** from prior messages OR personal_details. No generic "how's your week".
2. **Match her current emotional state** (`stressed/excited/playful/vulnerable/flirty/bored/tired/proud/anxious/neutral`).
3. **End with one question OR observation.** If a question, it MUST reference something specific to her.
4. **Don't pivot to Julian** unless she asked. Mirror-and-extend her topic.
Plus: ≤240 chars, no em-dashes, no semicolons.

## Date-ask flow (3 calendar slots)

1. Sweep `enrichment.sweepAskCandidates` runs every 6h. Finds people whose `time_to_ask_score >= 0.7` AND no recent ask.
2. Schedules a `date_ask` touch with template `date_ask_three_options`.
3. Mac Mini drafter reads `calendar:listFreeSlots` for the next 14 days, filters preferred evening hours (default 18-20 local), dedupes by day, takes the **top 3** distinct slots.
4. Drafts a single message proposing those 3 with a callback line. Example: "btw you mentioned that taco place… Thu 7pm, Sat 8pm, or Sun 6pm work for you?"
5. On her confirmation, operator clicks Confirm → `calendar:markConfirmed` → calendar_slot becomes `date_confirmed`.

## Touch types (`scheduled_touches.type`)

| Type | Use case |
|---|---|
| `reply` | Standard cadence reply (most common) |
| `nudge` | Soft re-engage when she's gone quiet but not silent |
| `callback_reference` | "Did you end up doing X?" — surface a specific thing she mentioned |
| `date_ask` | Propose a date with 3 calendar slots |
| `date_confirm_24h` | T-24h check-in before a confirmed date |
| `date_dayof` | T-3h day-of logistics confirm |
| `date_postmortem` | Morning-after the date |
| `reengage_low_temp` | Pattern interrupt at 5+ days silent |
| `birthday_wish` | Birthday |
| `event_day_check` | Her marathon/interview/etc. happening today |
| `pattern_interrupt` | Unique soft restart (5 sub-styles per DISC: callback / meme / low-pressure / bold / seasonal) |
| `phone_swap_followup` | First-call invite 24-72h post phone swap |
| `first_call_invite` | Propose a phone/voice call |
| `morning_text` | Casual morning check-in |
| `digest_inclusion` | Include this person in tomorrow's digest |

## Person schema — operator-editable fields (Wave 2.4 J)

Use `people.patchPerson({person_id, ...fields})` to write. Fields safe to edit from the dashboard:

| Field | Type | Notes |
|---|---|---|
| `display_name` | string | |
| `status` | enum | `lead / active / paused / ghosted / dating / ended` |
| `cadence_profile` | enum | `hot / warm / slow_burn / nurture / dormant` |
| `whitelist_for_autoreply` | bool | Safety brake — must be true for AI to send |
| `courtship_stage` | enum | `matched / early_chat / phone_swap / pre_date / first_date_done / ongoing / exclusive / ghosted / ended` |
| `hotness_rating` | 1-10 | Operator's read on attractiveness; drives prioritization |
| `effort_rating` | 1-5 | How much energy operator is willing to invest |
| `nurture_state` | enum | `active_pursuit / steady / nurture / dormant / close` |
| `next_followup_kind` | enum | What we should send next |
| `operator_notes` | string | Free-form |
| `interests` | string[] | |
| `boundaries_stated` | string[] | Drives the HARD RULES injection — handle with care |
| `things_she_loves` / `things_she_dislikes` | string[] | |
| `active_hours_local` | object | `{tz, start_hour, end_hour}` |

## Dashboard workflows

### Add someone to the dating network
1. Tag them with the **CC TECH** label in Google Contacts on either `julianb233@gmail.com` or `julian@aiacrobatics.com`.
2. Wait for `google_contacts_sync` cron tick (or trigger manually via the daemon).
3. They appear in `/admin/clapcheeks-ops/network`.
4. Click their name → dossier.
5. Set `hotness_rating`, `effort_rating`, `nurture_state`, `cadence_profile`.
6. Flip `whitelist_for_autoreply` to `true` only when ready.

### Import a profile from a dating-app screenshot
1. iPhone Shortcut "Clapcheeks" with `x-cc-kind: profile` header → POST to `/clapcheeks/media-upload`.
2. `analyzeAsProfile` fires Gemini Vision → extracts name, age, bio, prompts, photos described, zodiac, DISC, 3 calibrated openers, green/red flags, compatibility-with-Julian read.
3. Operator visits `/admin/clapcheeks-ops/profile-imports`, reviews, clicks **Create person row**.
4. New `people` row created with `status="lead"`, `whitelist_for_autoreply=false`.

### Compose a one-off send (Wave 2.4 G)
1. Open person's dossier.
2. ComposePanel: pick template (context_aware_reply / hot_reply / callback_reference / pattern_interrupt / morning_text / ghost_recovery / date_ask_three_options / etc.).
3. Click **Preview draft** → enqueues `draft_preview` agent_job → Mac Mini drafts via `_draft_with_template` → reactive subscription updates the textarea.
4. Edit → Send → `commitPreview` flips `is_preview=false` and triggers `fireOne`.

## Stale or "not accurate" dashboard — diagnosis checklist

If `/admin/clapcheeks-ops/network` shows nothing or wrong people:

1. **Convex deployed?** Check function inventory: `npx convex function-spec --prod`. If your new mutations aren't listed → run `npx convex deploy -y`.
2. **People count:** `npx convex run people:listForUser '{"user_id":"fleet-julian","limit":500}'` should return 100+ rows.
3. **CC TECH labelling:** if you want to use the strict CC TECH filter, ensure people in Google Contacts have the label AND `google_contacts_sync` has run.
4. **person_id linkage:** `backfill.orphanStatus({user_id:"fleet-julian"})` shows orphaned conversations not linked to a person. Run `backfill.runChained` to patch.
5. **vibe_classification:** if 0 people have `vibe_classification="dating"`, run `enrichment.sweepVibeCandidates` once (the cron does this every 6h but you can trigger manually).
6. **Mac Mini daemon up?** `ssh thewizzard@100.108.83.124 "tail -50 ~/.clapcheeks/daemon.log"`. If silent, `launchctl load ~/Library/LaunchAgents/tech.clapcheeks.runner.plist`.

## Bussit pattern — multi-terminal parallel execution

Wave 2.4 used a "bussit" task package: split independent work units across multiple Claude Code terminals with isolated worktrees. See `.planning/clapcheeks-wave-2.4-bussit.md` for the convention.

**Critical lesson learned (2026-05-06):** the SHARED `clapcheeks.tech` worktree gets thrashed when multiple parallel agents check out different branches under each other. Always work in **your own worktree** (`/tmp/cc-<agent>-<branch>`) to avoid lost work and zero out merge contention. Don't write untracked files in the shared worktree — they get wiped.

## Database (Supabase, landing-site only — NOT Convex)

- Project ref: `oouuoepmkeqdyzsxrnjh`
- Host: `db.oouuoepmkeqdyzsxrnjh.supabase.co`
- Migrations: `supabase/migrations/` and `web/scripts/`
- Used for: SaaS users / billing / Stripe webhooks. **NOT** the dating engine — that's all Convex.

## User Roles (admin gating for the ops dashboard)

`web/app/admin/layout.tsx` allows: `julian@clapcheeks.tech`, `admin@clapcheeks.tech`, `julianb233@gmail.com`, `julian@aiacrobatics.com`. Anyone else gets redirected to `/dashboard`.

## Linear

Epic: **AI-9449** (Clapcheeks AI dating co-pilot, full system).
Wave 2.4 sub-epic: **AI-9500**. All sub-issues created via the bussit task package land here.

## Don't break

- The 4 hard rules. They're the difference between sounding human and sounding bot.
- The whitelist brake. Default-deny is the only safe stance.
- The boundary HARD RULES injection. If she said "I don't drink", the AI must never propose wine.
- The anti-loop check. Same template + same draft shape across two girls within 7 days = ban-worthy if either compares notes.
- The active-hours respect. Don't text her at 3am.
- One-way Obsidian → Convex sync. Never write back to Obsidian; merge conflicts are unrecoverable.
