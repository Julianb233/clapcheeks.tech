# Worker-B Research — AI-8815 Reactivation Playbook

**Agent:** agent8 / worker-B  
**Date:** 2026-04-27  
**Branch:** AI-8815-reactivation-playbook  

---

## 1. Sales Nurture / Re-engagement Frameworks

### Aaron Ross — Predictable Revenue
- Source: https://www.saastr.com/re-igniting-growth-with-predictable-revenue/
- Core insight: specialization separates prospecting from closing. Applied to reactivation: the person who made the original contact should own the re-engagement (consistency, familiar face).
- The "re-ignition playbook" requires slowing down to build *systems*, not heroic one-off attempts. Directly maps to the cadence ladder we implement in `drip.py` (14d → 45d, max 2 attempts).
- Key tactic: nail a niche. For reactivation messages, this means referencing the specific thing that made the original contact memorable — not generic reconnect language.

### HubSpot / Bloomreach Lapsed-Lead Sequences
- Source: https://www.poweredbysearch.com/blog/dead-lead-reviver/ + documentation.bloomreach.com
- Standard B2B sequence: 3-5 touches, spaced 7-21 days apart.
- First email: lightest touch. Subject-line-level insight: the shorter and more specific, the better.
- The walk-away rule: if no response after 3-5 attempts, move to a "sunset" segment. Continuing to reach dormant leads damages sender reputation (email) and wastes equity (personal relationships).
- B2B-specific: send from the account owner, not a generic alias. The recipient must recognize the name.

### Dan Kennedy / Russell Brunson — Direct Response Reactivation
- Source: https://marketingsecrets.com/ + https://www.poweredbysearch.com/blog/dead-lead-reviver/
- Kennedy's core principle: *a list is an asset*. Reactivating 10% of dormant contacts with no acquisition cost beats chasing cold prospects.
- Brunson's Soap Opera Sequence (SOS): five suspense-filled messages that pull people forward. Applied to reactivation: each message teases something new, not just "are you there?"
- MIFGE (Most Incredible Free Gift Ever) principle for reactivation: give before you ask. The first reactivation message should reference value — something that happened since you last talked.

### Klaviyo Win-Back Benchmarks (e-commerce, maps to any domain)
- Source: https://www.klaviyo.com/blog/winback-email-campaign-examples
- Timing: trigger at 1.5x the average gap between interactions. For dating (avg convo = 2-3 days), this maps to ~14 days — which is exactly what `DEFAULT_CADENCE["reactivation_first_attempt_days"]` encodes.
- Three-email rule: "keep winback flows to three emails per recipient." Clapcheeks uses max_attempts=2 for messages, which is more conservative — good for personal contexts.
- 45% of subscribers who receive a win-back message will engage with future outreach from that brand. Applies directly: the reactivation attempt has compounding value even if she doesn't reply immediately.
- Omnichannel: start with main channel, follow up with secondary. For dating: app DM first, then Instagram DM if connected.

---

## 2. Dating / Interpersonal Psychology

### Mark Manson — Models: Attract Women Through Honesty
- Source: https://markmanson.net + thepowermoves.com/models/
- Core framework: "fuck yes or fuck no." Most women who ghost sit in neutral — not a hard no, just unactivated. The reactivation window exists in this neutral zone.
- **Fading commitment curve**: neutral women will drift toward unreceptive if nothing polarizes them. But re-engagement with a low-pressure, specific message can re-polarize. The window: ~2 weeks for early-stage (opener-ghosted), ~45 days for post-conversation (longer shared history = longer window).
- The 3-chance rule: try once, try again if blown off, walk away after the third. This directly informs `reactivation_max_attempts=2` — we're giving one + one chance (the original conversation attempts count as earlier contacts).
- Anti-manipulation principle: Manson's framework explicitly rejects guilt, neediness, and pressure tactics. The playbook must enforce this — every technique in here is about creating genuine interest, not engineering compliance.

### Robert Greene — The Art of Seduction (Methodology Extraction Only)
- Source: https://thepowermoves.com/the-art-of-seduction-summary/
- Absence principle: "a seduction requires patience. The longer you take and the slower you go, the deeper you will penetrate into the mind of the other person." This validates the 14-day wait before first reactivation — immediate follow-up after being ghosted reads as desperation.
- The second seduction framework: "never let the other person take you for granted — use absence, create pain and conflict." Applied ethically: re-engaging after absence is a legitimate, healthy pattern, not a manipulation. The absence is genuine (you moved on with your life). The re-engagement is genuine (something reminded you of them).
- **Key extraction**: what's useful is the *timing* principle and the *asymmetric investment* principle. The message should feel like it cost you nothing to send, because it genuinely didn't — you thought of something, you sent it. Not "I've been waiting 14 days to reach out."

