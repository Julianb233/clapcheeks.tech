# Convex — Clapcheeks Messaging Engine (Backend Source of Truth)

Convex is the **ONLY active database and data store for the Clapcheeks dating engine**. All dating data has been migrated off Postgres/Supabase and is fully managed, validated, and queried through this Convex directory.

Supabase is used **auth-only** (SaaS user sessions) and for billing/landing-site data.

---

## 🏗️ Table Schema & Required Indexes

The canonical schema is source-controlled in `./schema.ts`. Below is the documentation of the verified active tables and their required indexes:

### 1. `conversations` (Live Chat State)
Tracks active chat channels (iMessage, Tinder, Hinge, Instagram, etc.).
- **Required Indexes:**
  - `by_user` on `["user_id"]`
  - `by_user_status` on `["user_id", "status"]`
  - `by_user_external` on `["user_id", "platform", "external_match_id"]` (External Match ID routing)
  - `by_last_message` on `["user_id", "last_message_at"]` (Sorting active chats)

### 2. `messages` (Message Log & AI Context)
Stores every text/media exchange, inbound from BlueBubbles webhook, or outbound.
- **Required Indexes:**
  - `by_conversation` on `["conversation_id"]`
  - `by_person` on `["person_id"]` (Cross-channel communication logging)

### 3. `matches` (Profile Roster & Scopes)
Stores dating app profiles, screenshots, bios, custom rankings, and photos.
- **Required Indexes:**
  - `by_user_platform_external` on `["user_id", "platform", "external_match_id"]`
  - `by_user_status` on `["user_id", "status"]`

### 4. `outbound_scheduled_messages` (Upcoming Cadences)
Queue of scheduled automated replies, nudges, or manual queue sends.
- **Required Indexes:**
  - `by_status_due` on `["status", "scheduled_at"]` (Fires pending texts on time)

### 5. `approval_queue` (Human-in-the-Loop Safe Sends)
Generated AI suggestions waiting for operator approval before firing.
- **Required Indexes:**
  - `by_user_status` on `["user_id", "status"]`
  - `by_status_expires` on `["status", "expires_at"]`

### 6. `agent_jobs` (Background Worker Queue)
Atomic tasks (scraping Tinder, scoring photos, syncing contacts) claimed by the Mac Mini daemon.
- **Required Indexes:**
  - `by_status_priority` on `["status", "priority"]`
  - `by_user_status` on `["user_id", "status"]`

### 7. `platform_tokens` (Encrypted Sessions)
Encrypted AES-256-GCM platform session tokens captured via Chrome Extension.
- **Required Indexes:**
  - `by_user_platform` on `["user_id", "platform"]`

### 8. `calendar_slots` (Preferred Meetup Windows)
Cached Google Calendar free/busy slots used for proposing 3 date options.
- **Required Indexes:**
  - `by_user_start` on `["user_id", "slot_start_ms"]`

### 9. `device_heartbeats` (Mac Mini Health Monitor)
Heartbeat timestamps reporting MBP daemon active loops.
- **Required Indexes:**
  - `by_user_heartbeat` on `["user_id", "last_heartbeat_at"]`

### 10. `memos` (Dossier Scratchpads)
Operator notes and customized contextual prompts.
- **Required Indexes:**
  - `by_user_handle` on `["user_id", "contact_handle"]`

---

## 🚀 Active Convex Code Modules

| File | Purpose |
|---|---|
| `schema.ts` | Schema, table fields (v-validation), and compound index mappings. |
| `crons.ts` | Serverless schedulers running periodically to advance drips, check for due scheduled messages, and clean up expired jobs. |
| `agent_jobs.ts` | Background worker pool queuing, atomic transaction `claim` locking, and completions. |
| `touches.ts` | Safety brakes, whitelisting, anti-looping checks, local active hours evaluation, and touch firing. |
| `messages.ts` | Query logs, inserts from BlueBubbles webhooks, and marking messages read. |
| `conversations.ts` | Live reactive list/get endpoints driving the React operator dashboard. |

---

## 🩺 Backend Doctor Check (`convex-doctor.py`)

An automated check is checked in at `web/scripts/convex-doctor.py` to ensure zero backend schema drift:
- Validates the existence and validation schemas of all 10 required active Convex tables.
- Validates that required indexing constraints are not modified or dropped.
- Validates that legacy Supabase SQL scripts remain archived.

Run the doctor script locally or in CI/CD:
```bash
python3 web/scripts/convex-doctor.py
```

---

## 🗄️ Supabase Migration Archival

All old Supabase SQL migrations (which mapped the dating engine to Postgres before the Convex transition) have been archived into `supabase/migrations/archive/`. This prevents local CLI dev environment initialization from running redundant or stale SQL tables.
