"""iMessage watcher — polls chat.db for new incoming messages."""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt

if TYPE_CHECKING:
    from outward.imessage.ai_reply import ReplyGenerator
    from outward.imessage.reader import IMMessageReader

logger = logging.getLogger(__name__)
console = Console()

STATS_DIR = Path.home() / ".clapcheeks"
STATS_FILE = STATS_DIR / "imessage_stats.jsonl"


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


def _copy_to_clipboard(text: str) -> bool:
    """Copy text to macOS clipboard via pbcopy. Returns True on success."""
    try:
        subprocess.run(["pbcopy"], input=text.encode(), check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


class IMMessageWatcher:
    """Polls chat.db for new incoming messages and suggests replies.

    Uses polling instead of filesystem watchers because SQLite WAL mode
    means chat.db-wal gets modified, not chat.db itself. A 5-second
    poll on a read-only SELECT is negligible overhead.
    """

    def __init__(
        self,
        reader: IMMessageReader,
        reply_gen: ReplyGenerator,
        contacts: list[str] | None = None,
    ) -> None:
        self._reader = reader
        self._reply_gen = reply_gen
        self._contacts = contacts
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
        """Main polling loop — detects new messages and suggests replies."""
        console.print(
            f"[bold green]Watching conversations for new messages...[/bold green] "
            f"(poll every {poll_interval}s, Ctrl+C to stop)\n"
        )

        self._snapshot = self._take_snapshot()
        watched_count = len(self._snapshot)
        console.print(f"[dim]Tracking {watched_count} conversation(s)[/dim]\n")

        try:
            while True:
                time.sleep(poll_interval)
                new_snapshot = self._take_snapshot()

                for chat_id, info in new_snapshot.items():
                    old = self._snapshot.get(chat_id)
                    if old is None:
                        continue
                    # Detect new incoming message (different rowid and not from us)
                    if info["rowid"] != old["rowid"]:
                        latest = self._reader.get_latest_message(chat_id)
                        if latest and not latest["is_from_me"]:
                            self._handle_new_message(chat_id, info["display_name"], latest)

                self._snapshot = new_snapshot

        except KeyboardInterrupt:
            console.print("\n[dim]Watcher stopped.[/dim]")

    def _handle_new_message(self, chat_id: int, contact_name: str, message: dict) -> None:
        """Show reply suggestions for a new incoming message."""
        console.print()
        console.print(Panel(
            f"[bold]{contact_name}[/bold]: {message['text']}",
            title="[cyan]New Message[/cyan]",
            border_style="cyan",
        ))

        # Get conversation context
        messages = self._reader.get_messages(chat_id, limit=15)
        suggestions = self._reply_gen.suggest_multiple(messages, contact_name=contact_name)

        console.print("\n[bold]Reply suggestions:[/bold]")
        for i, suggestion in enumerate(suggestions, 1):
            console.print(f"  [bold magenta]({i})[/bold magenta] {suggestion}")
        console.print(f"  [dim](s) skip  (c) custom reply[/dim]\n")

        choice = Prompt.ask("Pick", choices=["1", "2", "3", "s", "c"], default="s")

        if choice in ("1", "2", "3"):
            idx = int(choice) - 1
            reply = suggestions[idx] if idx < len(suggestions) else suggestions[0]
            if _copy_to_clipboard(reply):
                console.print(f"[green]Reply copied to clipboard[/green]")
            else:
                console.print(f"[yellow]Clipboard unavailable. Reply:[/yellow] {reply}")
            _log_stat(chat_id, "picked", contact_name)
        elif choice == "c":
            custom = Prompt.ask("Your reply")
            if custom and _copy_to_clipboard(custom):
                console.print(f"[green]Custom reply copied to clipboard[/green]")
            elif custom:
                console.print(f"[yellow]Clipboard unavailable.[/yellow]")
            _log_stat(chat_id, "custom", contact_name)
        else:
            console.print("[dim]Skipped[/dim]")
            _log_stat(chat_id, "skipped", contact_name)
