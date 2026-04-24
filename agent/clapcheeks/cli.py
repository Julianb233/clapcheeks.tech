"""Clapcheeks local agent CLI — AI-powered dating co-pilot."""
from __future__ import annotations

from pathlib import Path

try:
    from dotenv import load_dotenv
    # Load ~/.clapcheeks/.env so HINGE_AUTH_TOKEN etc. are available before
    # any platform factory runs. Also pick up a repo-local .env if present.
    _ENV_PATH = Path.home() / ".clapcheeks" / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH)
    load_dotenv()  # repo-local fallback
except ImportError:
    pass

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


# ---------------------------------------------------------------------------
# iPhone-API token setup (Hinge + Tinder)
# ---------------------------------------------------------------------------

_ENV_DIR = Path.home() / ".clapcheeks"
_ENV_FILE = _ENV_DIR / ".env"


def _read_env_file() -> dict[str, str]:
    """Parse the agent's .env into a plain dict."""
    if not _ENV_FILE.exists():
        return {}
    out: dict[str, str] = {}
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _write_env_file(updates: dict[str, str]) -> None:
    """Merge updates into ~/.clapcheeks/.env with 0600 perms."""
    _ENV_DIR.mkdir(parents=True, exist_ok=True)
    current = _read_env_file()
    current.update({k: v for k, v in updates.items() if v})
    lines = [f"{k}={v}" for k, v in current.items()]
    _ENV_FILE.write_text("\n".join(lines) + "\n")
    try:
        _ENV_FILE.chmod(0o600)
    except Exception:
        pass


@main.command(name="setup-hinge-token")
def setup_hinge_token() -> None:
    """Interactive capture for the Hinge iPhone-API bearer token.

    Walks through the Charles/HTTP Toolkit flow (see docs/SETUP_HINGE_TOKEN.md),
    prompts for the token + optional device IDs, writes them to
    ~/.clapcheeks/.env, and probes the API to verify.
    """
    console.print(Panel(
        "[bold]Hinge iPhone-API token setup[/bold]\n\n"
        "Follow [cyan]docs/SETUP_HINGE_TOKEN.md[/cyan] to capture your token\n"
        "via Charles Proxy (iPhone) or HTTP Toolkit (Android). Hinge does not\n"
        "pin TLS certs, so no jailbreak or Frida is needed.",
        border_style="magenta",
    ))

    token = click.prompt(
        "Paste your Hinge Bearer token (the long JWT, no 'Bearer ' prefix)",
        hide_input=True,
    ).strip()
    if not token:
        console.print("[red]No token provided — aborting.[/red]")
        raise SystemExit(1)

    install_id = click.prompt(
        "Optional: X-Install-Id header (press enter to skip)",
        default="", show_default=False,
    ).strip()
    session_id = click.prompt(
        "Optional: X-Session-Id header (press enter to skip)",
        default="", show_default=False,
    ).strip()
    device_id = click.prompt(
        "Optional: X-Device-Id header (press enter to skip)",
        default="", show_default=False,
    ).strip()

    _write_env_file({
        "HINGE_AUTH_TOKEN": token,
        "HINGE_INSTALL_ID": install_id,
        "HINGE_SESSION_ID": session_id,
        "HINGE_DEVICE_ID": device_id,
    })
    console.print(f"[green]✓[/green] Wrote credentials to {_ENV_FILE}")

    # Verify with a live probe
    console.print("\n[bold]Verifying token against prod-api.hingeaws.net…[/bold]")
    import os
    for k, v in {
        "HINGE_AUTH_TOKEN": token,
        "HINGE_INSTALL_ID": install_id,
        "HINGE_SESSION_ID": session_id,
        "HINGE_DEVICE_ID": device_id,
    }.items():
        if v:
            os.environ[k] = v
    try:
        from clapcheeks.platforms.hinge_api import HingeAPIClient, HingeAuthError
        client = HingeAPIClient()
        client.login()
        console.print("[bold green]✓ Token works — Hinge API backend is live.[/bold green]")
        console.print(
            "\n[dim]The factory will now use the API path automatically on \n"
            "[cyan]clapcheeks swipe hinge[/cyan]. Token lasts ~7 days; rerun this\n"
            "command to refresh when you see 401 errors.[/dim]"
        )
    except HingeAuthError as exc:
        console.print(f"[red]✗ Token rejected by Hinge API:[/red] {exc}")
        raise SystemExit(1)
    except Exception as exc:
        console.print(f"[yellow]⚠ Could not verify (network?):[/yellow] {exc}")
        console.print("[dim]Token was saved. Run [cyan]clapcheeks swipe hinge[/cyan] to test.[/dim]")


