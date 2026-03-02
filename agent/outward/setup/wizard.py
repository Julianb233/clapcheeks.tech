"""Interactive first-time setup wizard for Outward.

Guides the user through:
  1. Choosing an automation mode
  2. Installing required dependencies
  3. Connecting their iPhone (if using iPhone modes)
  4. Connecting their clapcheeks.tech account
  5. Configuring dating app preferences
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time

import questionary
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule

from outward import __version__
from outward.config import load as load_config, save as save_config
from outward.modes import MODE_CLOUD, MODE_USB, MODE_WIFI, MODE_LABELS
from outward.modes.detect import get_phone_udid, get_phone_wifi_ip
from outward.setup.wda import (
    check_appium_installed,
    check_xcuitest_driver,
    enable_wifi_mode,
    install_xcuitest_driver,
    start_appium_server,
)

console = Console()

STYLE = questionary.Style([
    ("qmark", "fg:#7c3aed bold"),
    ("question", "bold"),
    ("answer", "fg:#059669 bold"),
    ("pointer", "fg:#7c3aed bold"),
    ("highlighted", "fg:#7c3aed bold"),
])


def run_setup() -> None:
    """Interactive setup wizard — run once to configure Outward."""
    config = load_config()

    console.print()
    console.print(Panel(
        f"[bold magenta]Outward Setup Wizard[/bold magenta] [dim]v{__version__}[/dim]\n"
        "[dim]This will configure your automation mode and connect your account.[/dim]",
        border_style="magenta",
        padding=(0, 2),
    ))
    console.print()

    # ── Step 1: Choose mode ──────────────────────────────────────────────
    console.print(Rule("[dim]Step 1 of 4 — Automation Mode[/dim]", style="dim"))
    console.print()
    console.print("[dim]Choose how Outward will automate your dating apps:[/dim]\n")

    mode = questionary.select(
        "Select automation mode:",
        choices=[
            questionary.Choice(
                "iPhone (USB cable) — Most reliable, best detection avoidance",
                value=MODE_USB,
            ),
            questionary.Choice(
                "iPhone (WiFi) — Wireless after one-time USB setup",
                value=MODE_WIFI,
            ),
            questionary.Choice(
                "Mac Cloud (Browserbase) — No iPhone needed, runs fully in cloud",
                value=MODE_CLOUD,
            ),
        ],
        style=STYLE,
    ).ask()

    if mode is None:
        console.print("[yellow]Setup cancelled.[/yellow]")
        return

    config["mode"] = mode
    console.print(f"\n[green]✓[/green] Mode set to: [bold]{MODE_LABELS[mode]}[/bold]\n")

    # ── Step 2: iPhone setup (USB or WiFi) ──────────────────────────────
    if mode in (MODE_USB, MODE_WIFI):
        console.print(Rule("[dim]Step 2 of 4 — iPhone Setup[/dim]", style="dim"))
        console.print()
        _setup_iphone(config, mode)

    # ── Step 3: Browserbase API key (cloud or fallback) ─────────────────
    console.print(Rule("[dim]Step 3 of 4 — Cloud Fallback (Browserbase)[/dim]", style="dim"))
    console.print()
    console.print(
        "[dim]Browserbase is used as a fallback when your iPhone isn't available.\n"
        "Get a free API key at [link=https://browserbase.com]browserbase.com[/link][/dim]\n"
    )

    bb_key = questionary.text(
        "Browserbase API key (press Enter to skip):",
        style=STYLE,
    ).ask()
    if bb_key and bb_key.strip():
        config["browserbase_api_key"] = bb_key.strip()
        console.print("[green]✓[/green] Browserbase API key saved.\n")
    else:
        console.print("[yellow]Skipped — cloud fallback will be unavailable.[/yellow]\n")

    # ── Step 4: Account token ────────────────────────────────────────────
    console.print(Rule("[dim]Step 4 of 4 — Outward Account[/dim]", style="dim"))
    console.print()
    console.print(
        "[dim]Get your agent token from your dashboard at "
        "[link=https://clapcheeks.tech/dashboard]clapcheeks.tech/dashboard[/link][/dim]\n"
    )

    agent_token = questionary.text(
        "Agent token (from clapcheeks.tech dashboard):",
        style=STYLE,
    ).ask()
    if agent_token and agent_token.strip():
        config["agent_token"] = agent_token.strip()
        console.print("[green]✓[/green] Account connected.\n")
    else:
        console.print("[yellow]Skipped — analytics sync will be disabled.[/yellow]\n")

    # ── Save config ──────────────────────────────────────────────────────
    save_config(config)

    console.print(Panel(
        "[bold green]Setup complete![/bold green]\n\n"
        "Run [cyan bold]outward menu[/cyan bold] to start swiping.",
        border_style="green",
        padding=(0, 2),
    ))
    console.print()


def _setup_iphone(config: dict, mode: str) -> None:
    """Guide iPhone setup for USB or WiFi mode."""

    # Check libimobiledevice
    if not shutil.which("idevice_id"):
        console.print(
            "[yellow]libimobiledevice not found.[/yellow]\n"
            "Install it with: [cyan]brew install libimobiledevice[/cyan]\n"
        )
        if not questionary.confirm("Install now?", style=STYLE).ask():
            return
        subprocess.run(["brew", "install", "libimobiledevice"], check=False)
        console.print()

    # Check Appium
    if not check_appium_installed():
        console.print(
            "[yellow]Appium not found.[/yellow]\n"
            "Install it with: [cyan]npm install -g appium[/cyan]\n"
        )
        if not questionary.confirm("Install now?", style=STYLE).ask():
            return
        subprocess.run(["npm", "install", "-g", "appium"], check=False)
        console.print()

    # Check xcuitest driver
    if not check_xcuitest_driver():
        console.print("[yellow]appium-xcuitest-driver not installed.[/yellow]")
        if questionary.confirm("Install now?", style=STYLE).ask():
            install_xcuitest_driver()
        console.print()

    # Prompt USB connection
    console.print(
        "[bold]Plug your iPhone into your Mac with a USB cable now.[/bold]\n"
        "[dim]You'll only need the cable for this setup step.[/dim]"
    )
    questionary.press_any_key_to_continue(message="Press Enter when phone is connected...").ask()

    # Detect UDID
    from outward.modes.detect import get_phone_udid
    udid = get_phone_udid()
    if not udid:
        console.print(
            "[red]iPhone not detected.[/red]\n"
            "Make sure you tapped 'Trust This Computer' on your phone.\n"
        )
        return

    console.print(f"[green]✓[/green] iPhone detected: [dim]{udid}[/dim]\n")
    config["phone_udid"] = udid

    if mode == MODE_WIFI:
        # Get WiFi IP while USB is connected
        phone_ip = get_phone_wifi_ip(udid)
        if phone_ip:
            config["phone_wifi_ip"] = phone_ip
            console.print(
                f"[green]✓[/green] WiFi IP found: [bold]{phone_ip}[/bold]\n\n"
                "[dim]Initial WDA setup requires the cable. After first run, "
                "you can unplug and Outward will connect over WiFi.[/dim]\n"
            )
        else:
            console.print(
                "[yellow]Could not detect WiFi IP.[/yellow]\n"
                "Make sure your iPhone's WiFi is on and connected to the same network.\n"
                "You can enter it manually:\n"
                "  Settings → WiFi → (i) → IP Address\n"
            )
            manual_ip = questionary.text("iPhone WiFi IP address:", style=STYLE).ask()
            if manual_ip and manual_ip.strip():
                config["phone_wifi_ip"] = manual_ip.strip()

    console.print(
        "[dim]WDA will be automatically built and installed when you first run Outward.\n"
        "This takes 2-3 minutes the first time.[/dim]\n"
    )
