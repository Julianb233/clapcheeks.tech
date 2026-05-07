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

// AI-9500-F — Scan CC TECH people for declining engagement (slope < -0.05 over
// last 5 messages) AND silence > 3d. Schedules a pattern_interrupt touch for
// each qualifying person. Runs every 12h.
crons.interval(
  "fatigue-detection-sweep",
  { hours: 12 },
  internal.enrichment.sweepFatigueDetection,
);

export default crons;
