---
plan: "Log Rotation & FDA Runtime Check"
phase: "Phase 4: Agent Reliability"
wave: 3
autonomous: true
requirements: [AGENT-04, AGENT-05]
goal: "Add log rotation to prevent unbounded log growth, add runtime Full Disk Access re-check with graceful degradation"
---

# Plan 03: Log Rotation & FDA Runtime Check

**Phase:** Phase 4 — Agent Reliability
**Requirements:** AGENT-04, AGENT-05
**Priority:** P2
**Wave:** 3

## Context

- `daemon.log` grows forever with no rotation — eventually fills disk on user's Mac
- Full Disk Access (FDA) check only happens at startup — if user revokes permission later, agent crashes hard instead of gracefully disabling iMessage features

## Tasks

### Task 1: Add log rotation (AGENT-04)

Python's `logging` module has built-in rotation support. Update the logging configuration in the daemon:

```python
import logging
import logging.handlers
import os

def setup_logging():
    """Configure rotating log file handler."""
    log_path = os.path.expanduser('~/.clapcheeks/daemon.log')
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    # Rotate at 10MB, keep 5 files
    handler = logging.handlers.RotatingFileHandler(
        log_path,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8',
    )

    formatter = logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    handler.setFormatter(formatter)

    # Also log to stdout for `clapcheeks logs` to work
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)
    root_logger.addHandler(console_handler)

    return log_path

# Replace print() calls with logging.info(), logging.warning(), logging.error()
```

Update the `clapcheeks logs` CLI command to show last 100 lines:
```bash
# In the clapcheeks CLI script
tail -n 100 ~/.clapcheeks/daemon.log
```

### Task 2: Add runtime Full Disk Access re-check (AGENT-05)

The iMessage reader accesses `~/Library/Messages/chat.db`. If FDA is revoked, the file read raises a `PermissionError`.

1. Wrap all `chat.db` access in an FDA check:
   ```python
   import sqlite3
   import os

   CHAT_DB_PATH = os.path.expanduser('~/Library/Messages/chat.db')
   _fda_available = True  # module-level flag

   def check_fda() -> bool:
       """Check if Full Disk Access is available by probing chat.db."""
       try:
           conn = sqlite3.connect(f'file:{CHAT_DB_PATH}?mode=ro', uri=True)
           conn.execute('SELECT 1 FROM message LIMIT 1')
           conn.close()
           return True
       except (sqlite3.OperationalError, PermissionError):
           return False

   def read_messages_safe():
       """Read new messages, disabling iMessage features if FDA revoked."""
       global _fda_available

       if not _fda_available:
           # Check every 5 minutes if FDA has been re-granted
           return []

       try:
           return read_messages()  # existing function
       except PermissionError as e:
           if _fda_available:  # Only log/notify on transition
               logging.warning(f"[FDA] Full Disk Access revoked — disabling iMessage features: {e}")
               _fda_available = False
               push_agent_status('degraded', affected_platform='imessage')
               # Notify dashboard
               push_fda_warning()
           return []
   ```

2. Add FDA re-check loop (check every 5 minutes to re-enable if permission granted again):
   ```python
   import threading

   def fda_recheck_loop():
       """Periodically re-check FDA so iMessage auto-re-enables if permission restored."""
       global _fda_available
       while True:
           time.sleep(300)  # 5 minutes
           if not _fda_available and check_fda():
               logging.info("[FDA] Full Disk Access restored — re-enabling iMessage features")
               _fda_available = True

   # Start in daemon thread
   threading.Thread(target=fda_recheck_loop, daemon=True).start()
   ```

3. Show FDA warning in dashboard:
   - The `push_agent_status('degraded', 'imessage')` call from AGENT-01 already handles dashboard visibility
   - Ensure the message is descriptive: "iMessage access revoked — grant Full Disk Access in System Settings"

## Acceptance Criteria

- [ ] `daemon.log` rotates at 10MB
- [ ] 5 historical log files kept (`daemon.log.1` through `daemon.log.5`)
- [ ] `clapcheeks logs` shows last 100 lines from current log file
- [ ] `PermissionError` on `chat.db` disables iMessage features gracefully (no crash)
- [ ] Dashboard shows warning when FDA is revoked
- [ ] Agent automatically re-enables iMessage features when FDA is restored (within 5 min)
- [ ] No unhandled exceptions from `read_messages()` when FDA denied

## Files to Modify

- `agent/daemon.py` — `setup_logging()` with rotation
- `agent/imessage_reader.py` (or equivalent) — `read_messages_safe()`, FDA re-check loop
- CLI install script or `clapcheeks` shell script — `logs` subcommand