@main.command(name="refresh-tinder-token")
@click.option(
    "--phone",
    default=None,
    help="E.164 phone (e.g. +14155551234). Defaults to CLAPCHEEKS_TINDER_PHONE.",
)
@click.option(
    "--timeout",
    default=120,
    show_default=True,
    help="Seconds to wait for the SMS code.",
)
@click.option(
    "--headful",
    is_flag=True,
    default=False,
    help="Run the Browserbase session visibly (for debugging).",
)
def refresh_tinder_token(phone: str | None, timeout: int, headful: bool) -> None:
    """Tinder token refresh via Browserbase + Messages.db SMS.

    Uses a stealth Chrome via Browserbase to pass Arkose, reads the SMS
    code from the Mac's Messages.db, and writes the fresh X-Auth-Token
    to ~/.clapcheeks/.env.
    """
    console.print(Panel(
        "[bold]Tinder Browserbase token refresh[/bold]\n\n"
        "Drives tinder.com in a stealth Chrome, pulls the SMS code from\n"
        "Messages.db (any paired iPhone works), submits, and saves the\n"
        "X-Auth-Token. Budget ~90 seconds.",
        border_style="magenta",
    ))

    if not phone:
        import os as _os
        phone = _os.environ.get("CLAPCHEEKS_TINDER_PHONE", "")
    if not phone:
        phone = click.prompt("Phone number (E.164, e.g. +14155551234)").strip()
    if not phone.startswith("+"):
        console.print("[red]Phone must be E.164 (+14155551234).[/red]")
        raise SystemExit(1)

    # Try local Chrome first (free, instant). Fall back to Browserbase SMS
    # flow only if local fails and --phone is available.
    with console.status("[bold green]Trying local Chrome first...[/bold green]"):
        try:
            from clapcheeks.platforms.tinder_local import (
                refresh_token as local_refresh, TinderLocalAuthFailed,
            )
            result = local_refresh(timeout_seconds=timeout)
            token_preview = result["token"][:12] + "..." + result["token"][-4:]
            console.print(
                f"[bold green]OK (local Chrome via {result['source']}).[/bold green] "
                f"Token written: {token_preview}"
            )
            return
        except TinderLocalAuthFailed as exc:
            console.print(f"[yellow]Local Chrome path failed:[/yellow] {exc}")
            console.print("[dim]Falling back to Browserbase + SMS login...[/dim]")

    with console.status("[bold green]Opening Browserbase + driving Tinder login...[/bold green]"):
        try:
            from clapcheeks.platforms.tinder_auth import (
                refresh_token as bb_refresh, TinderBrowserAuthFailed,
            )
            result = bb_refresh(
                phone,
                sms_timeout_seconds=timeout,
                headless=not headful,
            )
        except TinderBrowserAuthFailed as exc:
            console.print(f"[red]Refresh failed:[/red] {exc}")
            raise SystemExit(1)

    token_preview = result["token"][:12] + "..." + result["token"][-4:]
    console.print(f"[bold green]OK (Browserbase).[/bold green] Token written: {token_preview}")
    if result.get("bb_session_id"):
        console.print(f"[dim]Browserbase session: {result['bb_session_id']}[/dim]")


