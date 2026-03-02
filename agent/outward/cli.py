"""Outward local agent CLI — AI-powered dating co-pilot."""
from __future__ import annotations

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from outward import __version__
from outward.config import load as load_config
from outward.modes import MODE_LABELS
from outward.modes.detect import detect_mode
from outward.session.rate_limiter import get_daily_summary
from outward.commands.spend import spend

console = Console()


@click.group()
@click.version_option(__version__, prog_name="outward")
def main() -> None:
    """Outward — AI Dating Co-Pilot (local agent)

    Automates Tinder, Bumble, and Hinge using your iPhone or cloud browser.
    All personal data stays on your device.

    Get started: outward setup
    """
    pass


main.add_command(spend)


@main.command()
def setup() -> None:
    """Interactive first-time setup wizard."""
    from outward.setup.wizard import run_setup
    run_setup()


@main.command()
def status() -> None:
    """Show current mode, connections, and daily stats."""
    config = load_config()
    mode = detect_mode(config)

    console.print()
    console.print(Panel(
        f"[bold magenta]Outward[/bold magenta] [dim]v{__version__}[/dim]",
        border_style="magenta",
        padding=(0, 2),
    ))

    # Mode status
    mode_label = MODE_LABELS.get(mode, mode)
    mode_color = {"iphone-usb": "green", "iphone-wifi": "cyan", "mac-cloud": "yellow"}.get(mode, "white")
    console.print(f"\n  Mode:    [{mode_color}]{mode_label}[/{mode_color}]")
    console.print(f"  Account: [dim]{'connected' if config.get('agent_token') else 'not connected (run outward setup)'}[/dim]")

    # Daily stats
    counts = get_daily_summary()
    if counts:
        console.print("\n  [bold]Today's activity:[/bold]")
        table = Table(show_header=True, header_style="bold dim", box=None, padding=(0, 2))
        table.add_column("Platform")
        table.add_column("Right", style="green")
        table.add_column("Left", style="red")
        for platform in ["tinder", "bumble", "hinge"]:
            r = counts.get(f"{platform}_right", 0)
            l = counts.get(f"{platform}_left", 0)
            if r or l:
                table.add_row(platform.capitalize(), str(r), str(l))
        console.print(table)
    else:
        console.print("\n  [dim]No swipes yet today.[/dim]")

    console.print()


@main.command()
@click.option("--mode", type=click.Choice(["iphone-usb", "iphone-wifi", "mac-cloud"]),
              default=None, help="Force a specific automation mode.")
@click.option("--platform", type=click.Choice(["tinder", "bumble", "hinge", "all"]),
              default="all", show_default=True)
@click.option("--swipes", default=30, show_default=True, help="Max swipes per platform per session.")
@click.option("--like-ratio", default=0.5, show_default=True, help="Fraction of profiles to like.")
def swipe(mode: str | None, platform: str, swipes: int, like_ratio: float) -> None:
    """Run an automated swipe session."""
    config = load_config()

    from outward.session.manager import SessionManager

    platforms = ["tinder", "bumble", "hinge"] if platform == "all" else [platform]

    with console.status(f"[bold green]Starting {MODE_LABELS.get(mode or detect_mode(config))} session...[/bold green]"):
        if mode:
            config["force_mode"] = mode

        mgr = SessionManager(config)

    console.print(f"[bold]Mode:[/bold] {MODE_LABELS.get(mgr.mode, mgr.mode)}")
    console.print()

    with mgr:
        for plat in platforms:
            console.print(f"[bold cyan]{plat.capitalize()}[/bold cyan] — starting swipe session...")

            try:
                driver = mgr.get_driver(plat)

                if plat == "tinder":
                    from outward.platforms.tinder import TinderClient
                    client = TinderClient(driver=driver)
                elif plat == "bumble":
                    from outward.platforms.bumble import BumbleClient
                    client = BumbleClient(driver=driver)
                elif plat == "hinge":
                    from outward.platforms.hinge import HingeClient
                    client = HingeClient(driver=driver, ai_service_url=config.get('ai_service_url'))

                with (driver if hasattr(driver, '__enter__') else _nullctx(driver)):
                    results = client.run_swipe_session(
                        like_ratio=like_ratio,
                        max_swipes=swipes,
                    )

                console.print(
                    f"  [green]✓[/green] {results.get('liked', 0)} liked · "
                    f"[red]{results.get('passed', 0)}[/red] passed · "
                    f"[yellow]{results.get('errors', 0)}[/yellow] errors"
                )

                # Sync to dashboard (non-blocking)
                agent_token = config.get('agent_token')
                api_url = config.get('api_url', 'https://api.clapcheeks.tech')
                if agent_token and results:
                    try:
                        import requests as _req
                        _req.post(
                            f'{api_url}/analytics/sync',
                            json={
                                'platform': plat,
                                'swipes_right': results.get('liked', 0),
                                'swipes_left': results.get('passed', 0),
                                'matches': len(results.get('new_matches', [])),
                            },
                            headers={'Authorization': f'Bearer {agent_token}'},
                            timeout=5,
                        )
                        console.print('[dim]✓ Synced to dashboard[/dim]')
                    except Exception:
                        pass  # Silent failure — don't block the user

            except Exception as exc:
                console.print(f"  [red]✗[/red] {plat} failed: {exc}")

    console.print("\n[dim]Session complete. Run [cyan]outward status[/cyan] to see today's totals.[/dim]\n")


