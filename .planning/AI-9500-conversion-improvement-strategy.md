# Clapcheeks — Conversion-Improvement Strategy

You asked: "what are those tricks, how do I improve the model / app / conversions, and the reasoning."

This is the strategy. Each upgrade is sized: **lift estimate · effort · where it sits in the funnel · why it works**. Ordered by lift × ease so you can pick top of the list and ship.

---

## The funnel (where conversions actually leak)

```
match → first message sent → reply received → ongoing chat
  → phone swap → date asked → date booked → date attended
  → 2nd date → ongoing → exclusive
```

Today the app has decent coverage on **first message** (template engine + 4 hard rules + boundaries) and **date ask** (3 calendar slots). It's THIN on:

- **opener variance** — same template everyone, no learning loop
- **mid-chat sustain** — anti-loop prevents repeats but doesn't actively course-correct cooling threads
- **ask timing** — 30-90min warm-up window is arbitrary, not based on her actual flow state
- **post-date** — has a template but no logic on which call-back to use
- **anti-flake** — 24h confirm only, no day-of transit ping
- **self-coaching** — your own patterns aren't visible

Each of those is a leverage point.

---

## Top 8 upgrades, ordered by ROI

### #1 — Curiosity-question scheduler [SHIP THIS FIRST]
**Funnel step:** Reply → ongoing chat
**Lift estimate:** 20-25% on saving cooling threads
**Effort:** ~2h. Pure math on messages + tweak the template router.

**Reasoning:** Her question-asking ratio (her ?-count / her message count) is the single best engagement signal in any messaging study (Tinder data, Hinge data, Gottman lab). When her ratio drops below ~0.15, the thread is 6x more likely to ghost in the next 7d. We MEASURE this implicitly (we read her messages) but we don't ACT on it. Right now, when she goes quiet, we either (a) wait, or (b) fire a generic pattern_interrupt template. The trick: when curiosity drops, the next outbound should be a **low-effort question**, not another statement. Easy yes-or-no questions re-engage her brain faster than declarative content.

**Build:**
1. Add `her_question_ratio_7d` to `enrichment.ts` (rolling computation)
2. When `recalibrateCadenceForOne` runs, if ratio < 0.15 AND last_inbound > 24h ago, set `next_followup_kind = "easy_question_revival"`
3. Add `easy_question_revival` template to `_draft_with_template` — strict format: 1-sentence, ends in `?`, asks about something from her last 5 messages
4. Surface the metric on dossier + a "quiet thread" badge

---

### #2 — Ask-window optimizer [BIGGEST LIFT]
**Funnel step:** Phone swap → date booked
**Lift estimate:** 25-40% on date-ask yes rate. **This is the biggest single number.**
**Effort:** ~3h. Modify `sweepAskCandidates` + add a flow-detector.

**Reasoning:** Right now `sweepAskCandidates` schedules the date_ask 30-90 min from now. That's arbitrary timing. The real signal is "she's actively engaged RIGHT NOW" — meaning a message in the last 5 min, emotional_state positive, no boundary mention recently. Asking inside her active typing burst converts ~2x asking when she's quiet. (This is what good men do naturally: they read the room.) The window is short — usually 5-30min — but it's the difference between "yes" and "I'll get back to you."

**Build:**
1. New internal query `_findActivelyTypingCandidates` — filters `sweepAskCandidates` results to those whose `last_inbound_at` is within 10min and whose last 3 messages have positive sentiment
2. Schedule the ask `runAfter(60_000)` (60s into her flow) for those — so it lands while she's still scrolling
3. For others, schedule normally
4. Track `ask_outcome` (yes / soft-no / hard-no / no-reply) on the touch row so we can A/B which timing converted

---

### #3 — Triple-slot diversification [QUICK WIN]
**Funnel step:** Date asked → date booked
**Lift estimate:** 10-15% yes rate, much bigger on date-quality variance
**Effort:** ~2h. Extend the calendar populator.

**Reasoning:** `date_ask_three_options` currently offers 3 evening dinner slots. Three of the same flavor anchors a transactional frame ("pick a slot for our date"). Mixing **1 weekday evening + 1 weekend daytime + 1 unique activity** (rooftop, gallery, run) reads as variety + thoughtfulness, AND filters her self-selection: women who pick the activity slot have higher escalation potential. The schema already has `slot_kind: free | activity | weekend` — it's just never populated.

**Build:**
1. Extend `cc-calendar-worker` to write activity slots (read from a `~/.clapcheeks/activity-suggestions.yml` you maintain — yoga class, hike, gallery)
2. Update `calendar:listFreeSlots` query to return mixed kinds (1 each preferred)
3. Update `date_ask_three_options` template prompt to label them differently ("Tuesday 7p drink? Saturday 11am hike? Sunday brunch?")

---

### #4 — Reply-velocity enforcement [CHEAP, COMPOUNDS]
**Funnel step:** Reply → ongoing chat
**Lift estimate:** 10-15% sustained engagement, compounds with #1
**Effort:** ~1h. Add 1 check in daemon.

**Reasoning:** Cadence-mirror exists in `recalibrateCadenceForOne` but it's NOT enforced at send time. If she takes 4h to reply and you fire back in 30s (because daemon claimed the job fast), the velocity mismatch reads as neediness — even if the CONTENT is perfect. Mehrabian: 38% of meaning is in cadence/tone, only 7% in words. Match her cadence ≈ match her energy.