### Academic Research — Why "Hey Stranger" Fails
- Source: PMC / Nature Communications 2024 — "People are surprisingly hesitant to reach out to old friends"
- **Critical finding**: people overestimate the awkwardness of reconnecting and underestimate how positively the outreach is received. This directly answers why most people don't reactivate: they assume rejection, so they don't try.
- The behavioral warm-up study: participants who spent 3 minutes messaging current contacts first had a 53% higher reconnect rate than the control group. Applied: if you're cold on a reactivation, mentally rehearse the positive outcome before writing.
- **Why gap-acknowledgment fails**: explicitly naming the gap ("it's been a while") activates the other person's memory of why they stopped responding. It forces them to relitigate the disconnection. Jumping over the gap ("just saw this and thought of you") treats the silence as neutral, not loaded.

### Cialdini — Reciprocity and Liking in Re-engagement
- Source: https://cxl.com/blog/cialdinis-principles-persuasion/
- Reciprocity: give first. A reactivation message that references something of value (a shared memory, a specific compliment anchored to their profile) triggers the reciprocity reflex.
- Liking: "we are more likely to respond to someone we like, who likes us, who we can identify with because we see enough points of similarity." The specific reference in the reactivation message (vs. generic opener) increases perceived similarity and liking.
- Unity (Cialdini's 7th principle, added later): shared identity. "We were talking about X" invokes group membership. This is why referencing the last real conversation topic is so effective — it re-activates the "we" framing.

---

## 3. Networking Re-engagement

### Keith Ferrazzi — Never Eat Alone
- Source: https://readingraphics.com/book-summary-never-eat-alone/
- Core ping strategy: "ping your contacts at least a few times a year — not just when you need something." The key word is *not when you need something*. The reactivation message must feel like it came from abundance, not scarcity.
- Contact categorization system: Ferrazzi uses tiers (1 = deep, 2 = quarterly touch-base, 3 = annual). "Ghosted" matches are tier-2 or tier-3 — the relationship exists, it just needs a low-cost activation.
- Birthday principle: best time to reconnect is a natural, expected moment (birthday, job change, shared event). For dating, this maps to: season change ("it finally got warm"), something on their profile that's seasonal, a relevant news item they'd care about.
- **Never keep score**: Ferrazzi's framework is explicitly reciprocal and non-transactional. Applied to reactivation: you're not "owed" a response. If you burn the attempt on guilt or expectation, you've wasted it.

### MIT Sloan — Dormant Ties Research (Levin, Walter, Murnighan)
- Source: https://sloanreview.mit.edu/article/the-power-of-reconnection-how-dormant-ties-can-surprise-you/
- **Core finding**: dormant ties are as valuable — often MORE valuable — than active ties. Advice from dormant ties tends to be more novel and more efficient to get than from current ties.
- Why: the dormant contact wasn't hibernating while you were apart. They accumulated new experiences, perspectives, context. The reconnection unlocks this fresh capital.
- For dating translation: she's had new experiences since you last talked. A reactivation message that references something genuinely new (about you or about the world) reactivates fresh curiosity, not stale history.
- Trust doesn't fade: "old feelings of trust and a common perspective do not fade away and are rekindled almost immediately." This is why the 14-day reactivation window is so powerful — enough time for the slate to feel fresh, not so long that the trust has degraded.

---

## 4. Customer Success / Lapsed Client

### SaaS NRR Recovery — Gainsight / ChurnZero Patterns
- Source: https://altiorco.com/resources/blog/churn-reduction + saascity.io
- At-risk detection: early churn signals appear well before the actual cancel. For relationships: the "ghosted" mark in clapcheeks is the equivalent of a usage dip — early enough to intervene.
- Win-back rate benchmarks: "use cancellation flows to recover 10-15% of exits." In dating context: 10-15% reactivation rate on true ghosts is a realistic and worthwhile target.
- The reason for lapse matters more than the lapse itself. SaaS playbook: segment churned users by *reason for leaving* before crafting the message. Dating equivalent: segment ghosted matches by stage (opener-ghost vs. post-conversation ghost vs. post-date-ask ghost) and tailor the message accordingly. This is exactly what `_DEFAULT_TEMPLATES` does.

### Braze / ActiveCampaign Win-back Patterns
- Source: https://www.braze.com/resources/articles/what-is-a-win-back-campaign-anyway
- Omnichannel sequencing: email first → SMS second → push third. For dating: app message → Instagram DM → email (if exchanged).
- The "last chance" message: explicitly framing the final outreach as the last reduces friction (no more wondering "should I try again?") while creating mild scarcity. Clapcheeks's `reactivation_max_attempts=2` hard cap makes every second attempt implicitly the last.
- Sunset non-responders: maintaining a clean "burned" list is as important as the reactivation itself. Continuing to pursue non-responders (after max attempts) damages self-respect and wastes effort.

---

## 5. Cross-Domain Analysis — Universal Patterns

### What Every Framework Agrees On

1. **Specific beats generic, always.** Whether it's sales, dating, or friendship — the message that references something real about the person converts. Generic openers fail because they signal mass outreach.

2. **Low investment signals high value.** Paradoxically, the shorter and more casual the reactivation message, the more interested the recipient is. A long, effortful message signals desperation. A brief, light message signals you have options.

3. **The gap itself is irrelevant.** No successful re-engagement framework asks you to address the gap. Ferrazzi doesn't say "I know I haven't called in 6 months, but..." Kennedy doesn't start with an apology. Manson doesn't recommend explaining the silence. Jump over the gap. The gap is neutral.

4. **Attempt caps exist for a reason.** Two to three attempts, then walk away. This is consistent across every framework: Manson's 3-chance rule, Klaviyo's 3-email winback flow, Bloomreach's sunset cadence, Ferrazzi's tiered contact system. The walk-away is not failure — it's resource allocation.

5. **Timing is the leverage point.** The optimal window for re-engagement (14 days for dating openers, 45 days for post-conversation) isn't arbitrary — it's where enough time has passed for the emotional friction to fade, but not so long that the person has forgotten you entirely.

6. **The recipient's agency is paramount.** Every ethical framework (Manson, Cialdini's proper application, Ferrazzi) respects that the other person can say no. The reactivation message is an invitation, not a demand. Anything coercive, guilt-inducing, or pressure-based is both unethical and counterproductive.

