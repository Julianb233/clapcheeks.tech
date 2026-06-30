# BlueBubbles Multi-Number + Convex Messaging — Architecture Recommendation

> **Issue:** AI-9402 — "Help me set up a way to use BlueBubbles + Convex for live
> messaging across 5 iPhones, ideally one BlueBubbles server with a custom
> configuration for 5 numbers, with a clear recommendation for the best way to
> set that up."
>
> **Status:** Architecture recommendation (this doc). The physical iPhone
> enrollment, Apple ID provisioning, and NotebookLM creation in the original
> prompt require Julian's devices/accounts and are flagged at the bottom.

---

## 1. The load-bearing constraint (read this first)

A single BlueBubbles Server instance bridges **exactly one** Messages.app
account on **one** macOS host. It sends from whatever Apple ID / phone number
that copy of Messages.app is signed into. Our own adapter proves this — the
outbound payload in `agent/clapcheeks/imessage/bluebubbles.py` has **no
sender-account field**:

```python
payload = {
    "chatGuid": f"iMessage;-;{handle}",   # recipient only
    "message": body,
    "method": "private-api",
}
# POST /api/v1/message/text  → sends from the host Mac's active iMessage account
```

There is no `fromHandle` / `account` parameter in the BlueBubbles send API.
BlueBubbles relays through Messages.app, and macOS Messages can only have **one
active sending number per account context**.

**Therefore: "one BlueBubbles server with a custom configuration for 5
different numbers" is not achievable as literally stated.** One server = one
number. Five numbers = five Messages.app contexts = five BlueBubbles servers.

The good news: you can still run all five from **one physical Mac** and present
them to Convex as a single logical inbox/outbox. The "one server" goal becomes
"one host, one routing layer, five lightweight backends" — which is the
practical equivalent and is what's recommended below.

---

## 2. Options compared

| Option | How | True 5-number? | Cost / effort | Verdict |
|---|---|---|---|---|
| **A. 5 macOS VMs on 1 Mac** | One host Mac (Studio/Mini, Apple Silicon) runs 5 lightweight macOS guests via Tart/Anka/UTM; each guest signs into one Apple ID, links one iPhone's number, runs its own BlueBubbles on a unique port | ✅ Yes | One strong Mac + RAM (8–12GB/VM); moderate setup | **RECOMMENDED** |
| B. 5 physical Macs | One Mac per number | ✅ Yes | 5x hardware, 5x power/space | Works, wasteful |
| C. 1 Mac, switch Apple IDs | Sign Messages in/out per send | ❌ No — not concurrent, races, drops inbound | Low | **Do not use** |
| D. 1 Mac, multiple numbers on one Apple ID | iPhone "Text Message Forwarding" can add numbers to one Apple ID, but Messages still sends from ONE selected number at a time on Mac | ❌ No reliable per-message from-number control via BlueBubbles | Low | **Do not use** |
| E. SMS gateway (Twilio A2P) instead of iMessage | Real per-number sending, 10DLC registered | ✅ Yes, but **green bubble, not iMessage** | Carrier fees + 10DLC | Use only if iMessage features aren't required |

**Why A wins:** it's the only option that gives you five genuine, concurrent
iMessage numbers (blue bubbles, tapbacks, effects, typing indicators — the
features `bluebubbles.py` exists for) while keeping hardware to a single Mac and
letting Convex treat all five as one system.

---

## 3. Recommended architecture (Option A)

