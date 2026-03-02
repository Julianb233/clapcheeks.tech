"""Clap Cheeks CLI — setup, status, and agent management."""
from __future__ import annotations

import click
from rich.console import Console
from rich.panel import Panel

from clapcheeks import __version__
from clapcheeks.config import load as load_config, save_agent_token, get_agent_token
from clapcheeks.auth import generate_cli_session_id, open_browser_auth, poll_for_token

console = Console()


@click.group()
@click.version_option(__version__, prog_name="clapcheeks")
def main() -> None:
    """Clap Cheeks — AI Dating Co-Pilot

    Local agent for automated swiping, conversation management,
    and iMessage integration. All data stays on your device.

    Get started: clapcheeks setup
    """


@main.command()
def setup() -> None:
    """Authenticate via browser and configure the local agent."""
    console.print()
    console.print(Panel(
        "[bold magenta]Clap Cheeks[/bold magenta] Setup",
        subtitle="v" + __version__,
        border_style="magenta",
        padding=(0, 2),
    ))
    console.print()

    session_id = generate_cli_session_id()
    config = load_config()
    api_url = config.get("api_url", "https://api.clapcheeks.tech")

    console.print("[bold]Opening browser for authentication...[/bold]")
    open_browser_auth(session_id)

    token = poll_for_token(session_id, api_url)

    if token:
        save_agent_token(token)
        console.print("[green bold]Authenticated successfully![/green bold]")
        console.print()

        if click.confirm("Enable auto-start daemon (runs on login)?", default=True):
            from clapcheeks.launchd import install_launchd
            try:
                install_launchd()
                console.print("[green]Daemon installed and started.[/green]")
            except Exception as exc:
                console.print(f"[yellow]Could not start daemon: {exc}[/yellow]")
                console.print("You can start it manually: [cyan]clapcheeks agent start[/cyan]")
    else:
        console.print("[red bold]Authentication timed out.[/red bold]")
        console.print()
        console.print("You can authenticate manually:")
        console.print("  1. Log in at [cyan]https://clapcheeks.tech[/cyan]")
        console.print("  2. Copy your agent token from Settings")
        console.print("  3. Run: [cyan]clapcheeks setup[/cyan] again")

    console.print()


@main.command()
def status() -> None:
    """Show version, auth status, and daemon state."""
    console.print()
    console.print(Panel(
        f"[bold magenta]Clap Cheeks[/bold magenta] [dim]v{__version__}[/dim]",
        border_style="magenta",
        padding=(0, 2),
    ))

    token = get_agent_token()
    auth_status = "[green]authenticated[/green]" if token else "[red]not authenticated[/red] (run clapcheeks setup)"
    console.print(f"  Auth:   {auth_status}")

    try:
        from clapcheeks.launchd import is_running
        daemon_status = "[green]running[/green]" if is_running() else "[dim]stopped[/dim]"
    except Exception:
        daemon_status = "[dim]unknown[/dim]"
    console.print(f"  Daemon: {daemon_status}")
    console.print()


@main.group()
def agent() -> None:
    """Manage the background agent daemon."""


@agent.command()
def start() -> None:
    """Install and start the background daemon."""
    from clapcheeks.launchd import install_launchd
    try:
        install_launchd()
        console.print("[green]Agent daemon started.[/green]")
    except Exception as exc:
        console.print(f"[red]Failed to start daemon: {exc}[/red]")


@agent.command()
def stop() -> None:
    """Stop and uninstall the background daemon."""
    from clapcheeks.launchd import uninstall_launchd
    try:
        uninstall_launchd()
        console.print("[yellow]Agent daemon stopped.[/yellow]")
    except Exception as exc:
        console.print(f"[red]Failed to stop daemon: {exc}[/red]")
