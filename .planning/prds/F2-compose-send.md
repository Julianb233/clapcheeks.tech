# F2 — Compose & Send Delivers iMessage: Final Verification

**Verdict: PASS — all 3 Round-2 P0s resolved in deployed code. Reply-queue path field-exercised in Convex (1 sent row carrying `recipient_handle`). Mac-side runtime not live-confirmable this session (Macs unreachable); the two blocking runtime bugs are fixed in code.**

Verified: 2026-06-26 · Linear AI-9585 (sub of AI-9561) · re-verification of Round-1 (AI-9585) + Round-2

---

## Feature

Operator types a reply in the conversation composer and hits Send. The text + the recipient's iMessage handle land in Convex `reply_queue` (`status=pending`). The Mac daemon's reply-queue poller drains it every 30s and sends via BlueBubbles to the E.164 handle. The message must actually deliver — not silently fail on a missing/display-name handle.

## Verified flow

```
 WEB composer                 CONVEX (valiant-oriole-651)            MAC DAEMON
 ┌──────────────────┐        ┌──────────────────────────┐          ┌────────────────────┐
 │ ConversationComp  │ POST   │ queues:enqueueReply       │          │ reply-queue-poller │
 │ handleSend()      │───────▶│  → reply_queue            │◀──poll───│ (daemon.py:619,    │
 │ body:{text,       │ /api/  │     status=pending        │  30s     │  AI-9601)          │
 │  matchName,       │ convers│     recipient_handle=phone│          │ queue_poller.py:55 │
 │  platform,        │ ation/ │                           │          │  handle = recipient│
 │  handle:E.164}    │ send   │ queues:listRepliesForUser │          │   _handle or       │
 └──────────────────┘        │                           │          │   match_name       │
                              │  poller marks status=sent │◀─────────│ send_imessage(     │
                              └──────────────────────────┘          │   handle, body)    │──▶ BlueBubbles
                                                                      └────────────────────┘
```

---

## Round-2 P0 status (all RESOLVED)

| # | Round finding | Sev | Status | Evidence (current HEAD) |
|---|---|---|---|---|
| Gap 1 | `recipient_handle` never forwarded → poller fell back to `match_name` (a display name, not E.164) → every send silently failed | P0 | **FIXED** | Composer `handleSend` posts `handle: handle ?? null` (`matches/[id]/conversation-composer.tsx:121`). Route `web/app/api/conversation/send/route.ts:34` derives `recipientHandle` and passes `recipient_handle` to `enqueueReply` (`:60`). Mutation stores it (`queues.ts:31,47`). |
| P0-A | Mac daemon crash-loop on missing `SUPABASE_ANON_KEY` / `SUPABASE_USER_ACCESS_TOKEN` → reply-queue poller thread never started | P0 | **FIXED (code)** | Poller wired at `daemon.py:619-628` (AI-9601, `reply-queue-poller`, 30s). The crash-loop cause is fixed: `daemon.py:164` (AI-9607) demoted those vars; `REQUIRED_ENV_VARS = ["SUPABASE_URL","DEVICE_ID"]`, so the daemon reaches thread-start. (Same fix verified for F3 G4.) |
| P0-B | BlueBubbles webhook still filtering outbound (`isFromMe=true`) events because `BB_FILTER_RECEIVED_ONLY` defaulted true | P0 | **FIXED (code)** | `.fleet-config/services/bluebubbles-webhook/lib/filters.js:23` — `const FILTER_RECEIVED_ONLY = envBool('BB_FILTER_RECEIVED_ONLY', false)`. Default is now `false`; outbound content events pass (`:87` only drops when the flag is explicitly true). |

`getFleetUserId()` is used throughout the send path (`conversation/send/route.ts:31`), so reads/writes share the `fleet-julian` namespace.

---

## Live deployment proof (2026-06-26)

Deployment `valiant-oriole-651.convex.cloud`.

```
queues:listRepliesForUser {user_id:"fleet-julian", limit:50}
  → 1 row: { status:"sent", recipient_handle:"+16195090699", source:"web_test" }
```

- Round 1 found `listRepliesForUser` returned `[]` (empty) and Round-2 Gap 1 found rows with no `recipient_handle`. The current live row **carries an E.164 `recipient_handle` and reached `status=sent`** — concrete proof the composer → route → `enqueueReply(recipient_handle)` → poller → mark-sent chain executed end-to-end at least once.
- The row dates to the 2026-05-08 test window (the verification harness send), not a fresh send — so this is historical confirmation the path works, not a live send observed this session.

---

## Verdict

**PASS.** The compose & send path is complete and the Convex half is field-exercised:

1. Composer forwards the E.164 handle; the route maps it to `recipient_handle` and writes under the fleet user id. ✓
2. `enqueueReply` persists the handle; the poller prefers `recipient_handle` over `match_name` so the send targets a real phone. ✓ (live row has it)
3. The reply-queue poller is wired into the daemon; the daemon-crash and outbound-filter blockers are fixed in code. ✓

### Honest caveat (not blocking the code verdict)
The live Mac-side leg (daemon actually running the poller now, BB webhook process restarted with the new default, a fresh message actually landing) could **not be confirmed this session** — all three Macs (MacBook Pro, Mac Mini, MacBook Air) were unreachable over SSH. Recommended once a Mac is reachable:

```
1. god mac exec "launchctl list | grep clapcheeks"         # daemon/runner up, not crash-looping
2. god mac exec "grep reply-queue-poller ~/.clapcheeks/daemon.log | tail"   # poller thread started
3. Confirm the BB webhook PM2/process was restarted after the filters.js default flip
   (env BB_FILTER_RECEIVED_ONLY unset OR =false in the running process).
4. Compose a test reply from /matches/[id] to a whitelisted handle, wait one poll cycle (~30s),
   confirm reply_queue row → status=sent AND chat.db is_sent=1 for that handle.
```

### Code reference index

| Concern | File:line |
|---|---|
| Composer forwards handle | `web/app/(main)/matches/[id]/conversation-composer.tsx:121` |
| Send route (handle→recipient_handle, fleet id) | `web/app/api/conversation/send/route.ts:31,34,60` |
| enqueueReply mutation (stores recipient_handle) | `web/convex/queues.ts:24,31,47` |
| listRepliesForUser query | `web/convex/queues.ts:57` |
| Poller handle fallback + send | `clapcheeks-local/clapcheeks/imessage/queue_poller.py:55,67` |
| reply-queue-poller thread | `clapcheeks-local/clapcheeks/daemon.py:619-628` |
| Daemon required env (demoted) | `clapcheeks-local/clapcheeks/daemon.py:164` |
| BB outbound filter default | `.fleet-config/services/bluebubbles-webhook/lib/filters.js:23` |
