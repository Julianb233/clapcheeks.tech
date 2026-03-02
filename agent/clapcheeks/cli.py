"""Clapcheeks local agent CLI — AI-powered dating co-pilot."""
from __future__ import annotations

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from clapcheeks import __version__
from clapcheeks.config import load as load_config
from clapcheeks.modes import MODE_LABELS
from clapcheeks.modes.detect import detect_mode
from clapcheeks.session.rate_limiter import get_daily_summary
from clapcheeks.commands.spend import spend

console = Console()


@click.group()
@click.version_option(__version__, prog_name="clapcheeks")
def main() -> None:
    """Clapcheeks — AI Dating Co-Pilot (local agent)

    Automates Tinder, Bumble, and Hinge using your iPhone or cloud browser.
    All personal data stays on your device.

    \b
    Get started in 4 steps:
      1. curl -fsSL https://clapcheeks.tech/install.sh | bash
      2. clapcheeks login
      3. clapcheeks connect
      4. clapcheeks swipe
    """
    pass


main.add_command(spend)


@main.command()
def login() -> None:
    """Authenticate with your Clapcheeks account (device flow).

    Opens your browser to clapcheeks.tech/activate and displays a pairing
    code. Log in on the web, and your CLI is connected automatically.
    """
    from clapcheeks.auth import device_login
    from clapcheeks.config import load as load_cfg, save_agent_token

    cfg = load_cfg()

    if cfg.get("agent_token"):
        console.print("[dim]Already logged in. Use [cyan]clapcheeks status[/cyan] to check.[/dim]")
        if not click.confirm("Log in again?", default=False):
            return

    token = device_login(api_url=cfg.get("api_url", "https://api.clapcheeks.tech"))

    if token:
        save_agent_token(token)
        console.print("[bold green]Logged in successfully.[/bold green]")
        console.print("[dim]Next step: [cyan]clapcheeks connect[/cyan] to link your dating apps.[/dim]")
    else:
        console.print("[red]Login timed out.[/red] Try again with [cyan]clapcheeks login[/cyan].")
        raise SystemExit(1)


@main.command()
def setup() -> None:
    """Interactive first-time setup wizard."""
    from clapcheeks.setup.wizard import run_setup
    run_setup()


@main.command()
def status() -> None:
    """Show current mode, connections, and daily stats."""
    config = load_config()
    mode = detect_mode(config)

    console.print()
    console.print(Panel(
        f"[bold magenta]Clapcheeks[/bold magenta] [dim]v{__version__}[/dim]",
        border_style="magenta",
        padding=(0, 2),
    ))

    # Mode status
    mode_label = MODE_LABELS.get(mode, mode)
    mode_color = {"iphone-usb": "green", "iphone-wifi": "cyan", "mac-cloud": "yellow"}.get(mode, "white")
    console.print(f"\n  Mode:    [{mode_color}]{mode_label}[/{mode_color}]")
    console.print(f"  Account: [dim]{'connected' if config.get('agent_token') else 'not connected (run clapcheeks setup)'}[/dim]")

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

    # Sync status
    from clapcheeks.sync import get_last_sync_time
    from clapcheeks.queue import get_queue_size
    last_sync = get_last_sync_time()
    pending = get_queue_size()
    sync_line = f"[dim]{last_sync or 'never'}[/dim]"
    if pending > 0:
        sync_line += f" [yellow]({pending} queued)[/yellow]"
    console.print(f"  Sync:    {sync_line}")

    console.print()


@main.command()
@click.option("--mode", type=click.Choice(["iphone-usb", "iphone-wifi", "mac-cloud"]),
              default=None, help="Force a specific automation mode.")
@click.option("--platform", type=click.Choice(["tinder", "bumble", "hinge", "all"]),
              default="all", show_default=True)
