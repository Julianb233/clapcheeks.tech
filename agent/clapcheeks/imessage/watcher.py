"""iMessage watcher — polls chat.db for new incoming messages and auto-replies."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from rich.console import Console
from rich.panel import Panel

from clapcheeks.imessage.sender import send_imessage

if TYPE_CHECKING:
    from clapcheeks.imessage.ai_reply import ReplyGenerator
    from clapcheeks.imessage.reader import IMMessageReader

logger = logging.getLogger(__name__)
console = Console()

STATS_DIR = Path.home() / ".clapcheeks"
STATS_FILE = STATS_DIR / "imessage_stats.jsonl"

# Minimum seconds to wait before replying (human-like delay)
_MIN_REPLY_DELAY = 8
_MAX_REPLY_DELAY = 45


def _log_stat(chat_id: int, action: str, contact: str) -> None:
    """Append an action record to stats file. NO message content is logged."""
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "chat_id": chat_id,
        "action": action,
        "contact": contact,
    }
    with open(STATS_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def _send_imessage(handle_id: str, text: str) -> bool:
    """Send a message via `god mac send` → BlueBubbles (AppleScript fallback).

    Delegates to clapcheeks.imessage.sender.send_imessage so every outbound
    path in the codebase uses the same transport. Returns True on success.

    The channel used (`god-mac-bluebubbles` vs `god-mac-applescript` vs
    `osascript`) is logged for visibility.
    """
    result = send_imessage(handle_id, text)
    if result.ok:
        logger.info("Sent to %s via %s", handle_id, result.channel)
        return True
    logger.error("Send failed to %s via %s: %s", handle_id, result.channel, result.error)
    return False


class IMMessageWatcher:
    """Polls chat.db for new incoming messages and auto-replies.

    Uses polling instead of filesystem watchers because SQLite WAL mode
    means chat.db-wal gets modified, not chat.db itself. A 5-second
    poll on a read-only SELECT is negligible overhead.

    In auto mode (default), replies are sent immediately via AppleScript
    with a randomized human-like delay. In dry_run mode, replies are
    logged to console only — nothing is sent.
    """

    def __init__(
        self,
        reader: IMMessageReader,
        reply_gen: ReplyGenerator,
        contacts: list[str] | None = None,
        dry_run: bool = False,
    ) -> None:
        self._reader = reader
        self._reply_gen = reply_gen
        self._contacts = contacts
        self._dry_run = dry_run
        self._snapshot: dict[int, dict] = {}

    def _take_snapshot(self) -> dict[int, dict]:
        """Record the latest message per watched conversation."""
        convos = self._reader.get_conversations(limit=50)
        snapshot: dict[int, dict] = {}
        for convo in convos:
            if self._contacts and convo["handle_id"] not in self._contacts:
                continue
            latest = self._reader.get_latest_message(convo["chat_id"])
            if latest:
                snapshot[convo["chat_id"]] = {
                    "rowid": latest["rowid"],
                    "date": latest["date"],
                    "handle_id": latest["handle_id"],
                    "display_name": convo["display_name"],
                }
        return snapshot

    def start(self, poll_interval: float = 5.0) -> None:
        """Main polling loop — detects new messages and auto-replies."""
        mode = "[yellow]DRY RUN[/yellow]" if self._dry_run else "[green]AUTO-REPLY[/green]"
        console.print(
            f"[bold green]Watching conversations...[/bold green] "
            f"mode={mode} poll={poll_interval}s  (Ctrl+C to stop)\n"
        )

        self._snapshot = self._take_snapshot()
        console.print(f"[dim]Tracking {len(self._snapshot)} conversation(s)[/dim]\n")

        try:
            while True:
                time.sleep(poll_interval)
                new_snapshot = self._take_snapshot()

                for chat_id, info in new_snapshot.items():
                    old = self._snapshot.get(chat_id)
                    if old is None:
                        continue
                    if info["rowid"] != old["rowid"]:
                        latest = self._reader.get_latest_message(chat_id)
                        if latest and not latest["is_from_me"]:
                            self._handle_new_message(chat_id, info, latest)

                self._snapshot = new_snapshot

        except KeyboardInterrupt:
            console.print("\n[dim]Watcher stopped.[/dim]")

    def _handle_new_message(self, chat_id: int, info: dict, message: dict) -> None:
        """Generate and auto-send a reply to a new incoming message."""
        import random

        contact_name = info["display_name"]
        handle_id = info["handle_id"]

        console.print()
        console.print(Panel(
            f"[bold]{contact_name}[/bold]: {message['text']}",
            title="[cyan]New Message[/cyan]",
            border_style="cyan",
        ))

        # Generate reply from conversation context
        messages = self._reader.get_messages(chat_id, limit=15)
        reply = self._reply_gen.suggest_reply(messages, contact_name=contact_name)

        if not reply or reply.startswith("Error") or reply.startswith("Ollama"):
            console.print(f"[red]Reply generation failed:[/red] {reply}")
            _log_stat(chat_id, "error", contact_name)
            return

        # Human-like send delay
        delay = random.uniform(_MIN_REPLY_DELAY, _MAX_REPLY_DELAY)
        console.print(f"[dim]Sending in {delay:.0f}s →[/dim] {reply}")
        time.sleep(delay)

        if self._dry_run:
            console.print(f"[yellow][DRY RUN] Would send to {contact_name}:[/yellow] {reply}")
            _log_stat(chat_id, "dry_run", contact_name)
            return

        success = _send_imessage(handle_id, reply)
        if success:
            console.print(f"[green]✓ Sent to {contact_name}[/green]")
            _log_stat(chat_id, "auto_sent", contact_name)
        else:
            console.print(f"[red]✗ Failed to send to {contact_name}[/red]")
            _log_stat(chat_id, "send_failed", contact_name)