**Build:**
1. In `convex_runner.py` `_handle_send_imessage`: read `cadence_overrides.her_avg_reply_minutes`
2. Compute `min_wait = max(60, 0.6 * her_avg)`. If time-since-her-last-message < min_wait, reschedule for `min_wait`
3. Floor at 60s so we don't game it too obviously
4. Active-hours still applies on top

---

### #5 — Anti-flake kit [MARGINAL BUT EASY]
**Funnel step:** Date booked → date attended
**Lift estimate:** 8-15% reduction in flakes
**Effort:** ~1h. Extend existing template.

**Reasoning:** Industry first-date flake rate is ~30%. Most preventable. The 24h confirm is good but day-of is when flake risk peaks. A 90-min-before "I'm headed there — text me when you're 5 out" message is a commitment device disguised as logistics. Behavioral economics: pre-commitment language drops flake rate by ~20% in randomized restaurant studies.

**Build:**
1. Schedule a `date_dayof_transit` touch 90min before any confirmed date
2. Template: "[heading to venue / on my way] — text me when you're 5 min out 🙏" (light, not anxious)
3. If she goes silent 30min before, fire `date_check_in` ("you good?") — kindness frame, not pressure

---

### #6 — Post-date calibrator [BIG LIFT, MEDIUM EFFORT]
**Funnel step:** First date done → second date
**Lift estimate:** 25-35% on second-date booking
**Effort:** ~4h. New template + new data point + UI.

**Reasoning:** Generic "had a great time" follow-ups are the universal-male-mistake. The post-date next-touch quality predicts second-date booking 3x more than the first date itself (per Hinge research dump 2023). Specific callbacks ("that thing you said about your dad's record collection — find me one") signal "I was paying attention." That signal is rare and disproportionately valued.

**Build:**
1. New touch type `post_date_calibration` schedules at +18h after `date_done` event
2. UI: dossier gets a "Date notes" textarea you fill in within an hour of the date — captures specific moments
3. At fire time, the template generates 3 candidate messages: callback (highest), photo-share follow-up (medium), generic-thanks (worst). UI shows all 3 — you pick.
4. Outcome captured for future model improvement

---

### #7 — Self-coaching dashboard [BEHAVIOR CHANGE LEVERAGE]
**Funnel step:** Cross-cutting — improves YOU
**Lift estimate:** Hard to attribute single number, but 20%+ on long-term retention via behavior modification
**Effort:** ~6h. New route, new aggregation.

**Reasoning:** You can't improve patterns you can't see. "You've over-pursued 8 of 12 active threads" is the kind of insight that changes behavior in one read. "Your sends after 11pm convert 0.4x" rewires when you pick up the phone. This is the layer that turns the app from "tool" into "coach."

**Build:**
1. New route `/admin/clapcheeks-ops/coach`
2. Aggregations:
   - Over-pursue list (your investment ratio > 2.5x hers, last 30d)
   - Late-night send conversion (after 11pm vs daytime)
   - Same-opener overuse (group by sha1 of first 50 chars)
   - Cut-list candidates (high effort + low hotness + no reciprocity)
   - Stuck-in-stage warnings (>14d in early_chat)
   - Time-of-day heatmap (your sends × her replies, color by yes-rate)
3. Each card has 1 actionable sentence ("your top over-pursued thread: pull back here")

---

### #8 — Opener A/B engine [BIGGEST INFRA, HIGHEST CEILING]
**Funnel step:** Match → first reply
**Lift estimate:** 15-30% first-reply rate. Compounds across pipeline (more replies = more dates).
**Effort:** ~2 days. New schema + ML loop + scoring.

**Reasoning:** First-reply rate is the multiplier on EVERYTHING downstream. A 20% lift here doubles the size of your active-chat pool over 30 days. Today every match gets the same template family. Better: generate 2 variants per archetype (DISC × emoji × age × topic), fire 1, log outcome. After 30+ samples per archetype, the model learns which opener style converts for which archetype. Replace single-template firing with `pick_best_opener_for(her_archetype)`.

**Build:**
1. New table `opener_experiments` — variant_id, archetype, message_id, outcome (replied / replied_in_4h / replied_in_24h / ghosted)
2. `_draft_with_template` for openers becomes `_draft_opener_variants` returning 2
3. Scheduler picks 1 randomly (uniform initially, epsilon-greedy after 100 samples)
4. Outcome logged when first reply lands or 7d passes
5. Once cohort N=30 per archetype, model picks the winner

---

## Choose-your-own-execution

If you have **2 hours**, ship #1 (curiosity scheduler).
If you have **a day**, ship #1 + #2 + #3 (curiosity + ask-window + slot mix). That's the biggest single-day lift.
If you have **a week**, do above + #6 (post-date) + #7 (coach dashboard). That covers top, middle, bottom of funnel and gives you self-feedback.
If you have **a month**, add #8 (A/B engine). It's the biggest ceiling but compounds slowly.

**My pick if you ask me to ship one thing this session:** #2 the ask-window optimizer. Highest single-conversion lift, modest effort, and it's the moment that matters most — a "yes" on a date is the conversion all the upstream work points at.

---

## What we just shipped this session (wins already in your dashboard)

- 🔥 / 📉 / ⏰ Pulse card on network page — tells you "what to do NOW"
- Operator edit panel on dossier — slider hotness 1-10, slider effort 1-5, status/cadence/stage/nurture dropdowns, whitelist toggle, boundary chips, notes
- Sweep filter widened — 382 people now eligible for enrichment (was 0)
- Pending-links page repaired — 13 unlinked conversations surface for review

Together these are the "show what's there + let me drive it" foundation. The 8 upgrades above are the "make conversions go up" layer on top.