@click.option("--swipes", default=30, show_default=True, help="Max swipes per platform per session.")
@click.option("--like-ratio", default=0.25, show_default=True, help="Fraction of profiles to like (lower = better algorithm score).")
def swipe(mode: str | None, platform: str, swipes: int, like_ratio: float) -> None:
    """Run an automated swipe session."""
    config = load_config()

    # Show coaching tips if profile exists and has room for improvement
    from clapcheeks.profile import profile_exists, load_profile
    if profile_exists():
        from clapcheeks.ai.profile_coach import analyze_profile, format_coach_tips
        prof = load_profile()
        tips = analyze_profile(prof)
        if tips:
            formatted = format_coach_tips(tips)
            console.print()
            console.print(Panel(
                formatted,
                title="[bold]AI Coach[/bold]",
                border_style="magenta",
                padding=(1, 2),
            ))
            console.print()

    from clapcheeks.session.manager import SessionManager

    platforms = ["tinder", "bumble", "hinge"] if platform == "all" else [platform]

    with console.status(f"[bold green]Starting {MODE_LABELS.get(mode or detect_mode(config))} session...[/bold green]"):
        if mode:
            config["force_mode"] = mode

        mgr = SessionManager(config)

    console.print(f"[bold]Mode:[/bold] {MODE_LABELS.get(mgr.mode, mgr.mode)}")
    console.print()

    with mgr:
        for plat in platforms:
            # Check rate limit before starting platform
            from clapcheeks.session.rate_limiter import check_limit, RateLimitExceeded, record_swipe
            try:
                check_limit(plat, "swipe")
            except RateLimitExceeded as e:
                console.print(f"  [yellow]⚠[/yellow] {e}")
                continue

            console.print(f"[bold cyan]{plat.capitalize()}[/bold cyan] — starting swipe session...")

            try:
                driver = mgr.get_driver(plat)

                if plat == "tinder":
                    from clapcheeks.platforms.tinder import TinderClient
                    client = TinderClient(driver=driver)
                elif plat == "bumble":
                    from clapcheeks.platforms.bumble import BumbleClient
                    client = BumbleClient(driver=driver)
                elif plat == "hinge":
                    from clapcheeks.platforms.hinge import HingeClient
                    client = HingeClient(driver=driver, ai_service_url=config.get('ai_service_url'))

                with (driver if hasattr(driver, '__enter__') else _nullctx(driver)):
                    results = client.run_swipe_session(
                        like_ratio=like_ratio,
                        max_swipes=swipes,
                    )

                # Record swipes for rate limiting
                for _ in range(results.get('liked', 0)):
                    record_swipe(plat, 'right')
                for _ in range(results.get('passed', 0)):
                    record_swipe(plat, 'left')

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

    console.print("\n[dim]Session complete. Run [cyan]clapcheeks status[/cyan] to see today's totals.[/dim]\n")


@main.command()
def menu() -> None:
    """Open the interactive arrow-key menu."""
    # Import menu module when it exists
    try:
        from clapcheeks.menu import run_menu
        config = load_config()
        run_menu(config)
    except ImportError:
        console.print("[yellow]Interactive menu coming soon.[/yellow]")
        console.print("For now, use: [cyan]clapcheeks swipe[/cyan]")


@main.command()
def sync() -> None:
    """Sync today's anonymized metrics to your dashboard."""
    from clapcheeks.sync import push_metrics, record_sync_time
    from clapcheeks.queue import get_queue_size

    config = load_config()
    if not config.get("agent_token"):
        console.print("[yellow]Not connected. Run [cyan]clapcheeks setup[/cyan] first.[/yellow]")
        return

    with console.status("[bold green]Syncing metrics...[/bold green]"):
        synced, queued = push_metrics(config)

    if synced > 0:
        record_sync_time()
        console.print(f"[green]Synced {synced} platform(s) to dashboard.[/green]")
    if queued > 0:
        console.print(f"[yellow]{queued} platform(s) queued (offline). Will retry next sync.[/yellow]")
    if synced == 0 and queued == 0:
        console.print("[dim]No activity to sync today.[/dim]")

    pending = get_queue_size()
    if pending > 0:
        console.print(f"[dim]{pending} item(s) pending in offline queue.[/dim]")


@main.command()
@click.option("--interval", default=3600, help="Sync interval in seconds.")
def daemon(interval: int) -> None:
    """Run background sync daemon (every hour by default)."""
    import time as _time
    from clapcheeks.sync import push_metrics, record_sync_time

    config = load_config()
    if not config.get("agent_token"):
        console.print("[yellow]Not connected. Run [cyan]clapcheeks setup[/cyan] first.[/yellow]")
        return

    console.print(f"[bold green]Sync daemon started[/bold green] (every {interval}s)")
    console.print("[dim]Press Ctrl+C to stop.[/dim]")

    while True:
        try:
            synced, queued = push_metrics(config)
            if synced > 0:
                record_sync_time()
            ts = __import__("datetime").datetime.now().strftime("%H:%M")
            console.print(f"  [{ts}] synced={synced} queued={queued}")
        except Exception as e:
            console.print(f"  [red]Sync error:[/red] {e}")
        _time.sleep(interval)