@main.command(name="refresh-hinge-token")
@click.option(
    "--phone",
    default=None,
    help="E.164 phone number (e.g. +14155551234). Defaults to CLAPCHEEKS_HINGE_PHONE.",
)
@click.option(
    "--timeout",
    default=90,
    show_default=True,
    help="Seconds to wait for the SMS to arrive in Messages.db.",
)
def refresh_hinge_token(phone: str | None, timeout: int) -> None:
    """Trigger Hinge's SMS auth flow and write a fresh token to .env.

    Reads the incoming code from macOS Messages.db, so any iPhone that
    forwards iMessage/SMS to this Mac will work. Requires Full Disk Access
    for the Python binary (System Settings -> Privacy & Security).
    """
    console.print(Panel(
        "[bold]Hinge SMS token refresh[/bold]\n\n"
        "Triggers Hinge to send an SMS, reads the code from Messages.db,\n"
        "submits it, and writes the new token into ~/.clapcheeks/.env.",
        border_style="magenta",
    ))

    if not phone:
        import os as _os
        phone = _os.environ.get("CLAPCHEEKS_HINGE_PHONE", "")
    if not phone:
        phone = click.prompt("Phone number (E.164, e.g. +14155551234)").strip()
    if not phone.startswith("+"):
        console.print("[red]Phone must be in E.164 format, e.g. +14155551234[/red]")
        raise SystemExit(1)

    with console.status("[bold green]Requesting SMS + waiting for the code...[/bold green]"):
        try:
            from clapcheeks.platforms.hinge_auth import refresh_token, HingeSMSAuthFailed
            result = refresh_token(phone, timeout_seconds=timeout)
        except HingeSMSAuthFailed as exc:
            console.print(f"[red]Refresh failed:[/red] {exc}")
            raise SystemExit(1)
        except Exception as exc:
            console.print(f"[red]Unexpected error:[/red] {exc}")
            raise SystemExit(1)

    token_preview = result['token'][:12] + "..." + result['token'][-4:]
    console.print(f"[bold green]OK.[/bold green] New token written: {token_preview}")
    extras = [k for k in ("install_id", "session_id", "device_id") if result.get(k)]
    if extras:
        console.print(f"[dim]Also saved: {', '.join(extras)}[/dim]")
    console.print(
        "[dim]Daemon picks it up on its next platform tick (or restart with\n"
        "`launchctl unload/load ~/Library/LaunchAgents/tech.clapcheeks.daemon.plist`).[/dim]"
    )


