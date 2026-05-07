# Men's Dating Coach — What I'd Want to See on Each Woman

If I were a coach helping you date and ultimately end up with one of these women, here are the factors I'd want surfaced. Sorted by how much they actually predict outcomes.

## Tier 1 — derivable RIGHT NOW from message corpus + calendar (ship today)

These need zero new data. Just math on the messages we already have.

| Metric | What it tells you | How to compute |
|---|---|---|
| **Investment ratio** (her words / your words last 30d) | >1.0 = she's leaning in. <0.6 = you're over-pursuing. | sum body lengths in/out |
| **Initiation ratio** (her texts first / your texts first) | >0.5 = she comes to you. <0.3 = you're chasing. | who sent first message after >2h gap |
| **Reply-velocity trend** (last 5 vs prior 30) | Speeding up = interest spike. Slowing = drop-off cliff. | median time-to-reply rolling |
| **Question-asking ratio** (her ?s / her msgs) | >0.2 = she's curious about you. ~0 = polite-not-interested. | regex `\?` over her messages |
| **Reciprocity score** (your topics matched / her topics matched) | Healthy is roughly even. | overlap of nouns + verbs |
| **Days in current stage** | Stuck >14d in early_chat = ask sooner or move on. | now - stage_entered_at |
| **Time-to-first-date** | <14d = green. >30d = soft drag. | days from first message to first date_done |
| **Drop-off risk %** | Predicted ghost in next 7d. | weighted: trend, days-since-inbound, vs baseline |
| **Today's hot list** | Top 5 to message NOW (sorted priority). | already on network — surface as "PULSE" card |
| **Cooling list** | Top 5 declining intervene-now. | reply velocity slowing + her_word_count dropping |
| **Days since last contact** | Highlight when crossing cadence threshold. | now - max(last_inbound, last_outbound) |
| **Most-recent emotional state** | Where she ended last exchange. | last entry in `emotional_state_recent` |
| **Conversation temperature** | hot/warm/cool/cold | already computed; visualize as thermometer |
| **Date pipeline status** | Has date scheduled / asked-not-confirmed / pre-date / post-date / none | join scheduled_touches + calendar_slots |

## Tier 2 — needs LLM scoring (existing enrich_courtship can extend)

These run inside `enrichment.ts`. Add fields, extend the prompt.

| Metric | Field | Why |
|---|---|---|
| **Flirtation level (0-10)** | `flirtation_level` | the actual sexual-tension reading; signal is HUGE |
| **Attachment style** | `attachment_style: anxious / avoidant / secure / fearful` | best single predictor of relationship satisfaction |
| **Love languages (top 2)** | `love_languages: [...]` | so you speak HER language, not yours |
| **Conflict style** | `conflict_style: collab / avoid / withdraw / pursue` | predicts whether you can survive year 2 |
| **Long-term goals match (0-10)** | `goals_alignment_score` | kids, marriage, geo, career — vs your declared goals |
| **Values match (0-10)** | `values_alignment_score` | family, faith, fitness, money, freedom |
| **Lifestyle compatibility (0-10)** | `lifestyle_match_score` | nightlife, travel, fitness, schedule |
| **Sexual openness signal** | `sexual_openness: closed / cautious / open / explicit` | inferred from how she handles innuendo |
| **Photo-share willingness** | `photo_share_signal: never / asked-once / occasional / regular` | signal of trust + escalation |
| **Catfish risk score** | `catfish_risk_score` | message style + photo consistency + handle stability |
| **Already-attached signal** | `attached_signal: clear / suspicious / late-night-only / unknown` | huge red flag detector |
| **Drama / volatility** | `volatility_score` | mood swings, emotional dysregulation |
| **Money / class signal** | `class_signal: working / professional / wealthy / aspirational` | for date venue calibration |
| **Predicted "yes" probability if asked NOW** | `ask_yes_prob` | informs the date_ask timing |
| **Predicted next move SHE'LL make** | `predicted_her_next` | "she'll probably suggest meeting up" / "she'll go quiet 48h" |
| **Recommended next move YOU should make** | `next_best_move` (already exists) | sharper if model sees these other fields |

