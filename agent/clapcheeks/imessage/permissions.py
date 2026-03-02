"""macOS Full Disk Access detection for iMessage chat.db access."""
from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.panel import Panel

CHAT_DB = Path.home() / "Library" / "Messages" / "chat.db"

console = Console()


def check_full_disk_access() -> bool:
    """Check if the current process has Full Disk Access by trying to open chat.db.

    Returns True if chat.db can be opened read-only, False otherwise.
    """
    try:
        with open(CHAT_DB, "rb"):
            return True
    except (PermissionError, OSError):
        return False


def prompt_fda_instructions() -> None:
    """Print Rich-formatted instructions for granting Full Disk Access."""
    console.print()
    console.print(Panel(
        "[bold red]Full Disk Access Required[/bold red]\n\n"
        "Clapcheeks needs to read your iMessage database (chat.db).\n"
        "macOS requires Full Disk Access permission for this.\n\n"
        "[bold]How to enable:[/bold]\n\n"
        "  1. Open [cyan]System Settings[/cyan]\n"
        "  2. Go to [cyan]Privacy & Security > Full Disk Access[/cyan]\n"
        "  3. Toggle [bold]ON[/bold] for your terminal app:\n"
        "     - Terminal.app\n"
        "     - iTerm2\n"
        "     - VS Code (if running from integrated terminal)\n"
        "     - Warp, Alacritty, or whichever terminal you use\n\n"
        "  4. [bold yellow]Restart your terminal[/bold yellow] after granting access\n\n"
        "[dim]Path: System Settings > Privacy & Security > Full Disk Access[/dim]",
        title="[bold magenta]Clapcheeks[/bold magenta]",
        border_style="red",
    ))
    console.print()
