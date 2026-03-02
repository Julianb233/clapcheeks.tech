"""Interactive first-time setup wizard for Clap Cheeks."""
from __future__ import annotations

import os
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel

from clapcheeks.config import load, save, save_agent_token

console = Console()

ENV_FILE = Path.home() / ".clapcheeks" / ".env"


def _write_env(key: str, value: str) -> None:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    updated = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines) + "\n")


def run_setup() -> None:
    """Interactive setup wizard."""
    console.print()
    console.print(Panel(
        "[bold magenta]Clap Cheeks[/bold magenta] — Setup Wizard\n"
        "[dim]Configure your AI dating co-pilot[/dim]",
        border_style="magenta",
        padding=(1, 2),
    ))

    config = load()

    # Step 1: Automation mode
    console.print("\n[bold]Step 1: Automation Mode[/bold]")
    console.print("  [dim]mac-cloud[/dim]  — Browserbase cloud browser (easiest, no hardware needed)")
    console.print("  [dim]iphone-wifi[/dim] — Your iPhone wirelessly over WiFi")
    console.print("  [dim]iphone-usb[/dim]  — Your iPhone via USB cable")
    mode = click.prompt(
        "Choose mode",
        type=click.Choice(["mac-cloud", "iphone-wifi", "iphone-usb"]),
        default="mac-cloud",
    )
    config["force_mode"] = mode

    # Step 2: Browserbase (if cloud mode)
    if mode == "mac-cloud":
        console.print("\n[bold]Step 2: Browserbase API Key[/bold]")
        console.print("[dim]Get yours free at https://browserbase.com[/dim]")
        bb_key = click.prompt("BROWSERBASE_API_KEY", default="", hide_input=True)
        if bb_key:
            _write_env("BROWSERBASE_API_KEY", bb_key)
            console.print("[green]✓ Browserbase configured[/green]")

    # Step 3: AI Service (Kimi)
    console.print("\n[bold]Step 3: Kimi AI API Key[/bold]")
    console.print("[dim]Powers reply suggestions, coaching, and date planning[/dim]")
    console.print("[dim]Get yours at https://platform.moonshot.cn — free tier available[/dim]")
    kimi_key = click.prompt("KIMI_API_KEY", default="", hide_input=True)
    if kimi_key:
        _write_env("KIMI_API_KEY", kimi_key)
        config["ai_service_url"] = "http://localhost:8000"
        console.print("[green]✓ Kimi AI configured[/green]")

    # Step 4: Google Calendar (optional)
    console.print("\n[bold]Step 4: Google Calendar[/bold] [dim](optional — enables date scheduling)[/dim]")
    if click.confirm("Set up Google Calendar for automatic date booking?", default=False):
        client_id = click.prompt("GOOGLE_CLIENT_ID", default="")
        client_secret = click.prompt("GOOGLE_CLIENT_SECRET", default="", hide_input=True)
        refresh_token = click.prompt("GOOGLE_REFRESH_TOKEN", default="", hide_input=True)
        if client_id and refresh_token:
            _write_env("GOOGLE_CLIENT_ID", client_id)
            _write_env("GOOGLE_CLIENT_SECRET", client_secret)
            _write_env("GOOGLE_REFRESH_TOKEN", refresh_token)
            console.print("[green]✓ Google Calendar configured[/green]")
    else:
        console.print("[dim]Skipped — run setup again to add later[/dim]")

    # Step 5: Dashboard account (optional)
    console.print("\n[bold]Step 5: Clap Cheeks Account[/bold] [dim](optional — enables dashboard sync)[/dim]")
    console.print("[dim]Sign up at https://clapcheeks.tech[/dim]")
    agent_token = click.prompt("Agent token (from dashboard → Settings)", default="", hide_input=True)
    if agent_token:
        save_agent_token(agent_token)
        config["agent_token"] = agent_token
        console.print("[green]✓ Dashboard sync enabled[/green]")

    # Save config
    save(config)

    console.print()
    console.print(Panel(
        "[bold green]Setup complete![/bold green]\n\n"
        "Quick start:\n"
        "  [cyan]clapcheeks swipe --platform tinder[/cyan]     — start swiping\n"
        "  [cyan]clapcheeks converse --platform tinder[/cyan]  — send openers + replies\n"
        "  [cyan]clapcheeks date-suggest --match-name \"Sarah\"[/cyan] — book a date\n"
        "  [cyan]clapcheeks status[/cyan]                       — view today's stats",
        border_style="green",
        padding=(1, 2),
    ))
