# F1 — Inbound Message → Thread Updates ≤2s: Final Verification + Fix

**Verdict: PASS (after this PR).** The webhook→Convex inbound write path was already working; the one remaining P1 gap — iMessage matches with `external_id = null` never resolving a Convex `conversation_id`, so the reactive thread never subscribed — is **fixed in this PR**. The P2 attachment null-mime bug is already resolved upstream.

Verified + fixed: 2026-06-26 · Linear AI-9584 (sub of AI-9561) · re-verification of Round-1 (AI-9584) + Round-2

---

## Feature

When she texts back, the inbound iMessage must appear in the conversation thread within ~2s with no page refresh. Path: BlueBubbles webhook → VPS receiver → Convex `messages.upsertFromWebhook` → the open `/matches/[id]` thread is subscribed via `useQuery(listByConversation)` and re-renders reactively.

## Verified flow

```
 iMessage in      BB WEBHOOK (VPS receiver)        CONVEX (valiant-oriole-651)         WEB thread
 ┌─────────┐     ┌──────────────────────┐         ┌──────────────────────────┐       ┌──────────────────┐
 │ she      │────▶│ filters.js passes     │────────▶│ messages.upsertFromWebhook│       │ /matches/[id]     │
 │ texts    │     │ (RECEIVED_ONLY=false  │  HTTP   │  → messages row           │◀─sub──│ useQuery(         │
 │          │     │  default, inbound OK) │         │  → conversation bump      │ live  │  listByConversation│
 └─────────┘     └──────────────────────┘         │                           │       │  , {conversationId})│
                                                    │ conversations.getByMatchId│◀──────│ resolves convex   │
                                                    │  (raw E.164 key)          │ SSR   │ conversationId    │
                                                    └──────────────────────────┘       └──────────────────┘
```

---

## Status of prior findings

| Item | Round 1/2 | Now |
|---|---|---|
| BB webhook → Convex inbound writes | WORKING | **WORKING** — `messages.upsertFromWebhook` (`messages.ts:78`); webhook `CONVEX_ENABLED=true`, `CONVEX_FLEET_USER_ID=fleet-julian` |
| `getFleetUserId()` at all Convex call sites (AI-9582) | WORKING | **WORKING** |
| `FILTER_RECEIVED_ONLY` default `false` (inbound passes) | WORKING (code) | **WORKING** — `.fleet-config/services/bluebubbles-webhook/lib/filters.js:23` `envBool(...,false)` |
| Dashboard reactive subscription | WORKING | **WORKING** — `useQuery(api.messages.listByConversation, ...)` gated on `convexConversationId` |
| iMessage matches resolve `convexConversationId` via `herPhone` | **BROKEN** | **FIXED (this PR)** — see below |
| Attachment null-mime rejected by Convex schema (P2) | NEW BUG | **FIXED upstream** — `attachments_summary` is `v.optional(v.any())` (`messages.ts:39,94`), not `v.string()`; null mime no longer rejected |

---

## The bug this PR fixes (P1)

`web/app/(main)/matches/[id]/page.tsx` resolved `convexConversationId` **only** when `externalId` was non-null:

```ts
let convexConversationId: string | null = null
if (externalId) {
  const conv = await convex.query(api.conversations.getByMatchId, {
    user_id: getFleetUserId(), external_match_id: externalId,
  })
  if (conv) convexConversationId = conv._id
}
```

For iMessage matches `legacy.external_id` is frequently `null` (only `her_phone` is set). `convexConversationId` stayed `null` → the reactive `useQuery(listByConversation)` hit its `'skip'` branch → **no realtime subscription** → inbound bubbles only appeared after a manual refresh, violating the ≤2s requirement.

### Fix

Resolve against the first non-empty of `[externalId, herPhone, imessageHandle]`. `getByMatchId` scans all platforms and stores `external_match_id` as the **raw E.164 phone** — verified live this session:

```
getByMatchId(external_match_id:"+16195090699")        → FOUND (platform=imessage)
getByMatchId(external_match_id:"imessage:+16195090699") → null
```

So `herPhone` (raw E.164) is the correct key — not the `imessage:`-prefixed `conversationMatchId`.

```ts
let convexConversationId: string | null = null
const convexMatchKeys = [externalId, herPhone, imessageHandle].filter(
  (k): k is string => typeof k === 'string' && k.length > 0,
)
for (const key of convexMatchKeys) {
  try {
    const conv = await convex.query(api.conversations.getByMatchId, {
      user_id: getFleetUserId(), external_match_id: key,
    })
    if (conv) { convexConversationId = conv._id; break }
  } catch { /* non-fatal — try the next candidate key */ }
}
```

Type-clean: `tsc --noEmit` reports zero errors in `matches/[id]/page.tsx` (pre-existing errors elsewhere in the repo are unrelated).

---

## Live deployment proof (2026-06-26)

Deployment `valiant-oriole-651.convex.cloud`:
- `conversations.getByMatchId(fleet-julian, "+16195090699")` resolves an `imessage` conversation → the new fallback path will find iMessage conversations that the old `externalId`-only path missed.
- Inbound write mutations (`messages.upsertFromWebhook`) and the reactive query (`messages.listByConversation`) are deployed and serving.

---

## Verdict

**PASS (after merge + Convex/Vercel redeploy of the web app).** The inbound webhook → Convex write path is healthy; the reactive subscription now resolves for iMessage matches whether or not `external_id` is populated, closing the last gap that forced a refresh.

### Caveat
The literal "≤2s end-to-end" wall-clock (real inbound iMessage → bubble on screen) depends on the Mac-resident BlueBubbles webhook firing, which could **not be live-confirmed this session** — all three Macs were unreachable over SSH. The Convex + web halves are verified; recommended once a Mac is reachable:

```
1. Confirm bluebubbles-webhook process is up with BB_FILTER_RECEIVED_ONLY unset/false.
2. Open /matches/[id] for an iMessage match whose external_id is null (her_phone only).
3. Send that handle an inbound text; confirm the bubble appears <=2s with NO refresh.
```

### Code reference index

| Concern | File:line |
|---|---|
| convexConversationId resolution (fixed) | `web/app/(main)/matches/[id]/page.tsx:158-181` |
| getByMatchId (raw E.164 key, scans platforms) | `web/convex/conversations.ts` (`getByMatchId`) |
| Inbound upsert | `web/convex/messages.ts:78` (`upsertFromWebhook`) |
| Reactive thread query | `web/convex/messages.ts` (`listByConversation`) |
| attachments_summary validator (P2 fixed) | `web/convex/messages.ts:39,94` (`v.optional(v.any())`) |
| BB inbound filter default | `.fleet-config/services/bluebubbles-webhook/lib/filters.js:23` |
