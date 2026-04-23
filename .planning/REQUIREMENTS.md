# Clapcheeks Requirements — Active

Current milestone: **v0.9 Personal Dating Command Center (Continued)**

See milestone-specific requirements at `.planning/milestone-9/REQUIREMENTS.md` plus the phase-letter issues tracked in Linear project `clapcheeks.tech` (https://linear.app/ai-acrobatics/project/clapcheeks-tech).

## Completed in v0.9 (landed + deployed 2026-04-20)
- REQ-A (Phase A, AI-8315): Match intake loop — Tinder + Hinge -> Supabase clapcheeks_matches
- REQ-D (Phase D, AI-8318): Dashboard /matches grid + detail pages with filters, photos, thread, action bar
- REQ-I (Phase I, AI-8323): Rule-based match scoring (location 35% + criteria 65% + casual-intent boost + dealbreakers)

## Remaining for v0.9 — Letter-phase requirements

Each phase has a full Scope + Acceptance + Anti-patterns in its Linear issue.

| Letter | Linear | Title | Priority | Depends on |
|--------|--------|-------|----------|------------|
| M | AI-8345 | Route platform API calls through Chrome extension (anti-detection) | P1 BLOCKER | A |
| F | AI-8320 | Offline contacts + cross-platform iMessage handoff | P1 | A |
| B | AI-8316 | Photo vision analysis (Claude Vision per photo) | P2 | A |
| E | AI-8319 | Tone and voice rules baked into drafting | P2 | A |
| C | AI-8317 | Instagram enrichment from handle | P2 | A, B |
| G | AI-8321 | Follow-up drip daemon (24h / 2d / 7d) | P2 | E |
| L | AI-8340 | IG content library + auto-posting | P2 | A |
| H | AI-8322 | ML preference learner (sklearn on swipe decisions) | P2 | I, A |
| J | AI-8338 | Roster CRM view (health score + julian_rank + stages) | P2 | D, G |
| K | AI-8339 | Social graph collision detector + friend-cluster dedupe | P2 | A, C |

## Key saved state (source of truth)

Supabase `clapcheeks_user_settings.persona` fields for user `9c848c51-8996-4f1f-9dbf-50128e3408ea`:
- `ranking_weights` — location (35%) + criteria (65%) + casual-intent boost + dealbreakers
- `platform_handoff` — golden handoff template + detection signals + post-handoff continuity
- `content_library` — 6 categories, ratio rules, freshness rule (<3d before high-score open)
- `roster` — 10 stages, 12 per-match metrics, 13 bonus factors
- `social_graph_rules` — mutual-friend thresholds, cluster dedupe, detection sources
- `message_formatting_rules` — banned punctuation (em/en-dash/ellipsis), max-80-chars, multi-message splits
- `followup_cadence` — 24h bump / 2d stall re-engage / 7d terminal
- `date_venue_strategy` — Cannonball (sushi) / Guava Beach (default) / Miss B's / Lahaina / Italian PB list; 1.5mi radius from 3381 Ocean Front Walk
- `dating_preferences` — 21-33, 5'3"-5'9", fit/thin/athletic, no excessive tattoos/smoke/kids/drugs, active preferred

## Key account state

- Tinder account in selfie verification (2026-04-20, from Phase A daemon anti-bot trip)
- Tinder/Hinge/IG tokens harvest via Chrome extension in Profile 6 (julianb233@gmail.com)
- Daemon tightened to 30-min cadence + 6/min rate + 3-profile cap + 3-8s jitter until Phase M ships