@main.command(name="setup-tinder-token")
@click.option(
    "--wire",
    type=click.Choice(["json", "protobuf"]),
    default="json",
    show_default=True,
    help="json = web-captured token (recommended). protobuf = iOS + Frida path.",
)
def setup_tinder_token(wire: str) -> None:
    """Interactive capture for the Tinder API auth token.

    Default flow uses JSON wire format with a token captured from tinder.com
    in Chrome DevTools — no jailbreak or cert pinning bypass needed. See
    docs/SETUP_TINDER_TOKEN.md (Path A).
    """
    if wire == "protobuf":
        console.print(Panel(
            "[bold]Tinder iPhone-API token setup (protobuf)[/bold]\n\n"
            "Prereqs: TLS-pinning bypass (jailbreak + SSL Kill Switch 2, or\n"
            "re-signed IPA with Frida-Gadget) + generated .proto modules.\n"
            "See [cyan]docs/SETUP_TINDER_TOKEN.md[/cyan] Path B.",
            border_style="magenta",
        ))
    else:
        console.print(Panel(
            "[bold]Tinder API token setup (web → JSON)[/bold]\n\n"
            "1. Open [cyan]tinder.com[/cyan] in Chrome, log in.\n"
            "2. DevTools → Network → Fetch/XHR → refresh.\n"
            "3. Click any [cyan]api.gotinder.com[/cyan] request.\n"
            "4. Copy the [bold]X-Auth-Token[/bold] header and paste below.",
            border_style="magenta",
        ))

    token = click.prompt(
        "Paste your Tinder X-Auth-Token",
        hide_input=True,
    ).strip()
    if not token:
        console.print("[red]No token provided — aborting.[/red]")
        raise SystemExit(1)

    persistent_id = click.prompt(
        "persistent-device-id header (UUID, optional — press enter to skip)",
        default="", show_default=False,
    ).strip()

    updates: dict[str, str] = {
        "TINDER_AUTH_TOKEN": token,
        "TINDER_WIRE_FORMAT": wire,
        "TINDER_PERSISTENT_ID": persistent_id,
    }

    if wire == "protobuf":
        app_version = click.prompt(
            "iOS app version (e.g. 14.26.0)",
            default="14.26.0",
        ).strip()
        updates["TINDER_APP_VERSION"] = app_version

        # Only flip API mode if the proto modules are present
        proto_dir = Path(__file__).parent / "platforms" / "tinder_proto"
        has_proto = proto_dir.exists() and any(
            p.name.endswith("_pb2.py") for p in proto_dir.iterdir() if p.is_file()
        )
        updates["CLAPCHEEKS_TINDER_MODE"] = "api" if has_proto else "browser"
        _write_env_file(updates)
        console.print(f"[green]✓[/green] Wrote credentials to {_ENV_FILE}")

        if has_proto:
            console.print(
                "[bold green]✓[/bold green] Protobuf modules detected — API mode ENABLED."
            )
        else:
            console.print(
                f"[yellow]⚠[/yellow] No *_pb2.py under {proto_dir}. "
                "Token saved but API mode is OFF (browser fallback).\n"
                "Generate proto modules per docs/SETUP_TINDER_TOKEN.md then "
                "flip [cyan]CLAPCHEEKS_TINDER_MODE=api[/cyan]."
            )
        return

    # --- JSON (web) path — verify live ---------------------------------
    updates["CLAPCHEEKS_TINDER_MODE"] = "api"
    _write_env_file(updates)
    console.print(f"[green]✓[/green] Wrote credentials to {_ENV_FILE}")

    console.print("\n[bold]Verifying token against api.gotinder.com…[/bold]")
    import os
    for k, v in updates.items():
        if v:
            os.environ[k] = v
    try:
        from clapcheeks.platforms.tinder_api import TinderAPIClient, TinderAuthError
        client = TinderAPIClient()
        if client.login():
            console.print("[bold green]✓ Token works — Tinder API backend is live.[/bold green]")
            console.print(
                "\n[dim]Run [cyan]clapcheeks swipe tinder[/cyan] to start. Web tokens\n"
                "last ~30 days; rerun this command when you hit 401.[/dim]"
            )
        else:
            console.print(
                "[yellow]⚠ Login probe returned false.[/yellow] Token was saved; "
                "try running a swipe to see the actual error."
            )
    except TinderAuthError as exc:
        console.print(f"[red]✗ Token rejected:[/red] {exc}")
        raise SystemExit(1)
    except Exception as exc:
        console.print(f"[yellow]⚠ Could not verify (network?):[/yellow] {exc}")
        console.print("[dim]Token was saved. Run [cyan]clapcheeks swipe tinder[/cyan] to test.[/dim]")


@main.command()
@click.option("--lines", "-n", default=100, show_default=True, help="Number of lines to show.")
def logs(lines: int) -> None:
    """Show recent daemon log entries."""
    from clapcheeks.config import CONFIG_DIR

    log_path = CONFIG_DIR / "daemon.log"
    if not log_path.exists():
        console.print("[dim]No log file found at %s[/dim]" % log_path)
        console.print("[dim]Start the daemon first: [cyan]clapcheeks daemon[/cyan][/dim]")
        return

    # Read last N lines from log file
    try:
        all_lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = all_lines[-lines:] if len(all_lines) > lines else all_lines
        for line in tail:
            console.print(line)
    except Exception as e:
        console.print(f"[red]Error reading log: {e}[/red]")


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

                from clapcheeks.platforms import get_platform_client
                client = get_platform_client(
                    plat,
                    driver=driver,
                    ai_service_url=config.get('ai_service_url'),
                )

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

        # Get platform client (factory routes to API or browser backend)
        if platform == 'bumble':
            console.print(f'[yellow]Bumble conversation management uses the driver directly.[/yellow]')
            raise SystemExit(0)
        from clapcheeks.platforms import get_platform_client
        client = get_platform_client(
            platform,
            driver=driver,
            ai_service_url=config.get('ai_service_url'),
        )

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


