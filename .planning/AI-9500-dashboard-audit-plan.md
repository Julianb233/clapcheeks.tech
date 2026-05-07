# Clapcheeks Dashboard — Data Accuracy + UX Plan (AI-9500)

## Audit findings — what's broken

### Convex API
| Page | Query | Result |
|---|---|---|
| pending-links | people:listPendingLinks | **WAS BROKEN** — never written to source. **FIXED** PR #99. 13 rows surface. |
| network | people:listForUser | OK — 500 rows, 66 dating-relevant after filter |
| people/[id] | people:getDossier | OK |
| calendar | calendar:listFreeSlots | OK — 49 slots cached |
| touches | touches:listUpcoming | OK — 1 scheduled |
| media | media:listForApproval / listApproved | OK — 1 / 0 (operational) |
| profile-imports | profile_import:listForReview | OK — 0 (operational) |

### The actual gap — data is empty across 500 people

| Field | Coverage | Why |
|---|---|---|
| google_contacts_labels | 0 / 500 | Google Contacts → Convex sync of labels is broken or never ran |
| courtship_last_analyzed | 0 / 500 | Sweep filters by `CC TECH` label, nobody has labels |
| vibe_classified_at | 4 / 500 | Same — only the few that got manually run |
| hotness_rating | 0 / 500 | Operator hasn't rated anyone (no UI affordance) |
| effort_rating | 0 / 500 | Same |
| nurture_state | 0 / 500 | Same |
| courtship_stage | 0 / 500 | Sweep blocked by label filter |
| next_followup_at | 0 / 500 | Cadence engine never ran (depends on enrichment) |
| time_to_ask_score | 0 / 500 | Same |
| trust_score | 0 / 500 | Same |
| next_best_move | 0 / 500 | Same |
| curiosity_ledger entries | 0 / 500 | enrichCourtshipForOne never ran broadly |
| personal_details entries | 0 / 500 | Same |
| boundaries_stated entries | 1 / 500 | Same |
| emotional_state_recent | 4 / 500 | Only on threads with active inbound flow |
| topics_that_lit_her_up | 3 / 500 | Same |
| whitelist_for_autoreply | **0 / 500** | **No one whitelisted → auto-send completely off** |
| zodiac_sign / disc_inference / age | 0 / 500 | Profile import never ran (no screenshots imported) |

**Root cause:** Sweep guards filter by `google_contacts_labels.includes("CC TECH")`. Labels never made it to Convex. Sweeps return zero candidates. Enrichment data never produced. Dashboard shows empty rich fields.

### Other issues
1. **vibe sweep crashes** with OCC against concurrent webhook writes — needs retry-on-OCC
2. **"professional" vibe miss** — Aaron Drew has full DEI context; correctly classified, but sweep doesn't run on the other 71 iMessage handles
3. **Network row has `vibe_classification === "dating"` filter for default view, but only 4 rows have any vibe** → dating view is sparse
4. **Compose panel + dossier exist but lack rating sliders / edit form** — schema + patchPerson mutation are there but no UI affordance
5. **Empty states** (curiosity, life events, topics) just show "—" with no instruction on how to populate them
6. **Network row shows handles + cadence + emo but hides** the rich insights that are the actual product (next_best_move, curiosity questions, lit topics, conversation temperature)

## Plan — execute in this order

### Phase 1 — wire the data (unblock enrichment) [HIGH IMPACT]

1. **Widen sweep candidate filter** so it doesn't depend on a label that's never set.
   - `sweepCourtshipCandidates` and `sweepVibeCandidates`: replace `CC TECH` filter with the same dating-relevance heuristic the network page already uses (status in {lead,active,dating,paused} AND has dating-channel handle OR recent inbound OR operator rating).
   - Cap at 30 per sweep so we don't spike the LLM bill; 6h cron means full coverage in 1-2 days.
2. **OCC-retry wrap** on `sweepVibeCandidates` and any sweep that scans `conversations` (concurrent BlueBubbles writes are the norm).
3. **Profile screenshot import** path is built — Julian needs to drop screenshots into the Drive folder (or use the iPhone Shortcut) to populate zodiac/age/disc. Surface this as an empty-state hint.
4. **Whitelist UX**: add a single toggle to dossier with a clear safety-brake explainer ("OFF = manual review every send"). Today there's no UI to flip it.

### Phase 2 — better insights on network row [VISIBLE]

Network row currently shows: name, age, hotness, effort, channels, inbound-time, trust, ttas, emo, cadence, whitelist, follow-up, next_best_move, top curiosity question.

That's already a lot, but it buries the most-actionable items. New layout, top-down by salience:

```
[name] [age] [zodiac] [stage badge]                       [whitelist toggle]
┌─────────────────────────────────────────────────────────┐
│ 💡 NEXT MOVE: <next_best_move sentence>                 │
│ ⏰ <time-since-inbound> · 🌡 <conversation_temperature>   │
│ ❓ <top pending curiosity_ledger question>               │
│ 🔥 lit on: <top 3 topics_that_lit>                       │
└─────────────────────────────────────────────────────────┘
🔥 9/10 hotness · ⚡ 3/5 effort · 💬 warm cadence
```

When the field is empty, show a useful empty state, e.g. "Run /enrich to populate" or "Drop a screenshot to set zodiac/age."

### Phase 3 — dossier deep affordances [EDITING]

Dossier exists at `/admin/clapcheeks-ops/people/[id]` with 6 tabs. Add inline editing:

1. **Rating sliders** in header (0-10 hotness, 0-5 effort) — wire to `patchPerson`
2. **Status / cadence / nurture_state / whitelist** as a single edit panel with dropdowns
3. **Boundaries** as editable list (each boundary = one chip, click to remove, type to add)
4. **Operator notes** as a textarea synced to `operator_notes` field

These all already exist as schema + patchPerson; just need the UI.

### Phase 4 — better presentation polish [NICE-TO-HAVE]

1. **Network "Today's pulse" card at top**: how many threads active, how many cooled, top 3 to message back NOW (sorted by `priorityScore`)
2. **Conversation temperature visualizer** on row (thermometer or color band)
3. **Sticky filter bar** with quick-filters: "Need response now" (recent inbound, no outbound after) / "Cooling off" (>3d no msg) / "Whitelisted only" / "Has enrichment"
4. **Dossier timeline tab**: show messages with conversation_temperature deltas + emotional_state_recent overlaid on the timeline so the operator sees the curve, not just the list

### Phase 5 — backfill chain
Continue the orphan-conversations backfill chain (currently 120 linked / 714 orphan). Already running via `backfill:runChained` — just monitor.

## Execution order (this session)

1. Widen sweep filter (Phase 1.1) → ship in same PR with OCC retry (1.2)
2. Add rating sliders + edit form to dossier (Phase 3.1, 3.2) — Julian asked for this directly
3. Improve network row presentation (Phase 2)
4. Trigger sweeps post-deploy and let them populate data
5. Empty-state hints (Phase 1.3 + 1.4 + 2.5)

## Out of scope this session
- Phase 4 polish (timeline tab, pulse card, sticky filter)
- Multi-line / Tinder / Bumble (still Phase 2 of the master plan)
- Tailscale / IP rotation (Phase 2 master)
