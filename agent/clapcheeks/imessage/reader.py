"""iMessage chat.db reader — read-only SQLite access to conversations.

Includes runtime Full Disk Access (FDA) detection: if FDA is revoked
after startup, iMessage features gracefully degrade instead of crashing.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"

# iMessage stores dates as nanoseconds since 2001-01-01
_APPLE_EPOCH = datetime(2001, 1, 1)

log = logging.getLogger(__name__)

# Module-level FDA availability flag
_fda_available = True
_fda_lock = threading.Lock()
FDA_RECHECK_INTERVAL = 300  # 5 minutes


def check_fda() -> bool:
    """Check if Full Disk Access is available by probing chat.db."""
    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
        conn.execute("SELECT 1 FROM message LIMIT 1")
        conn.close()
        return True
    except (sqlite3.OperationalError, PermissionError, OSError):
        return False


def _fda_recheck_loop() -> None:
    """Periodically re-check FDA so iMessage auto-re-enables if permission restored."""
    global _fda_available
    while True:
        time.sleep(FDA_RECHECK_INTERVAL)
        with _fda_lock:
            if not _fda_available and check_fda():
                log.info("[FDA] Full Disk Access restored — re-enabling iMessage features")
                _fda_available = True


# Start FDA re-check in a daemon thread
_fda_thread = threading.Thread(target=_fda_recheck_loop, daemon=True)
_fda_thread.start()


def _apple_ts_to_datetime(ts: int | None) -> datetime | None:
    """Convert CoreData nanosecond timestamp to Python datetime."""
    if ts is None or ts == 0:
        return None
    return _APPLE_EPOCH + timedelta(seconds=ts / 1e9)


class IMMessageReader:
    """Read-only access to the macOS iMessage SQLite database.

    Handles runtime FDA revocation gracefully — all read methods return
    empty results instead of crashing when permission is denied.
    """

    def __init__(self, db_path: Path = CHAT_DB) -> None:
        self._db_path = db_path
        self._conn = sqlite3.connect(
            f"file:{db_path}?mode=ro",
            uri=True,
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row

    def __enter__(self) -> IMMessageReader:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _handle_permission_error(self, exc: Exception) -> None:
        """Handle FDA revocation — disable iMessage features gracefully."""
        global _fda_available
        with _fda_lock:
            if _fda_available:
                log.warning(
                    "[FDA] Full Disk Access revoked — disabling iMessage features: %s", exc
                )
                _fda_available = False
                # Push degraded status to dashboard
                try:
                    from clapcheeks.daemon import push_agent_status
                    push_agent_status(
                        "degraded",
                        affected_platform="imessage",
                        reason="iMessage access revoked — grant Full Disk Access in System Settings",
                    )
                except Exception:
                    pass

    def get_conversations(self, limit: int = 50) -> list[dict]:
        """Get recent conversations sorted by last message date.

        Returns list of dicts with keys: chat_id, display_name, handle_id,
        last_message_date. Returns empty list if FDA is revoked.
        """
        if not _fda_available:
            return []

        try:
            return self._get_conversations_inner(limit)
        except (PermissionError, sqlite3.OperationalError) as exc:
            self._handle_permission_error(exc)
            return []

    def _get_conversations_inner(self, limit: int = 50) -> list[dict]:
        cursor = self._conn.execute(
            """
            SELECT
                c.ROWID AS chat_id,
                c.display_name,
                h.id AS handle_id,
                MAX(m.date) AS last_date
            FROM chat c
            LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
            LEFT JOIN handle h ON h.ROWID = chj.handle_id
            LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
            LEFT JOIN message m ON m.ROWID = cmj.message_id
            GROUP BY c.ROWID
            ORDER BY last_date DESC
            LIMIT ?
            """,
            (limit,),
        )
        results: list[dict] = []
        for row in cursor.fetchall():
            results.append({
                "chat_id": row["chat_id"],
                "display_name": row["display_name"] or row["handle_id"] or "Unknown",
                "handle_id": row["handle_id"] or "",
                "last_message_date": _apple_ts_to_datetime(row["last_date"]),
            })
        return results

    def get_messages(self, chat_id: int, limit: int = 100) -> list[dict]:
        """Get messages for a conversation, oldest first.

        Returns list of dicts with keys: text, is_from_me, date, handle_id.
        Returns empty list if FDA is revoked.
        """
        if not _fda_available:
            return []

        try:
            return self._get_messages_inner(chat_id, limit)
        except (PermissionError, sqlite3.OperationalError) as exc:
            self._handle_permission_error(exc)
            return []

    def _get_messages_inner(self, chat_id: int, limit: int = 100) -> list[dict]:
        cursor = self._conn.execute(
            """
            SELECT
                m.text,
                m.is_from_me,
                m.date,
                h.id AS handle_id
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date ASC
            LIMIT ?
            """,
            (chat_id, limit),
        )
        results: list[dict] = []
        for row in cursor.fetchall():
            results.append({
                "text": row["text"] or "",
                "is_from_me": bool(row["is_from_me"]),
                "date": _apple_ts_to_datetime(row["date"]),
                "handle_id": row["handle_id"] or "",
            })
        return results

    def get_latest_message(self, chat_id: int) -> dict | None:
        """Get the most recent message in a conversation. Returns None if FDA revoked."""
        if not _fda_available:
            return None

        try:
            return self._get_latest_message_inner(chat_id)
        except (PermissionError, sqlite3.OperationalError) as exc:
            self._handle_permission_error(exc)
            return None

    def _get_latest_message_inner(self, chat_id: int) -> dict | None:
        cursor = self._conn.execute(
            """
            SELECT
                m.ROWID AS rowid,
                m.text,
                m.is_from_me,
                m.date,
                h.id AS handle_id
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date DESC
            LIMIT 1
            """,
            (chat_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "rowid": row["rowid"],
            "text": row["text"] or "",
            "is_from_me": bool(row["is_from_me"]),
            "date": _apple_ts_to_datetime(row["date"]),
            "handle_id": row["handle_id"] or "",
        }

    def close(self) -> None:
        """Close the SQLite connection."""
        self._conn.close()
