# Clapcheeks Roadmap

## Milestone 1: Foundation (v0.1) — Shipped
Core scaffold, landing page, auth, and deployment.
- Phase 1: Project scaffold
- Phase 2: Landing page
- Phase 3: Auth
- Phase 4: Database schema
- Phase 5: Vercel deployment

## Milestone 2: Local Agent (v0.2) — Shipped
## Milestone 3: Dating App Automation (v0.3) — Shipped
## Milestone 4: Analytics & AI Coaching (v0.4) — Shipped
## Milestone 5: Monetization (v0.5) — Shipped
## Milestone 6: Growth (v0.6) — Shipped
## Milestone 7: Production Hardening (v0.7) — Shipped
## Milestone 8: GTM Testing & Launch (v0.8) — Shipped

(Full history preserved at `.planning/ROADMAP.ARCHIVE.md`)

## Milestone 9: Personal Dating Command Center (v0.9) — ACTIVE

Julian's personal dating power tool. 2026-04-20 pivot: after building out the match-profile engine + pipeline dashboard (phases 39-45 original), scope expanded with letter-phases M/F/B/E/C/G/L/H/J/K to cover match intake, scoring, anti-detection, offline handoff, vision analysis, drafting, drip, content library, ML learner, CRM roster, and social graph detection.

### Already landed (2026-04-20)
- **Phase A** (AI-8315) — Match intake loop (Tinder + Hinge -> Supabase, 15+ columns, photo storage, RLS). Merged, deployed.
- **Phase D** (AI-8318) — Dashboard /matches grid + detail pages. Merged, deployed.
- **Phase I** (AI-8323) — Rule-based match scoring (location + criteria + casual-intent). Merged, deployed.
- **Extension IG harvest** — chrome.cookies API captures IG sessionid/ds_user_id/csrftoken. Merged to main.
- **Daemon anti-bot hardening** — 30-min cadence, 6/min rate, 3-profile cap, 3-8s jitter.

### Remaining letter-phases (dependency-respecting priority order)

```
M ──→ F ──→ B ──→ E ──→ C ──→ G ──→ L ──→ H ──→ J ──→ K
|            |          |          |          |
|            |          +----------+          |
|            |                                |
+------------+--------------------------------+
(all downstream of A which is already shipped)
```

---

### Phase M (46): Chrome-extension routing for platform API calls (AI-8345)
**Priority:** P1 — BLOCKER for safe Tinder use after 2026-04-20 selfie-verification trip
**Goal:** Route all Tinder/Hinge/Bumble/IG outbound API calls through Julian's real Chrome session via the token-harvester extension, so every request carries his real browser fingerprint + residential IP.
**Requirements:** REQ-M from Linear AI-8345
**Depends on:** Phase A (match intake to refactor)

**Success criteria:**
1. `clapcheeks_agent_jobs` schema + RLS + index added
2. Extension polls + claims jobs every 10s, fetches with `credentials: 'include'`, streams results back
3. `POST /api/ingest/api-result` endpoint
4. `agent/clapcheeks/match_sync.py` refactored to enqueue jobs instead of calling APIs directly
5. 48h soak: 0 anti-bot events, 0 selfie verifications triggered

---

### Phase F (47): Offline contacts + cross-platform conversation handoff (AI-8320)
**Priority:** P1
**Goal:** F1 — Julian adds offline contacts via dashboard; iMessage history + IG pulled; same match-row shape. F2 — when a Tinder/Hinge match exchanges numbers, merge iMessage thread into the match row and continue drafting on iMessage.
**Requirements:** REQ-F
**Depends on:** Phase A (schema), Phase C (IG enrichment — soft dep)

**Success criteria:**
1. 'Add offline contact' UI in /dashboard/matches
2. Phone-number regex fires on every platform message (both directions), writes `match.her_phone`
3. Handoff-ask draft uses `persona.platform_handoff.julian_golden_template` verbatim
4. Primary channel flips to iMessage when handoff_complete=true
5. iMessage reply drafts continue with full match context (bio + vision + prior platform thread)
6. Unified thread view in /dashboard/matches/[id] with channel badges

---

### Phase B (48): Photo vision analysis (AI-8316)
**Priority:** P2
**Goal:** Claude Vision on every match photo — scene, activity, location, food signals, aesthetic, energy. Aggregate into `vision_summary` per match. Feed back into Phase I scoring rescore.
**Requirements:** REQ-B
**Depends on:** Phase A (photos in storage)

**Success criteria:**
1. Worker consumes photos_jsonb URLs from new matches
2. Structured JSON output stored on clapcheeks_photo_scores
3. Aggregated vision_summary populated on clapcheeks_matches within 5 min of new match
4. Phase I scoring daemon auto-rescores on vision_summary update (wire already exists)
5. Rate-limited: 3 photos per Claude call, cached by photo hash

---

### Phase E (49): Tone + voice rules in drafting (AI-8319)
**Priority:** P2
**Goal:** Enforce `persona.message_formatting_rules` + banned punctuation + banned_words + multi-message splitting in every draft Clapcheeks produces. Every draft MUST reference HER specific profile.
**Requirements:** REQ-E
**Depends on:** Phase A (match data), Phase B (vision for 'her specific detail' reference)

**Success criteria:**
1. `lib/claude.ts` prompt injects persona.message_formatting_rules + golden handoff template
2. Pre-queue validator rejects drafts containing em-dash, en-dash, ellipsis, curly quotes, semicolon, banned_words
3. Multi-thought drafts return as message arrays (sender fires with 3-8s pauses)
4. 20 sample drafts tested across different match profiles: 0 em-dashes, 0 walls, each references a specific HER detail

---

