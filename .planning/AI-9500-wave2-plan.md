# AI-9500 Wave 2 — Julian's email answers translated to execution plan

## Source: julian@aiacrobatics.com email reply 2026-05-06 20:31 PT

## Decisions captured

| Section | Julian's answer | Translation |
|---|---|---|
| §1 | "fix the data + connect it correctly + ship it for me (physically) + custom mix with the logic" | All 4 combos. Build everything. |
| §1 also | "I also have the progressive web app" | Add PWA wrapper to dashboard so it's installable on iPhone home screen |
| §2 | "serious relationship preferred, open to casual exploration · 10 solid roster · honest about wanting relationship dependent on what they want" | `your_dating_intent = serious_with_fwb_openness` · `target_concurrent_active = 10` · prompt-rule: be transparent about intent when she asks |
| §3 Q1 (competition) | "yes" | BUILD #A competition signal |
| §3 Q2 (cross-plat fusion) | "see all my messages in one thread from Instagram to iMessage to everything" | BUILD #D unified cross-platform thread |
| §3 Q4 (mobile dashboard) | "build the mobile dashboard layout · also see the calls" | BUILD #H mobile + add call integration |
| §3 Q6 (Tinder/Bumble) | "activate Tinder and iMessage only right now" — interpreted as: keep iMessage + Hinge, ADD Tinder, hold Bumble | BUILD #J Tinder activation, defer Bumble |
| §3 Q7 (Tailscale IP) | "figure out IP rotation later on" | DEFER |
| New ask | "small tag system for them and the things that they mentioned · debrief me before the date" | BUILD #K per-person tag system + pre-date debrief card |
| §5 | bug fix | FIX avg_reply_rate |
| §6 | "full port retro · analyze the past data" | BUILD #M cohort retro analysis |

## 13 items to ship — grouped for parallel waves

### Wave 0 — schema foundation (inline by orchestrator, ~20 calls)
- F1: `your_dating_intent` enum on a new `operator_profile` singleton
- F2: `target_concurrent_active` integer
- F3: `competition_signal_score` (0-1) on people + `competition_signal_evidence` text
- F4: new fields on people: `tags` array, `things_mentioned` array of {topic, said_at, source_msg_id}
- F5: new touch type `pre_date_debrief`
- F6: `unified_thread` table or computed view
- F7: index for soft_no_recovery sweep

### Wave A — backend data layer (3 parallel agents, sonnet)
- **W1: Competition signal model** — internalAction + sweep that computes reply-time variance + life-event-mention frequency + ghosting-recovery and stores `competition_signal_score`
- **W2: Cross-platform thread fusion** — query `unifiedThreadForPerson(person_id)` interleaving messages across all her handles (iMessage + Hinge + IG + Telegram + email) with platform tags
- **W3: Tier 2 LLM scoring** — extend enrichCourtshipForOne prompt + schema fields: `flirtation_level (0-10)`, `attachment_style`, `love_languages_top2`, `ask_yes_prob_now`

### Wave B — lifecycle + touches (3 parallel agents, sonnet)
- **W4: Soft-no recovery** — when ask_outcome=soft_no, schedule `soft_no_recovery` touch +14d with lower-pressure prompt
- **W5: Cut workflow** — auto-ghost detection 30d + dashboard cut button + archived state separate from ghosted
- **W6: Voice-memo trigger** — detect "post-phone-swap day-1" + "after 3rd reply" + "post-second-date" cadence moments and schedule voice-memo touches

### Wave C — front-end + UX (3 parallel agents, sonnet)
- **W7: Mobile dashboard / PWA** — manifest.json + icons + service worker + responsive layouts on /network, /coach, /people/[id]
- **W8: Date logistics checklist** — when ask_outcome=yes, auto-create checklist (reservation, meeting place, weather backup, drink pre-order, anti-flake transit ping)
- **W9: Pre-date debrief card + tag system** — UI to add tags + things-mentioned per person; before any scheduled date, generate a "debrief card" summarizing her interests, latest emotional state, last 3 topics, what to bring up, what to avoid

### Wave D — infrastructure (3 parallel agents, mostly sonnet, one haiku)
- **W10: Tinder activation** — token capture flow + Tinder polling job in convex_runner.py (token capture script will need Julian on his phone — document)
- **W11: Cohort retro analysis** — one-time script that walks all messages last 12mo, classifies each match's stage progression (matched → first-date → second-date → ongoing → ended/ghosted), outputs a cohort report to `.planning/cohort-retro-2025.md`
- **W12: Goal clarity + roster KPI panel + bug fix** (haiku) — add operator-profile UI · roster of 10 active threads view · fix `avg_reply_rate` divide-by-zero in coach.ts

### Wave E — call integration (1 agent, sonnet)
- **W13: Calls in dashboard** — Twilio call logs (or BlueBubbles call detection) → conversations table → surface call timestamps in unified thread + on /coach

## Parallelization — total agent count

- 1 inline foundation
- 12 background agents in waves (3 + 3 + 3 + 3 + 1, but waves can largely overlap since most touch unique files)

Schema bundle goes first (~20 inline tool calls), then all 12 spawn in a single message.

## Key conflict points

| File | Wave | Notes |
|---|---|---|
| schema.ts | F (foundation) | Inline, before all agents |
| people.ts | W3, W12 | W3 adds enrichment fields; W12 adds operator-profile + bug fix. Different sections. |
| enrichment.ts | W1, W3, W4, W6 | Conflict-prone. Each agent works on its own SECTION; merge sequentially with `git merge -X theirs` |
| touches.ts | W4, W5, W6, W8, W9 | High conflict risk. Stagger merges. |
| convex_runner.py | W6, W10 | Different handlers, low conflict |
| New files | W2, W7 (PWA bits), W9 (debrief card), W10 (Tinder), W11 (cohort), W13 (calls) | Zero conflict |

## Done definition

Each upgrade:
1. Code on branch + PR opened
2. Auto-merged after CI green
3. Convex deploy if backend
4. Vercel deploy if frontend
5. Smoke test against deployed
6. Reported to orchestrator

## Wall-clock estimate
~4-5 hours for all 13. Mac Mini integration for Tinder needs Julian's hands (token capture).

## What I do NOT spawn for
- Dashboard cosmetic polish — only when explicitly requested
- Any IP rotation / Tailscale (deferred per Julian)
- Bumble activation (deferred per Julian)