@main.command()
@click.option('--platform', default='tinder', type=click.Choice(['tinder', 'bumble', 'hinge']), help='Platform to manage conversations on.')
@click.option('--dry-run', is_flag=True, default=False, help='Show what would be sent without sending.')
def converse(platform: str, dry_run: bool) -> None:
    """AI-powered conversation manager — send openers and reply to matches."""
    from clapcheeks.config import load as load_config
    from clapcheeks.session.manager import SessionManager
    from clapcheeks.conversation.manager import ConversationManager

    config = load_config()
    if dry_run:
        config['dry_run'] = True
        console.print('[yellow]DRY RUN mode — messages will not be sent[/yellow]')

    console.print(f'\n[bold magenta]Clapcheeks[/bold magenta] conversation manager — [bold]{platform}[/bold]')

    with SessionManager(config) as session:
        with console.status(f'[bold green]Setting up {platform} connection...[/bold green]'):
            try:
                driver = session.get_driver(platform)
            except Exception as e:
                console.print(f'[bold red]Error:[/bold red] {e}')
                raise SystemExit(1)

        # Get platform client
        if platform == 'tinder':
            from clapcheeks.platforms.tinder import TinderClient
            client = TinderClient(driver=driver)
        elif platform == 'hinge':
            from clapcheeks.platforms.hinge import HingeClient
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
            f"[bold yellow]Dates proposed:[/bold yellow] {results.get('dates_proposed', 0)}\n"
            f"[bold blue]Re-engaged:[/bold blue] {results.get('reengaged', 0)}\n"
            f"[bold red]Errors:[/bold red] {results['errors']}",
            title=f"[magenta]Conversation Run — {platform}[/magenta]",
            border_style="magenta",
        ))


from clapcheeks.commands.profile import profile
main.add_command(profile)


@main.command()
def coach() -> None:
    """Run the AI profile coach — get actionable tips to improve your profile."""
    from clapcheeks.profile import profile_exists, load_profile
    from clapcheeks.ai.profile_coach import analyze_profile, format_coach_tips

    if not profile_exists():
        console.print("[yellow]No profile found. Run [cyan]clapcheeks profile setup[/cyan] first.[/yellow]")
        return

    prof = load_profile()
    tips = analyze_profile(prof)

    if not tips:
        console.print(Panel(
            "[bold green]Your profile looks great![/bold green] No tips right now.",
            title="[bold]AI Coach[/bold]",
            border_style="magenta",
            padding=(1, 2),
        ))
        return

    formatted = format_coach_tips(tips)
    console.print()
    console.print(Panel(
        formatted,
        title="[bold]AI Coach[/bold]",
        border_style="magenta",
        padding=(1, 2),
    ))
    console.print()


@main.command()
@click.option("--contacts", default=None, help="Comma-separated phone numbers or emails to watch.")
@click.option("--interval", default=5.0, show_default=True, help="Polling interval in seconds.")
@click.option("--style-refresh", is_flag=True, default=False, help="Force re-analyze texting style (ignore cache).")
@click.option("--dry-run", is_flag=True, default=False, help="Log replies without sending them.")
def watch(contacts: str | None, interval: float, style_refresh: bool, dry_run: bool) -> None:
    """Watch iMessage and auto-reply using AI in your voice.

    Automatically sends replies to incoming messages using local Ollama.
    All data stays on your device. Use --dry-run to preview without sending.
    """
    from clapcheeks.imessage.permissions import check_full_disk_access, prompt_fda_instructions
    from clapcheeks.imessage.reader import IMMessageReader
    from clapcheeks.imessage.voice import VoiceAnalyzer
    from clapcheeks.imessage.ai_reply import ReplyGenerator
    from clapcheeks.imessage.watcher import IMMessageWatcher

    # Check Full Disk Access
    if not check_full_disk_access():
        prompt_fda_instructions()
        raise SystemExit(1)

    if dry_run:
        console.print("[yellow]DRY RUN — replies will not be sent[/yellow]")

    reader = IMMessageReader()

    # Analyze texting style
    analyzer = VoiceAnalyzer(reader)
    if style_refresh:
        from clapcheeks.imessage.voice import STYLE_CACHE
        if STYLE_CACHE.exists():
            STYLE_CACHE.unlink()

    with console.status("[bold green]Analyzing your texting style...[/bold green]"):
        style = analyzer.analyze_style()

    console.print(Panel(
        f"[bold]Your style:[/bold] {style['tone_description']}",
        title="[magenta]Clapcheeks[/magenta]",
        border_style="magenta",
    ))

    style_prompt = analyzer.get_style_prompt(style)
    reply_gen = ReplyGenerator(style_prompt=style_prompt)

    # Parse contacts filter
    contact_list: list[str] | None = None
    if contacts:
        contact_list = [c.strip() for c in contacts.split(",") if c.strip()]

    watcher = IMMessageWatcher(reader, reply_gen, contacts=contact_list, dry_run=dry_run)

    try:
        watcher.start(poll_interval=interval)
    except KeyboardInterrupt:
        console.print("\n[dim]Stopped watching.[/dim]")
    finally:
        reader.close()