@main.group()
def reengagement() -> None:
    """Cold match recovery — find and re-engage silent matches."""
    pass


@reengagement.command(name='check')
def reengagement_check() -> None:
    """Show all cold matches (3+ days without reply)."""
    from clapcheeks.conversation.reengagement import find_cold_matches, get_reengagement_stage

    cold = find_cold_matches()
    if not cold:
        console.print('[green]No cold matches found — all conversations are active.[/green]')
        return

    table = Table(title='Cold Matches', show_header=True, header_style='bold magenta')
    table.add_column('Name', style='bold white')
    table.add_column('Platform', style='cyan')
    table.add_column('Days Cold', justify='right')
    table.add_column('Stage', style='bold')

    stage_colors = {'bump': 'yellow', 'restart': 'orange3', 'final': 'red', 'archive': 'dim'}
    for m in cold:
        stage = get_reengagement_stage(m.days_cold)
        color = stage_colors.get(stage, 'white')
        table.add_row(m.name, m.platform, str(m.days_cold), f'[{color}]{stage}[/{color}]')

    console.print(table)
    console.print(f'\n[dim]{len(cold)} cold match(es). Run [cyan]clapcheeks reengagement run[/cyan] to send messages.[/dim]')


@reengagement.command(name='run')
@click.option('--platform', default=None, type=click.Choice(['tinder', 'bumble', 'hinge']),
              help='Only re-engage on a specific platform.')
@click.option('--dry-run', is_flag=True, default=False, help='Show what would be sent without sending.')
def reengagement_run(platform: str | None, dry_run: bool) -> None:
    """Run re-engagement pass — send messages to cold matches."""
    from clapcheeks.conversation.reengagement import run_reengagement_pass

    config = load_config()
    if dry_run:
        config['dry_run'] = True
        console.print('[yellow]DRY RUN mode — messages will not be sent[/yellow]')

    # Build platform clients for requested platforms
    platform_clients: dict = {}
    platforms_to_check = [platform] if platform else ['tinder', 'bumble', 'hinge']

    for plat in platforms_to_check:
        try:
            from clapcheeks.session.manager import SessionManager
            session = SessionManager(config)
            driver = session.get_driver(plat)
            from clapcheeks.platforms import get_platform_client
            platform_clients[plat] = get_platform_client(
                plat,
                driver=driver,
                ai_service_url=config.get('ai_service_url'),
            )
        except Exception as exc:
            console.print(f'[dim]Skipping {plat}: {exc}[/dim]')

    if not platform_clients:
        console.print('[yellow]No platform connections available. Run [cyan]clapcheeks connect[/cyan] first.[/yellow]')
        return

    with console.status('[bold green]Running re-engagement pass...[/bold green]'):
        results = run_reengagement_pass(platform_clients, config)

    console.print(Panel(
        f"[bold white]Checked:[/bold white] {results['checked']}\n"
        f"[bold green]Sent:[/bold green] {results['sent']}\n"
        f"[bold dim]Archived:[/bold dim] {results['archived']}\n"
        f"[bold red]Errors:[/bold red] {results['errors']}",
        title='[magenta]Re-engagement Results[/magenta]',
        border_style='magenta',
    ))


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


@main.group()
def proxy() -> None:
    """Manage residential proxy rotation for platform isolation."""
    pass