### Phase C (50): Instagram enrichment (AI-8317)
**Priority:** P2
**Goal:** Extract IG handle from bio/prompts/messages; pull public feed via embed endpoint or Firecrawl; store 12 recent posts + hashtags + frequency into `clapcheeks_matches.instagram_intel`.
**Requirements:** REQ-C
**Depends on:** Phase A (match data)

**Success criteria:**
1. Regex IG handle extraction from bio + prompts + incoming messages
2. Public IG feed scraped (12 posts) via TOS-safe endpoints
3. `instagram_intel` JSONB populated on match row
4. Private profiles handled gracefully (handle recorded, fetch skipped)

---

### Phase G (51): Follow-up drip daemon (AI-8321)
**Priority:** P2
**Goal:** Automated nurture — no match goes dark. State machine: opened -> 24h bump -> 5d terminal; conversing -> 2d re-engage -> 7d terminal; date_proposed -> 24h follow-up; date_booked -> outcome prompt to Julian 4h after.
**Requirements:** REQ-G
**Depends on:** Phase E (draft quality)

**Success criteria:**
1. Cron every 15 min scans clapcheeks_conversations
2. Drafts use Phase E rules verbatim
3. 48h unanswered opener auto-queues soft bump
4. Stalled conversation triggers re-engage referencing her last topic
5. Julian gets iMessage outcome prompt 4h after scheduled date end

---

### Phase L (52): IG content library + auto-posting (AI-8340)
**Priority:** P2
**Goal:** Upload Julian's beach/dog/agency photos once; system categorizes + schedules + posts. Before opening a >=0.85 match, check IG freshness; if >3 days stale, auto-post from library or prompt Julian.
**Requirements:** REQ-L
**Depends on:** Phase A (match data), Chrome extension (IG session cookie already harvested)

**Success criteria:**
1. `clapcheeks_content_library` table + `julian-content` Supabase Storage bucket
2. Dashboard upload UI with auto-categorization via Claude Vision
3. Auto-scheduler fills 7-day calendar respecting ratio rules (beach+dog 60% / active 20% / entrepreneur 10% / food 10%)
4. Posting engine publishes stories via IG session cookie
5. Freshness rule auto-posts or pings Julian before Phase G's opener fires on >=0.85 match with stale IG

---

### Phase H (53): ML preference learner (AI-8322)
**Priority:** P2
**Goal:** Learn Julian's 'type' from every swipe (retroactive + forward) and auto-score new profiles. Retroactive from Tinder/Hinge data-export ZIPs; forward from every extension swipe.
**Requirements:** REQ-H
**Depends on:** Phase I (rule-score foundation), Phase A (swipe stream)

**Success criteria:**
1. `clapcheeks_swipe_decisions` schema + RLS
2. Nightly cron fits logistic regression or GBM on features -> like decision
3. Model weights stored in `clapcheeks_user_settings.preference_model_v`
4. New profile scored via model on Phase A intake; >0.85 auto-like, <0.15 auto-pass
5. Held-out set accuracy >70% on >=1000 decisions

---

### Phase J (54): Roster CRM view (AI-8338)
**Priority:** P2
**Goal:** Kanban dashboard with 10 stages; per-match health score (0-100), julian_rank (1-10 slider), close_probability; Daily Top-3 panel; 3 bonus factors live (geographic_cluster, calendar_overlap, boundary_log).
**Requirements:** REQ-J
**Depends on:** Phase D (match detail page adds slider), Phase G (stage transitions)

**Success criteria:**
1. Schema extensions on clapcheeks_matches (stage, health_score, julian_rank, close_probability, etc.)
2. `/dashboard/roster` kanban route with drag-between-stages
3. Health score computed hourly via cron (weighted composite with decay)
4. Top-3 daily outreach panel surfaces correct entries
5. Julian rank slider writes back to row, feeds Phase H training signal

---

### Phase K (55): Social graph collision detector (AI-8339)
**Priority:** P2
**Goal:** Detect mutual-friend overlap + friend-cluster risks; cluster matches who share female friends; activate only highest-scoring cluster member; flag HIGH_RISK (8+ mutual) to Julian via iMessage.
**Requirements:** REQ-K
**Depends on:** Phase A (match data), Phase C (IG follower overlap)

**Success criteria:**
1. Schema extensions: mutual_friends_count, social_risk_band, friend_cluster_id, cluster_rank, shared_female_friends
2. Detection sources live: Hinge native + IG follower overlap + phone contact overlap
3. Cluster logic: new match joining cluster gets scored; if higher than current leader, promote + demote
4. HIGH_RISK (8+ mutual) triggers Julian approval before opener
5. 'Social Graph' panel on match detail page shows mutual friends, cluster, risk band

---

### Requirement Coverage Matrix

| Letter-phase | Linear | Maps to existing v0.9 phase? | Dashboard surface |
|---|---|---|---|
| M (46) | AI-8345 | Extends Phase 38 anti-detection | Background — extension + daemon |
| F (47) | AI-8320 | New (not in original 39-45 plan) | /dashboard/matches + thread |
| B (48) | AI-8316 | Complements Phase 39 profile engine | Match detail AI insights |
| E (49) | AI-8319 | Complements Phase 41 conversation intelligence | Draft preview |
| C (50) | AI-8317 | Extends Phase 39 IG scraper | Match detail AI insights |
| G (51) | AI-8321 | Complements Phase 42 scheduled messaging | Approval queue |
| L (52) | AI-8340 | New | /dashboard/content-library |
| H (53) | AI-8322 | Maps to Phase 44 autonomy engine ML | Scoring panel |
| J (54) | AI-8338 | Maps to Phase 40 pipeline dashboard | /dashboard/roster |
| K (55) | AI-8339 | New | Match detail Social Graph panel |

**Coverage:** 10/10 letter-phases mapped to concrete Linear issues with full scope in each issue's description.