@main.command(name="queue-poll")
@click.option("--interval", default=30, show_default=True, help="Polling interval in seconds.")
@click.option("--dry-run", is_flag=True, default=False, help="Log sends without actually sending.")
def queue_poll(interval: int, dry_run: bool) -> None:
    """Poll Supabase for web-initiated replies and send via iMessage.

    Checks clapcheeks_queued_replies every --interval seconds for rows
    with status='queued', sends each via osascript, and marks them sent/failed.
    """
    import logging

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    from clapcheeks.imessage.queue_poller import run_poller

    if dry_run:
        console.print("[yellow]DRY RUN — messages will not be sent[/yellow]")

    console.print(
        f"[bold green]Queue poller started[/bold green] "
        f"(interval={interval}s)  Press Ctrl+C to stop."
    )

    try:
        run_poller(interval=interval, dry_run=dry_run)
    except KeyboardInterrupt:
        console.print("\n[dim]Queue poller stopped.[/dim]")


@main.group()
def browser() -> None:
    """Manage local browser for dating app automation."""
    pass


@browser.command()
def install() -> None:
    """Install browser dependencies for Playwright automation.

    Clapcheeks uses your system Chrome by default (no download needed).
    This command installs bundled Chromium as a fallback only.
    """
    import subprocess
    import sys
    console.print("[bold]Checking for system Chrome...[/bold]")
    # Check if system Chrome is available via Playwright channel
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             "from playwright.sync_api import sync_playwright; "
             "p = sync_playwright().start(); "
             "b = p.chromium.launch(channel='chrome', headless=True); "
             "b.close(); p.stop(); "
             "print('ok')"],
            capture_output=True, text=True, timeout=30,
        )
        if "ok" in result.stdout:
            console.print("[green]System Chrome detected -- no download needed.[/green]")
            return
    except Exception:
        pass

    console.print("[yellow]System Chrome not found. Installing bundled Chromium as fallback...[/yellow]")
    result = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=False,
    )
    if result.returncode == 0:
        console.print("[green]Chromium installed successfully.[/green]")
    else:
        console.print("[red]Failed to install Chromium. Run manually:[/red]")
        console.print("  [cyan]python -m playwright install chromium[/cyan]")
        raise SystemExit(1)


PLATFORM_URLS = {
    "tinder": "https://tinder.com",
    "bumble": "https://bumble.com/app",
    "hinge": "https://hinge.co/app",
}


@main.command()
@click.option("--platform", type=click.Choice(["tinder", "bumble", "hinge", "all"]),
              default="all", show_default=True, help="Platform(s) to connect.")
def connect(platform: str) -> None:
    """Log into dating apps and save your session.

    Opens a browser window so you can log in manually. Your session cookies
    are saved to ~/.clapcheeks/sessions/ for future automation runs.
    """
    import asyncio
    from clapcheeks.browser.driver import BrowserDriver

    platforms = list(PLATFORM_URLS) if platform == "all" else [platform]

    for plat in platforms:
        url = PLATFORM_URLS[plat]
        console.print(f"\n[bold cyan]{plat.capitalize()}[/bold cyan]")
        console.print(f"  Opening {url}")
        console.print(f"  [bold]Log into {plat.capitalize()} now, then press Enter when done.[/bold]")

        async def _connect(p: str, u: str) -> bool:
            driver = BrowserDriver(platform=p, headless=False)
            page = await driver.launch()
            await page.goto(u, wait_until="domcontentloaded")
            # Wait for user to press Enter in the terminal
            await asyncio.get_event_loop().run_in_executor(None, input)
            await driver.close()
            return driver.session_store.path.exists()

        loop = asyncio.new_event_loop()
        saved = loop.run_until_complete(_connect(plat, url))
        loop.close()

        if saved:
            console.print(f"  [green]Session saved for {plat.capitalize()}.[/green]")
        else:
            console.print(f"  [yellow]Warning: no session saved for {plat.capitalize()}.[/yellow]")

    console.print("\n[dim]All done. Run [cyan]clapcheeks swipe[/cyan] to start swiping.[/dim]\n")


