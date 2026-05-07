import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Convex scheduled functions — replaces pg_cron + worker pollers on Postgres.
// Linear: AI-9196 — Phase 3.

const crons = cronJobs();

// Drain due scheduled_messages every 30 seconds. Replaces the previous
// PG worker that polled clapcheeks_scheduled_messages.
crons.interval(
  "send-due-scheduled-messages",
  { seconds: 30 },
  internal.scheduled_messages.sendDue,
);

// Advance the drip state machine every 5 minutes. Replaces the periodic
// pg_cron that touched drip rows for cold conversations.
crons.interval(
  "advance-drip-states",
  { minutes: 5 },
  internal.drip.advance,
);

// Reap stuck agent jobs (locked_until expired) every 2 minutes.
crons.interval(
  "reap-stuck-agent-jobs",
  { minutes: 2 },
  internal.agent_jobs.reapStuck,
);

// Reconcile conversation last_message_at + unread_count every 10 minutes
// in case a write was dropped or the agent disconnected mid-batch.
crons.interval(
  "reconcile-conversations",
  { minutes: 10 },
  internal.conversations.reconcile,
);

// AI-9449 — Run courtship enrichment every 6 hours. Sweep finds CC TECH
// people whose courtship_last_analyzed is stale (>7 days), schedules
// enrichCourtshipForOne staggered 6s apart, max 10 per sweep.
crons.interval(
  "enrich-courtship-sweep",
  { hours: 6 },
  internal.enrichment.sweepCourtshipCandidates,
);

// AI-9449 — Re-classify conversation vibe (dating | platonic | professional)
// every 6 hours for people with active conversations whose vibe_classified_at
// is stale (>30 days). Same staggered scheduling as courtship sweep.
crons.interval(
  "vibe-classify-sweep",
  { hours: 6 },
  internal.enrichment.sweepVibeCandidates,
);

// AI-9449 Phase A — drainDue safety net for scheduled_touches. Each touch
// schedules itself via runAt (no polling), but if the daemon / Convex deploy
// missed a fire, this catches it within 60s.
crons.interval(
  "scheduled-touches-drain",
  { minutes: 1 },
  internal.touches.drainDue,
);

// AI-9449 — Daily morning digest (9am Pacific = 17:00 UTC; cron is UTC).
// Generates ranked list of active conversations + draft replies, queues a
// send_digest_to_julian job for the Mac Mini daemon to deliver.
crons.cron(
  "daily-digest-9am-pacific",
  "0 17 * * *",
  internal.digest.generateDaily,
);

// AI-9449 — Date-ask sweep every 6h. When time_to_ask_score crosses 0.7
// AND no recent ask, schedules a date_ask touch to fire 30-90 min later.
crons.interval(
  "ask-for-the-date-sweep",
  { hours: 6 },
  internal.enrichment.sweepAskCandidates,
);

// AI-9449 Wave 2.2 — Calendar slot refresh every 30 min. Enqueues a
// fetch_calendar_slots job for the Mac Mini daemon to run gws calendar
// against Julian's primary + CONSULTING + SALES CALLS + Work IN THE Business
// calendars and write free/busy back into calendar_slots.
crons.interval(
  "calendar-slots-refresh",
  { minutes: 30 },
  internal.calendar.enqueueFetchJob,
  { user_id: "fleet-julian" },
);

// AI-9500-C: Enqueue a Hinge message sync job every 5 minutes.
// The local Mac Mini agent (convex_runner.py) claims and executes the job
// via hinge_poller.poll_hinge(). Dedup guard inside enqueueHingeSync prevents
// pile-up if the previous tick hasn't completed yet.
crons.interval(
  "enqueue-hinge-sync",
  { minutes: 5 },
  internal.agent_jobs.enqueueHingeSync,
);

// AI-9500-E — Reply-velocity mirror weekly recalibration.
// Every Monday at 03:00 UTC, refit cadence_overrides for all people with
// enough recent message volume (total_messages_30d > 30). Staggered 5s
// per person inside the mutation to spread DB writes.
crons.weekly(
  "recalibrate-cadence-sweep",
  { dayOfWeek: "monday", hourUTC: 3, minuteUTC: 0 },
  internal.enrichment.recalibrateCadenceSweep,
);

// AI-9500-F: Fatigue detection sweep every 12 hours.
// Finds people whose engagement slope is negative (last 5 msgs trending down),
// last inbound > 3d ago, and no pattern_interrupt in last 14d — then schedules
// a pattern_interrupt touch jittered 0-6h from now within active_hours_local.
// Idempotent: skips people with a pattern_interrupt already scheduled/fired
// in the last 14 days.
crons.interval(
  "fatigue-detection-sweep",
  { hours: 12 },
  internal.enrichment.sweepFatigueDetection,
);

export default crons;