@main.command()
def menu() -> None:
    """Open the interactive arrow-key menu."""
    # Import menu module when it exists
    try:
        from outward.menu import run_menu
        config = load_config()
        run_menu(config)
    except ImportError:
        console.print("[yellow]Interactive menu coming soon.[/yellow]")
        console.print("For now, use: [cyan]outward swipe[/cyan]")


@main.command()
def sync() -> None:
    """Sync today's anonymized metrics to your Outward dashboard."""
    config = load_config()
    counts = get_daily_summary()

    if not config.get("agent_token"):
        console.print("[yellow]Not connected. Run [cyan]outward setup[/cyan] first.[/yellow]")
        return

    if not counts:
        console.print("[dim]No activity to sync today.[/dim]")
        return

    try:
        import requests
        api_url = config.get("api_url", "https://api.clapcheeks.tech")
        resp = requests.post(
            f"{api_url}/analytics/sync",
            headers={"Authorization": f"Bearer {config['agent_token']}"},
            json={"date": __import__("datetime").date.today().isoformat(), "counts": counts},
            timeout=15,
        )
        if resp.status_code == 200:
            console.print("[green]✓[/green] Metrics synced to dashboard.")
        else:
            console.print(f"[yellow]Sync failed (HTTP {resp.status_code})[/yellow]")
    except Exception as exc:
        console.print(f"[red]Sync error:[/red] {exc}")


@main.command()
@click.option('--platform', default='tinder', type=click.Choice(['tinder', 'bumble', 'hinge']), help='Platform to manage conversations on.')
@click.option('--dry-run', is_flag=True, default=False, help='Show what would be sent without sending.')
def converse(platform: str, dry_run: bool) -> None:
    """AI-powered conversation manager — send openers and reply to matches."""
    from outward.config import load as load_config
    from outward.session.manager import SessionManager
    from outward.conversation.manager import ConversationManager

    config = load_config()
    if dry_run:
        config['dry_run'] = True
        console.print('[yellow]DRY RUN mode — messages will not be sent[/yellow]')

    console.print(f'\n[bold magenta]Outward[/bold magenta] conversation manager — [bold]{platform}[/bold]')

    with console.status(f'[bold green]Setting up {platform} connection...[/bold green]'):
        session = SessionManager(config)
        try:
            driver = session.get_driver()
        except Exception as e:
            console.print(f'[bold red]Error:[/bold red] {e}')
            raise SystemExit(1)

    # Get platform client
    if platform == 'tinder':
        from outward.platforms.tinder import TinderClient
        client = TinderClient(driver=driver)
    elif platform == 'hinge':
        from outward.platforms.hinge import HingeClient
        client = HingeClient(driver=driver, ai_service_url=config.get('ai_service_url'))
    else:
        console.print(f'[yellow]Bumble conversation management uses the driver directly.[/yellow]')
        raise SystemExit(0)

    mgr = ConversationManager(client, platform, config)

    with console.status('[bold green]Running conversation loop...[/bold green]'):
        results = mgr.run_loop()

    console.print(Panel(
        f"[bold green]Openers sent:[/bold green] {results['openers_sent']}\n"
        f"[bold cyan]Replies sent:[/bold cyan] {results['replies_sent']}\n"
        f"[bold red]Errors:[/bold red] {results['errors']}",
        title=f"[magenta]Conversation Run — {platform}[/magenta]",
        border_style="magenta",
    ))


from outward.commands.profile import profile
main.add_command(profile)


class _nullctx:
    """No-op context manager for drivers that don't support 'with'."""
    def __init__(self, val): self.val = val
    def __enter__(self): return self.val
    def __exit__(self, *a): pass
