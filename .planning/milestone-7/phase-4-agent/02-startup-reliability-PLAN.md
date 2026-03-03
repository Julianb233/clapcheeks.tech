---
plan: "Startup Validation & Queue Backoff"
phase: "Phase 4: Agent Reliability"
wave: 2
autonomous: true
requirements: [AGENT-02, AGENT-03]
goal: "Validate required env vars before threads start, replace fixed-interval queue retry with exponential backoff"
---

# Plan 02: Startup Validation & Queue Backoff

**Phase:** Phase 4 — Agent Reliability
**Requirements:** AGENT-02, AGENT-03
**Priority:** P1
**Wave:** 2

## Context

- Agent starts successfully but crashes mid-session when `KIMI_API_KEY` or `ANTHROPIC_API_KEY` is missing — no early warning
- `flush_queue()` retries at fixed interval — hammers Supabase during outages; `MAX_RETRIES=10` silently drops messages after ~5 hours

## Tasks

### Task 1: Add env var validation at startup (AGENT-02)

Find daemon startup code. Add validation function before any worker threads start:

```python
import os
import sys

REQUIRED_ENV_VARS = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'DEVICE_ID',
]

OPTIONAL_ENV_VARS = [
    ('KIMI_API_KEY', 'AI opener generation will be disabled'),
    ('ANTHROPIC_API_KEY', 'Claude AI features will be disabled'),
    ('OPENAI_API_KEY', 'OpenAI features will be disabled'),
]

def validate_env():
    """Validate environment variables before starting workers."""
    print("[STARTUP] Validating environment...")

    # Check required vars — hard fail
    missing_required = [v for v in REQUIRED_ENV_VARS if not os.environ.get(v)]
    if missing_required:
        print(f"[FATAL] Missing required env vars: {', '.join(missing_required)}")
        print("Run `clapcheeks setup` to configure your environment.")
        sys.exit(1)

    # Check optional vars — warn only
    for var, consequence in OPTIONAL_ENV_VARS:
        if not os.environ.get(var):
            print(f"[WARN] {var} not set — {consequence}")
        else:
            print(f"[OK]   {var} is set")

    print("[STARTUP] Environment validation passed")

# Call validate_env() BEFORE starting any worker threads
if __name__ == '__main__':
    validate_env()
    start_workers()
```

### Task 2: Add exponential backoff to queue retry logic (AGENT-03)

Find `flush_queue()` or queue polling code in the agent:

```python
import time
import random

MAX_RETRIES = 50          # Increased from 10
INITIAL_BACKOFF = 5       # seconds
MAX_BACKOFF = 300         # 5 minutes max wait

def flush_queue_with_backoff():
    """Send queued messages with exponential backoff on failures."""
    retry_count = 0
    current_backoff = INITIAL_BACKOFF

    while True:
        try:
            result = flush_queue()  # existing flush function
            # Success — reset backoff
            if retry_count > 0:
                print(f"[QUEUE] Recovered after {retry_count} retries")
            retry_count = 0
            current_backoff = INITIAL_BACKOFF
            return result

        except Exception as e:
            retry_count += 1

            if retry_count >= MAX_RETRIES:
                print(f"[ERROR] Queue flush failed after {MAX_RETRIES} retries — dropping batch")
                # Notify dashboard of dropped messages
                push_agent_status('degraded', affected_platform=None)
                push_dropped_messages_warning()
                retry_count = 0
                current_backoff = INITIAL_BACKOFF
                return

            # Exponential backoff with jitter
            jitter = random.uniform(0, current_backoff * 0.1)
            wait = min(current_backoff + jitter, MAX_BACKOFF)
            print(f"[QUEUE] Flush failed (attempt {retry_count}/{MAX_RETRIES}): {e}. Retrying in {wait:.1f}s")
            time.sleep(wait)
            current_backoff = min(current_backoff * 2, MAX_BACKOFF)


def push_dropped_messages_warning():
    """Notify Supabase that messages were dropped due to persistent failures."""
    try:
        supabase.table('clapcheeks_agent_tokens').update({
            'degraded_reason': 'Message queue dropped — persistent send failures'
        }).eq('device_id', os.environ.get('DEVICE_ID', 'default')).execute()
    except Exception:
        pass  # Don't let notification failure cascade
```

Replace existing queue polling interval call with `flush_queue_with_backoff()`.

## Acceptance Criteria

- [ ] `validate_env()` runs before any worker threads start
- [ ] Missing required vars (`SUPABASE_URL`, `SUPABASE_KEY`) causes immediate exit with clear message
- [ ] Missing optional vars (`KIMI_API_KEY`, `ANTHROPIC_API_KEY`) print warnings and continue
- [ ] Queue retry uses exponential backoff starting at 5s, max 5 min
- [ ] `MAX_RETRIES` increased to 50
- [ ] Dashboard notified when retry limit exceeded
- [ ] Startup logs show `[OK]` for each set env var

## Files to Modify

- `agent/daemon.py` — `validate_env()` function, startup call
- `agent/queue_poller.py` (or wherever `flush_queue` lives) — replace with backoff version