## Tier 3 — operator-input fields (UI dropdowns/textareas)

Things only you know about her, captured once.

| Field | Type | Why |
|---|---|---|
| `goals_declared` | freetext | what she's said she wants long-term |
| `dietary_prefs` | tags | for date booking |
| `drink_style` | enum (sober / light / drinks / heavy) | venue + pacing |
| `venues_mentioned` | list | restaurants / bars / experiences she's wanted to try |
| `home_neighborhood` | string | drive time math |
| `roommate_status` | enum | sleepover logistics |
| `pet_situation` | enum | schedule constraint |
| `tier_score` (1-5) | rating | peer-group / status alignment (separate from hotness) |
| `your_intent` | enum (fling / dating / relationship / unsure) | YOUR clarity matters for routing |
| `red_flags_observed` | tag list | dealbreaker tracker |
| `green_flags_observed` | tag list | building case |
| `last_seen_in_person` | timestamp | physical-presence freshness |
| `mutual_connections` | list | warm references |
| `restaurants_been_to_together` | list | avoid repeats, build callbacks |

## Tier 4 — self-coaching layer (about YOU, not her)

The most underrated layer. Your patterns show up across the pipeline.

| Pattern | What it surfaces |
|---|---|
| **Over-investment frequency** | "you're at 3.2x her on 8 of 12 active threads" |
| **Reply-time leak** | "you reply within 60s on weekends — pull back" |
| **Same intro line score** | "this opener has been used 14 times, 2 led to dates" |
| **Cut-list candidates** | "high effort + low hotness + no reciprocity = consider closing thread" |
| **Stuck-in-stage warning** | "you've had 7 women hit early_chat → no first_date — pattern" |
| **Best-converting style** | "your humor + callback combos convert 3x your other styles" |
| **Time-of-day performance** | "your sends after 11pm convert 0.4x — stop sending late" |
| **Asks declined pattern** | "tuesday-night asks declined 5/6 times" |
| **Topic that always lands** | "fitness anecdotes get +0.4 emotional-state lift" |

## Tier 5 — fleet / pipeline view (across the 60+ women)

The "men's dating coach" view, not the "one woman" view.

| View | Purpose |
|---|---|
| **Today's pulse** | top 5 to message NOW + top 3 to follow-up + top 3 cooling |
| **Date pipeline funnel** | matched → early_chat → phone_swap → pre_date → date_done — with conversion % at each stage |
| **First-date heatmap** | day-of-week × time-of-day where your asks convert |
| **Dating market overview** | total active, ghost rate this month, dates this week, kissed/slept-with this month |
| **Quality matrix** | hotness × effort plot, pull-out cut candidates |
| **Sleeper picks** | high hotness + low operator effort + still warm = unrealized opportunity |
| **Diversity scan** | are you only talking to one type? widening = better statistical fit |
| **Goal lock-in score** | how aligned is your top-5 with what you say you want long-term |

## What this means for the dashboard

Implementation priority:

1. **Ship Tier 1 NOW** — math on the message corpus, no LLM. Add a "Pulse" card at top of network + Tier 1 metrics on each row + Tier 1 panel on dossier. (Today.)
2. **Schema-add Tier 2 fields** so the existing 6h enrichment cron can populate them (extend the prompt + add validators). (Next push.)
3. **Add Tier 3 UI fields to OperatorPanel** — dropdowns for tier, your_intent, dietary_prefs, etc. (Next push.)
4. **Tier 4 self-coaching** — separate view at `/admin/clapcheeks-ops/coach` aggregates patterns across pipeline. (Phase 2.)
5. **Tier 5 fleet views** — replaces network landing page with a coach-view dashboard with funnel + heatmap. (Phase 2.)

## My pick for what to build first

If you want one shippable thing this session, build the **Pulse card on network page** with Tier 1 metrics (no LLM, instant ship). It's the difference between "list of names" and "coach telling you what to do next."

If you want the *biggest* lift over the next week, the **Tier 2 LLM scoring** of attachment + values + flirtation + ask_yes_prob is the move. Coach value compounds when these scores feed into next_best_move.
