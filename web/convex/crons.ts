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

// AI-9449 Phase A — safety-net drain for scheduled_touches rows whose
// runAt fired event was dropped (process crash, etc.). Every 5 minutes,
// pick up any "scheduled" rows past their time and re-fire them.
crons.interval(
  "drain-due-scheduled-touches",
  { minutes: 5 },
  internal.touches.drainDue,
);

// AI-9500-C: Enqueue a Hinge SendBird sync job every 5 minutes.
// The Mac Mini agent (convex_runner.py) claims and executes the job.
// Dedup guard in enqueueHingeSync prevents queue flooding if the previous
// job hasn't been claimed yet.
crons.interval(
  "enqueue-hinge-sync",
  { minutes: 5 },
  internal.agent_jobs.enqueueHingeSync,
);

export default crons;