```
                    Convex (valiant-oriole-651)
        unified inbox · sender_accounts registry · outbound queue
                 ▲ inbound webhook        │ outbound send ▼
            VPS receiver /clapcheeks/bb-webhook  (routes by senderNumber)
                 ▲ (5 webhooks)           │ (picks server by from-number)
   ┌──────────┬──────────┬──────────┬──────────┬──────────┐
   │ VM #1    │ VM #2    │ VM #3    │ VM #4    │ VM #5    │   (one Mac host)
   │ BB :1234 │ BB :1235 │ BB :1236 │ BB :1237 │ BB :1238 │
   │ AppleID1 │ AppleID2 │ AppleID3 │ AppleID4 │ AppleID5 │
   │ number 1 │ number 2 │ number 3 │ number 4 │ number 5 │
   └──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 3.1 Host + virtualization
- **Host:** one Apple-Silicon Mac (Mac Studio ideal; Mac Mini M-series works for
  light campaign volume). Budget ~8–12 GB RAM per guest + headroom.
- **Virtualization:** [Tart](https://github.com/cirruslabs/tart) (free, CLI,
  Apple-Silicon native) is the cleanest. Anka is the paid/enterprise option;
  UTM is the GUI option. macOS license permits up to 2 guest VMs per physical
  Mac under the macOS EULA — **for 5 numbers you legally need at least 3 Macs**
  (2 VMs each) **or** mix VMs + the host's own Messages account. Flag this:
  the strict-EULA path is **3 Macs × (1 host account + ~1 VM)** to reach 5.

> ⚠️ **EULA note:** Apple's macOS license allows max 2 virtual instances per
> Mac. The clean "5 VMs on 1 Mac" diagram violates that. The compliant
> realization of Option A is **2–3 Macs**, each running its own Messages account
> plus 1 VM, totaling 5 numbers. The routing layer below is identical either
> way — only the number of physical hosts changes. Recommend confirming
> appetite for 1-Mac-non-compliant vs 3-Mac-compliant before purchasing.

### 3.2 Per-number BlueBubbles config
Each VM (or host) runs one BlueBubbles Server with:
- Unique **port** (1234–1238) and unique **password**.
- Private API Helper installed + SIP partially disabled (required for
  tapbacks/effects — same requirement our adapter documents).
- Webhook pointed at the VPS receiver, tagged with that server's number.

### 3.3 Convex: the routing layer (the "one server" experience)
Add a `sender_accounts` registry so Convex knows the five backends:

```ts
// web/convex/schema.ts  (new table)
sender_accounts: defineTable({
  user_id: v.string(),            // "fleet-julian"
  number: v.string(),             // E.164, e.g. "+1415..."
  label: v.string(),             // "Campaign A / support / etc."
  bluebubbles_url: v.string(),    // http://host:1234
  // password resolved from 1Password at runtime, NOT stored plaintext
  active: v.boolean(),
  purpose: v.union(v.literal("campaign"), v.literal("support"), v.literal("nurture")),
}).index("by_number", ["number"]).index("by_user", ["user_id"]),
```

- **Inbound:** each BlueBubbles webhook hits the VPS receiver, which stamps the
  receiving `number`, then calls `messages.upsertFromWebhook` with a
  `senderNumber` field so the unified inbox shows which line a contact texted.
- **Outbound:** the campaign/queue picks the right BlueBubbles instance by
  looking up `sender_accounts.by_number`, then POSTs to that instance's URL.
  Outbound rows in `outbound_scheduled_messages` gain a `from_number` field.

This gives Julian a single Convex-backed operator view across all five numbers —
the practical "one server" he wants — without pretending one BlueBubbles
instance can multiplex numbers.

### 3.4 Campaign / nurture engine
Build on the existing `outbound_scheduled_messages` queue + the Mac daemon loop:
- **Segments** → which number sends (e.g. number 1 = cold campaign, number 2 =
  warm nurture, number 3 = support). Keeps campaign traffic off the support
  line so deliverability/blocks on one number don't poison the others.
- **Throttle per number** (Apple rate-limits; spread sends, randomize spacing).
- **Reuse** the LLM cascade in `convex_runner.py` (`send_imessage` /
  `_draft_with_template`) for personalized nurture drafts.

---

## 4. Risk / deliverability notes
- **Apple anti-spam:** bulk identical iMessages from one number get flagged fast.
  Per-number throttling + content variation + warmed numbers are mandatory.
- **Number warming:** new Apple IDs sending blast traffic on day one get
  limited. Ramp volume over 1–2 weeks per line.
- **One blocked line ≠ all blocked:** number-per-purpose segmentation contains
  blast radius. This is the strongest argument for 5 numbers vs 1.
- **Compliance:** any nurture/marketing texting needs opt-in + STOP handling,
  even over iMessage. Wire a STOP keyword handler into the inbound path.

---

## 5. Recommended next steps (in order)
1. **Decide host topology:** 1 Mac (EULA-noncompliant, simplest) vs 3 Macs
   (compliant). → *Julian decision.*
2. Stand up **one** VM + BlueBubbles end-to-end as a reference (port 1234,
   number 1), webhook → VPS → Convex. Prove inbound + outbound round-trip.
3. Add the `sender_accounts` Convex table + `from_number` on the outbound queue.
4. Clone the reference VM x4, sign each into its own Apple ID + iPhone number.
5. Build per-number throttle + segment routing in the campaign engine.
6. Add STOP/opt-out handling before any real campaign send.

---

## 6. Parts of AI-9402 that need Julian (cannot be done autonomously)
- **NotebookLM creation + asset list + link** (prompt items 2–3): requires
  Julian's Google account; an agent cannot create a NotebookLM and "send the
  link." → handle via the `notebooklm` skill in an interactive session.
- **Physical iPhone enrollment** (5 devices, Apple IDs, number linking): needs
  the physical phones and Julian's Apple credentials.
- **Host hardware purchase decision** (1 vs 3 Macs) per the EULA note in §3.1.

These are flagged in the Linear comment; this doc delivers the architecture
recommendation (prompt item 4's core ask) that the rest depends on.

---

*Author: agent6 (autonomous) · AI-9402 · clapcheeks.tech*