@proxy.command(name="status")
def proxy_status() -> None:
    """Show configured proxy pools and their health."""
    from clapcheeks.proxy.manager import ProxyManager, ALL_FAMILIES, PLATFORM_FAMILY

    mgr = ProxyManager()

    if mgr.provider == "none" or not mgr.provider:
        console.print("[yellow]No proxy configured.[/yellow]")
        console.print("[dim]Add a [cyan]proxy:[/cyan] section to ~/.clapcheeks/config.yaml[/dim]")
        return

    console.print(f"\n[bold]Provider:[/bold] {mgr.provider}")
    console.print()

    summary = mgr.status_summary()
    if not summary:
        console.print("[yellow]No proxy pools loaded.[/yellow]")
        return

    table = Table(show_header=True, header_style="bold dim", box=None, padding=(0, 2))
    table.add_column("Family")
    table.add_column("Proxies")
    table.add_column("Platforms")

    for fam in ALL_FAMILIES:
        pool = summary.get(fam, [])
        healthy = sum(1 for p in pool if p["healthy"])
        count_str = f"[green]{healthy}[/green]/{len(pool)}" if pool else "[dim]0[/dim]"
        platforms = ", ".join(p for p, f in sorted(PLATFORM_FAMILY.items()) if f == fam)
        table.add_row(fam, count_str, platforms)

    console.print(table)
    console.print()


@proxy.command(name="test")
def proxy_test() -> None:
    """Test proxy connectivity for each platform family."""
    import requests as _req
    from clapcheeks.proxy.manager import ProxyManager, ALL_FAMILIES

    mgr = ProxyManager()

    if mgr.provider == "none" or not mgr.provider:
        console.print("[yellow]No proxy configured.[/yellow]")
        return

    console.print(f"[bold]Testing proxies[/bold] (provider: {mgr.provider})\n")

    for fam in ALL_FAMILIES:
        pool = mgr.pools.get(fam, [])
        if not pool:
            console.print(f"  {fam}: [dim]no proxies[/dim]")
            continue

        proxy_obj = pool[0]
        try:
            resp = _req.get(
                "https://httpbin.org/ip",
                proxies=proxy_obj.requests_dict,
                timeout=15,
            )
            ip = resp.json().get("origin", "?")
            console.print(f"  {fam}: [green]OK[/green] (IP: {ip})")
        except Exception as exc:
            console.print(f"  {fam}: [red]FAIL[/red] ({exc})")

    console.print()


@main.group()
def ban() -> None:
    """Ban detection and platform pause management."""
    pass


@ban.command(name="status")
def ban_status() -> None:
    """Show ban state for all platforms."""
    from clapcheeks.session.ban_detector import BanDetector

    detector = BanDetector()
    summary = detector.get_status_summary()

    if not summary:
        console.print("[green]No ban signals recorded. All platforms clean.[/green]")
        return

    table = Table(title="Ban Status", show_header=True, header_style="bold magenta")
    table.add_column("Platform", style="bold")
    table.add_column("Status")
    table.add_column("Paused Until", style="dim")
    table.add_column("Empty Sessions", justify="right")
    table.add_column("Signals", justify="right")

    status_colors = {"clean": "green", "suspected": "yellow", "soft_ban": "red", "hard_ban": "bold red"}
    for platform, info in sorted(summary.items()):
        status = info["status"]
        color = status_colors.get(status, "white")
        paused = info["paused_until"] or "—"
        table.add_row(
            platform,
            f"[{color}]{status}[/{color}]",
            paused,
            str(info["consecutive_empty_sessions"]),
            str(info["signal_count"]),
        )

    console.print(table)


@ban.command(name="pause")
@click.argument("platform")
@click.option("--hours", default=48.0, show_default=True, help="Hours to pause.")
def ban_pause(platform: str, hours: float) -> None:
    """Manually pause a platform."""
    from clapcheeks.session.ban_detector import BanDetector

    detector = BanDetector()
    detector.pause_platform(platform, hours=hours)
    console.print(f"[yellow]{platform} paused for {hours}h.[/yellow]")


@ban.command(name="resume")
@click.argument("platform")
def ban_resume(platform: str) -> None:
    """Manually resume a paused platform."""
    from clapcheeks.session.ban_detector import BanDetector

    detector = BanDetector()
    detector.resume_platform(platform)
    console.print(f"[green]{platform} resumed.[/green]")


