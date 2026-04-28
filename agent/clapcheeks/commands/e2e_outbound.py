"""clapcheeks send-test command — AI-8743.

End-to-end outbound iMessage test with chat.db delivery verification.

Sends ONE iMessage via the production path (god mac send → osascript fallback)
and verifies delivery against ~/Library/Messages/chat.db per the comms
verification standard in .claude/rules/comms-must-be-verified.md.

Usage:
    clapcheeks send-test +16199919355 --body "Test from Clapcheeks"

    # On Mac Mini (after deploy):
    god mac exec "cd ~/.clapcheeks && clapcheeks send-test +16199919355 --body 'Test'"
"""
from __future__ import annotations

import uuid

import click
from rich.console import Console
from rich.panel import Panel

console = Console()


@click.command(name="send-test")
@click.argument("phone")
@click.option(
    "--body",
    default="Test from Clapcheeks",
    show_default=True,
    help="Message body to send (a nonce is appended automatically).",
)
@click.option(
    "--timeout",
    default=10,
    show_default=True,
    help="Seconds to poll chat.db for delivery confirmation.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Log the send without actually sending (skips chat.db verification).",
)
def send_test(phone: str, body: str, timeout: int, dry_run: bool) -> None:
    """Send one iMessage to PHONE and verify delivery via chat.db.

    Uses the production send path (god mac send → osascript fallback).
    Embeds a unique nonce in the message so delivery can be confirmed
    by scanning ~/Library/Messages/chat.db.

    Prints PASS + chat.db ROWID on success. Exits non-zero on FAIL.

    \b
    Example:
        clapcheeks send-test +16199919355 --body "Test from Clapcheeks"
        clapcheeks send-test +16199919355 --dry-run
    """
    from clapcheeks.imessage.sender import send_imessage
    from clapcheeks.imessage.chatdb_verifier import verify_outbound_sent

    nonce = f"CC-E2E-{uuid.uuid4().hex[:8]}"
    full_body = f"{body} [{nonce}]"

    console.print(
        Panel(
            f"[bold]Target:[/bold] {phone}\n"
            f"[bold]Nonce:[/bold]  {nonce}\n"
            f"[bold]Body:[/bold]   {full_body}\n"
            f"[bold]Timeout:[/bold] {timeout}s\n"
            + ("[yellow]DRY RUN — no message will be sent[/yellow]" if dry_run else ""),
            title="[magenta]Clapcheeks send-test[/magenta]",
            border_style="magenta",
        )
    )

    # --- SEND ---
    with console.status("[bold green]Sending iMessage...[/bold green]"):
        result = send_imessage(phone, full_body, dry_run=dry_run)

    if not result.ok:
        console.print(
            f"[bold red]SEND FAILED[/bold red] — channel={result.channel} "
            f"error={result.error}"
        )
        raise SystemExit(1)

    console.print(
        f"[green]Send OK[/green] via [bold]{result.channel}[/bold]"
    )

    if dry_run:
        console.print(
            "[yellow]DRY RUN — skipping chat.db verification.[/yellow]\n"
            "[dim]Remove --dry-run to run the full E2E test.[/dim]"
        )
        return

    # --- VERIFY ---
    console.print(
        f"[dim]Polling chat.db for nonce (up to {timeout}s)...[/dim]"
    )
    with console.status(
        "[bold green]Verifying delivery in chat.db...[/bold green]"
    ):
        verify = verify_outbound_sent(phone, nonce, timeout=timeout)

    if verify.found:
        console.print(
            Panel(
                f"[bold green]PASS[/bold green]\n\n"
                f"  chat.db ROWID : [bold]{verify.rowid}[/bold]\n"
                f"  handle        : [bold]{verify.handle}[/bold]\n"
                f"  nonce         : [dim]{nonce}[/dim]",
                title="[green]Delivery Verified[/green]",
                border_style="green",
            )
        )
    else:
        console.print(
            Panel(
                f"[bold red]FAIL[/bold red]\n\n"
                f"  error  : {verify.error}\n"
                f"  nonce  : [dim]{nonce}[/dim]\n\n"
                "[dim]Possible causes:\n"
                "  * Not running on Mac with chat.db access\n"
                "  * Full Disk Access not granted to Python\n"
                "  * Message not yet delivered within timeout\n"
                "  * Phone number not in Messages\n"
                "  * god mac send returned OK but message was not delivered[/dim]",
                title="[red]Delivery NOT Verified[/red]",
                border_style="red",
            )
        )
        raise SystemExit(1)