### Universal Banned Phrases (cross-domain)
These fail in **every** domain — sales, dating, networking, client reactivation:

| Phrase | Why It Fails |
|--------|-------------|
| "Just checking in" | Signals no real reason to reach out; pure obligation |
| "I know it's been a while" | Draws attention to the gap; forces them to relitigate it |
| "Hey stranger" | Ironic distance; feels like a form letter |
| "Long time no talk/see" | Same as above; passive-aggressive undertone |
| "Circling back" | Sales-speak; instantly reads as mass outreach |
| "Touching base" | Same; the phrase itself signals you have nothing new to say |
| "Did I do something wrong?" | Guilt-induction; puts pressure on the recipient |
| "Miss me?" | Clingy, presumptuous |
| "Remember me?" | Self-deprecating in a way that isn't charming |
| "Hope you're doing well" | Filler that precedes every cold template ever sent |
| "Bumping this" | Visible automation; death to any warm relationship |

### Universal Effective Patterns
| Pattern | Why It Works | Example |
|---------|-------------|---------|
| Specific reference to shared context | Cialdini reciprocity + liking; triggers "we" frame | "that hiking trail you mentioned" |
| Something new about your life | Reactivates curiosity; fulfills the dormant-tie novelty principle | "just got back from..." |
| Low-pressure invite | Manson's polarize-without-pressure principle | "you should come if you're around" |
| Relevance anchor | Connects their reality to your outreach | "saw this and thought of you" |
| Honest casualness | Signals abundance; low investment | "random thought but..." |

---

## 6. Operator Decision Framework

### When to Walk Away vs. Try Again

Consistent across Manson, Kennedy, Ferrazzi, Klaviyo, Bloomreach, Gainsight:

**Walk away when:**
- You've sent 2 reactivation attempts at the defined intervals
- The person has actively indicated disinterest (blocked, rude reply, explicit no)
- The reactivation has a terminal outcome flag (burned, opted_out)
- You're starting to feel resentment or pressure — that leaks into the message

**Try again when:**
- Only 1 attempt has been made
- Significant time has passed since the last attempt (45d+ quiet window)
- There's a genuinely new reason to reach out (new context, shared event, something on their profile changed)
- You feel genuinely light and unattached to the outcome

**The confidence/effort calibration rule:** the amount of effort in the reactivation message should be *inversely proportional* to how much you care about the outcome. If you've worked hard on the message, you're too attached. Rewrite it in under 30 seconds.

---

## Sources

1. Aaron Ross / Predictable Revenue: https://www.saastr.com/re-igniting-growth-with-predictable-revenue/
2. Klaviyo Win-Back: https://www.klaviyo.com/blog/winback-email-campaign-examples
3. Bloomreach Reactivation Docs: https://documentation.bloomreach.com/engagement/docs/reactivation-campaign-for-lapsing-and-lapsed
4. Mark Manson — Models summary: https://thepowermoves.com/models/
5. Robert Greene — Art of Seduction summary: https://thepowermoves.com/the-art-of-seduction-summary/
6. MIT Sloan — Dormant Ties research: https://sloanreview.mit.edu/article/the-power-of-reconnection-how-dormant-ties-can-surprise-you/
7. Nature Communications — Reconnecting old friends: https://www.nature.com/articles/s44271-024-00075-8
8. Keith Ferrazzi — Never Eat Alone summary: https://readingraphics.com/book-summary-never-eat-alone/
9. Cialdini Principles: https://cxl.com/blog/cialdinis-principles-persuasion/
10. Braze Win-back: https://www.braze.com/resources/articles/what-is-a-win-back-campaign-anyway
11. ActiveCampaign Win-back: https://www.activecampaign.com/blog/win-back-email-campaigns
12. Gainsight Churn Guide: https://www.gainsight.com/essential-guide/churn/
13. B2B Dead Lead Reviver: https://www.poweredbysearch.com/blog/dead-lead-reviver/
14. SaaS Churn Reduction: https://altiorco.com/resources/blog/churn-reduction
15. National Geographic — Reconnect old friends: https://www.nationalgeographic.com/science/article/reconnect-old-friends-loneliness-social-media