@ban.command(name="history")
@click.argument("platform")
def ban_history(platform: str) -> None:
    """Show signal history for a platform."""
    from clapcheeks.session.ban_detector import BanDetector

    detector = BanDetector()
    signals = detector.get_signal_history(platform)

    if not signals:
        console.print(f"[dim]No ban signals recorded for {platform}.[/dim]")
        return

    table = Table(title=f"Ban Signal History — {platform}", show_header=True, header_style="bold magenta")
    table.add_column("Time", style="dim", no_wrap=True)
    table.add_column("Type", style="bold")
    table.add_column("Details")

    for s in signals:
        ts = s["detected_at"][:19].replace("T", " ")
        table.add_row(ts, s["signal_type"], s.get("details", ""))

    console.print(table)


class _nullctx:
    """No-op context manager for drivers that don't support 'with'."""
    def __init__(self, val): self.val = val
    def __enter__(self): return self.val
    def __exit__(self, *a): pass


# ── BlueBubbles fleet integration (2026-04-24) ──────────────────────────────

@main.command(name="bb-register-phone")
@click.argument("phone")
@click.option("--slug", default="clapcheeks", show_default=True,
              help="Slug the webhook will tag inbound messages from this phone with.")
def bb_register_phone(phone: str, slug: str) -> None:
    """Register a phone/email in the fleet BlueBubbles contact-index.

    Inbound messages from this address will land in
    /opt/agency-workspace/fleet-shared/inbox/<slug>/<date>.ndjson so the
    clapcheeks inbox tailer (clapcheeks bb-inbox-watch) picks them up.
    """
    from clapcheeks.imessage.contact_index import register, CONTACT_INDEX_PATH
    key, prev = register(phone, slug)
    if prev and prev != slug:
        console.print(f"[yellow]overwrote[/yellow] {key} → {prev!r} with → {slug!r}")
    elif prev == slug:
        console.print(f"[dim]no change: {key} → {slug}[/dim]")
    else:
        console.print(f"[green]registered[/green] {key} → {slug}")
    console.print(f"[dim]file: {CONTACT_INDEX_PATH}[/dim]")


@main.command(name="bb-inbox-watch")
@click.option("--slug", default="clapcheeks", show_default=True,
              help="Slug dir to tail under fleet-shared/inbox/.")
@click.option("--also-unknown", is_flag=True, default=False,
              help="Also tail fleet-shared/inbox/unknown/ (catches unregistered senders).")
@click.option("--poll-interval", default=1.0, show_default=True, type=float)
@click.option("--print-only", is_flag=True, default=False,
              help="Only print events to stdout; do not feed into the reply pipeline.")
def bb_inbox_watch(slug: str, also_unknown: bool, poll_interval: float, print_only: bool) -> None:
    """Tail the fleet BlueBubbles inbox and emit inbound iMessage events.

    Replaces chat.db polling on VPS deployments. Requires the BlueBubbles
    webhook service on the VPS to be running (pm2: bluebubbles-webhook).
    """
    from clapcheeks.imessage.bluebubbles_inbox import BlueBubblesInbox, InboundEvent

    def handle(evt: InboundEvent) -> None:
        console.print(
            f"[cyan]{evt.ts}[/cyan] [bold]{evt.from_addr or '?'}[/bold] "
            f"([magenta]{evt.type}[/magenta]) {evt.text or ''}"
        )

    inbox = BlueBubblesInbox(slug=slug, callback=handle, watch_unknown=also_unknown)
    console.print(
        f"[green]BlueBubbles inbox tailing[/green] slug={slug} "
        f"also_unknown={also_unknown} poll={poll_interval}s (Ctrl+C to stop)"
    )
    if print_only:
        inbox.start(poll_interval=poll_interval)
    else:
        # Future: route events into the same pipeline as watcher._handle_new_message
        # (reply generator + sender). For now, print-only — the reply path is
        # wired via the existing queue-poll + watcher until we cut over.
        inbox.start(poll_interval=poll_interval)