@main.command(name='date-suggest')
@click.option('--platform', default='tinder', type=click.Choice(['tinder', 'bumble', 'hinge']), help='Platform.')
@click.option('--match-name', required=True, help='Name of your match.')
@click.option('--location', default='', help='Your city or neighborhood.')
@click.option('--prefs', default='casual, fun', help='Date preferences (e.g. "coffee, outdoors").')
def date_suggest(platform: str, match_name: str, location: str, prefs: str) -> None:
    """Get AI date suggestions based on your calendar availability."""
    from clapcheeks.config import load as load_config
    from clapcheeks.calendar.client import get_free_slots, book_date

    config = load_config()
    ai_url = config.get('ai_service_url', 'http://localhost:8000')

    with console.status('[bold green]Checking your calendar...[/bold green]'):
        free_slots = get_free_slots(days=7)

    if not free_slots:
        console.print('[yellow]No Google Calendar connected — showing generic suggestions[/yellow]')
        console.print('[dim]Run: clapcheeks setup — to configure Google Calendar[/dim]\n')

    with console.status('[bold green]Generating date suggestions with Kimi...[/bold green]'):
        import requests as _req
        try:
            resp = _req.post(
                f'{ai_url}/date/suggest',
                json={
                    'match_name': match_name,
                    'platform': platform,
                    'conversation': [],
                    'free_slots': free_slots,
                    'user_location': location or None,
                    'preferences': prefs,
                },
                timeout=15,
            )
            result = resp.json()
        except Exception as e:
            console.print(f'[bold red]Error:[/bold red] AI service not running. Start with: cd ai && uvicorn main:app')
            raise SystemExit(1)

    console.print()
    console.print(Panel(
        f"[bold white]{result.get('message', '')}[/bold white]",
        title=f"[magenta]Suggested message to {match_name}[/magenta]",
        border_style="magenta",
    ))

    if result.get('venue_suggestions'):
        console.print('\n[bold]Venue ideas:[/bold]')
        for v in result['venue_suggestions']:
            console.print(f'  [cyan]•[/cyan] {v}')

    if free_slots:
        console.print('\n[bold]Your free slots:[/bold]')
        for slot in free_slots[:5]:
            tag = ' [dim](weekend)[/dim]' if slot.get('is_weekend') else ''
            console.print(f"  [green]•[/green] {slot['label']} ({slot['duration_hours']}h free){tag}")

    console.print()
    if free_slots and click.confirm('Book the recommended slot on your Google Calendar?', default=False):
        rec_label = result.get('recommended_slot', '')
        slot = next((s for s in free_slots if s['label'] == rec_label), free_slots[0])
        venue = result.get('venue_suggestions', [''])[0]
        booked = book_date(match_name=match_name, start_iso=slot['start'], location=venue)
        if booked:
            console.print(f"[bold green]✓ Date booked![/bold green] [dim]{booked.get('htmlLink', '')}[/dim]")
        else:
            console.print('[yellow]Could not book — check: clapcheeks setup (Google Calendar)[/yellow]')


@main.command(name='upcoming-dates')
def upcoming_dates() -> None:
    """Show upcoming dates booked via Clapcheeks."""
    from clapcheeks.calendar.client import get_upcoming_dates

    events = get_upcoming_dates(days=30)

    if not events:
        console.print('[yellow]No upcoming dates found.[/yellow]')
        console.print('[dim]Book one with: clapcheeks date-suggest --match-name "Sarah"[/dim]')
        return

    table = Table(title='Upcoming Dates', show_header=True, header_style='bold magenta')
    table.add_column('Date', style='cyan', no_wrap=True)
    table.add_column('Who', style='bold white')
    table.add_column('Location', style='dim')

    for event in events:
        start = event.get('start', {}).get('dateTime', '')
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
            date_str = dt.strftime('%a %b %-d, %-I:%M%p')
        except Exception:
            date_str = start[:16]
        name = event.get('summary', '').replace('Date with ', '')
        loc = event.get('location', '') or '—'
        table.add_row(date_str, name, loc)

    console.print(table)


@main.group()
def photos() -> None:
    """Photo scoring and optimization tools."""
    pass


@photos.command()
@click.argument("path", type=click.Path(exists=True))
def score(path: str) -> None:
    """Score a single profile photo."""
    from clapcheeks.photos.scorer import score_photo

    with console.status("[bold green]Analyzing photo...[/bold green]"):
        result = score_photo(path)

    _print_photo_score(result)


@photos.command()
@click.argument("directory", type=click.Path(exists=True, file_okay=False))
def rank(directory: str) -> None:
    """Rank all photos in a directory."""
    from pathlib import Path as P
    from clapcheeks.photos.scorer import rank_photos

    exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    images = sorted(p for p in P(directory).iterdir() if p.suffix.lower() in exts)

    if not images:
        console.print(f"[yellow]No images found in {directory}[/yellow]")
        return

    console.print(f"[dim]Found {len(images)} photos[/dim]\n")

    with console.status(f"[bold green]Scoring {len(images)} photos...[/bold green]"):
        ranked = rank_photos(images)

    table = Table(title="Photo Rankings", show_header=True, header_style="bold magenta")
    table.add_column("#", style="bold", width=3)
    table.add_column("Photo", style="cyan")
    table.add_column("Score", style="bold white", justify="right")
    table.add_column("Face", justify="right")
    table.add_column("Smile", justify="right")
    table.add_column("BG", justify="right")
    table.add_column("Light", justify="right")
    table.add_column("Solo", justify="right")

    for s in ranked:
        color = "green" if s.score >= 70 else "yellow" if s.score >= 50 else "red"
        table.add_row(
            str(s.rank),
            P(s.path).name,
            f"[{color}]{s.score}[/{color}]",
            str(s.face_score),
            str(s.smile_score),
            str(s.background_score),
            str(s.lighting_score),
            str(s.solo_score),
        )

    console.print(table)

    # Show tips for the worst photo
    if len(ranked) > 1 and ranked[-1].tips:
        console.print(f"\n[bold]Tips for {P(ranked[-1].path).name}:[/bold]")
        for tip in ranked[-1].tips:
            console.print(f"  [yellow]*[/yellow] {tip}")
    console.print()


@photos.command()
def tips() -> None:
    """Get general improvement tips based on scored photos."""
    from clapcheeks.photos.scorer import get_recommendations

    console.print(Panel(
        "\n".join(f"  [cyan]*[/cyan] {r}" for r in get_recommendations([])),
        title="[bold]Photo Tips[/bold]",
        border_style="magenta",
        padding=(1, 2),
    ))


def _print_photo_score(result) -> None:
    """Pretty-print a single PhotoScore."""
    from pathlib import Path as P

    color = "green" if result.score >= 70 else "yellow" if result.score >= 50 else "red"

    lines = [
        f"[bold]Score:[/bold] [{color}]{result.score}/100[/{color}]",
        "",
        f"  Face clarity:  {_bar(result.face_score, 30)} {result.face_score}/30",
        f"  Smile/vibe:    {_bar(result.smile_score, 20)} {result.smile_score}/20",
        f"  Background:    {_bar(result.background_score, 20)} {result.background_score}/20",
        f"  Lighting:      {_bar(result.lighting_score, 15)} {result.lighting_score}/15",
        f"  Solo shot:     {_bar(result.solo_score, 15)} {result.solo_score}/15",
    ]

    if result.tips:
        lines.append("")
        lines.append("[bold]Tips:[/bold]")
        for tip in result.tips:
            lines.append(f"  [yellow]*[/yellow] {tip}")

    console.print(Panel(
        "\n".join(lines),
        title=f"[magenta]{P(result.path).name}[/magenta]",
        border_style="magenta",
        padding=(1, 2),
    ))


def _bar(value: float, maximum: float, width: int = 20) -> str:
    """Render a simple progress bar."""
    pct = value / max(maximum, 1)
    filled = int(pct * width)
    color = "green" if pct >= 0.7 else "yellow" if pct >= 0.5 else "red"
    return f"[{color}]{'#' * filled}{'.' * (width - filled)}[/{color}]"


class _nullctx:
    """No-op context manager for drivers that don't support 'with'."""
    def __init__(self, val): self.val = val
    def __enter__(self): return self.val
    def __exit__(self, *a): pass
