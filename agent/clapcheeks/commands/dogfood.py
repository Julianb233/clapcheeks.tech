"""CLI commands for dogfooding — status, reporting, friction logging, and platform checks."""
from __future__ import annotations

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()


@click.group()
def dogfood() -> None:
    """Dogfooding tools — status, reports, friction, and platform checks."""
    pass


@dogfood.command()
def status() -> None:
    """Show agent health, streak, and dogfooding progress."""
    from clapcheeks.dogfood.health_monitor import HealthMonitor

    monitor = HealthMonitor()
    summary = monitor.get_weekly_summary()
    hb = monitor.get_last_heartbeat()

    # Streak display
    streak = summary["consecutive_streak"]
    streak_bar = "█" * min(streak, 7) + "░" * max(0, 7 - streak)
    streak_color = "green" if streak >= 7 else "yellow" if streak >= 3 else "red"

    console.print(Panel(
        f"[bold {streak_color}]{streak_bar}[/] {streak}/7 days\n"
        f"[dim]Target: 7 consecutive crash-free days[/]",
        title="[bold]Dogfooding Streak[/]",
        border_style=streak_color,
    ))

    # Success criteria table
    criteria = Table(title="Success Criteria", show_header=True)
    criteria.add_column("Criterion", style="white")
    criteria.add_column("Status", style="white", justify="center")
    criteria.add_column("Detail", style="dim")

    c = summary["success_criteria"]
    criteria.add_row(
        "7-day streak",
        "[green]PASS[/]" if c["7_day_streak"] else "[red]FAIL[/]",
        f"{streak}/7 days",
    )
    criteria.add_row(
        "AI conversation",
        "[green]PASS[/]" if c["at_least_1_ai_conversation"] else "[red]FAIL[/]",
        f"{summary['total_ai_replies']} AI replies",
    )
    console.print(criteria)

    # Agent status
    if hb:
        console.print(f"\n[dim]Last heartbeat:[/] {hb['timestamp']}")
        console.print(f"[dim]Platforms active:[/] {', '.join(hb.get('platforms_active', [])) or 'none'}")
    else:
        console.print("\n[yellow]No heartbeat detected. Is the daemon running?[/]")

    # Quick stats
    console.print(f"\n[dim]This week:[/]")
    console.print(f"  Days active: {summary['days_active']}")
    console.print(f"  Uptime: {summary['total_uptime_hours']}h")
    console.print(f"  Crashes: {summary['total_crashes']}")
    console.print(f"  Platforms: {', '.join(summary['platforms_used']) or 'none'}")


@dogfood.command()
def report() -> None:
    """Generate this week's dogfooding report."""
    from clapcheeks.dogfood.report_generator import DogfoodReporter

    reporter = DogfoodReporter()

    with console.status("[bold]Generating weekly report...[/]"):
        report = reporter.generate_weekly_report()
        pushed = reporter.push_to_supabase(report)

    score = report["dogfood_score"]
    score_color = "green" if score >= 70 else "yellow" if score >= 40 else "red"

    console.print(Panel(
        f"[bold {score_color}]{score}/100[/] Dogfood Score\n"
        f"[dim]Week: {report['week_start']} to {report['week_end']}[/]",
        title="[bold]Weekly Report[/]",
        border_style=score_color,
    ))

    # Criteria summary
    for name, c in report["success_criteria"].items():
        status = "[green]✓ PASS[/]" if c["passed"] else "[red]✗ FAIL[/]"
        console.print(f"  {status}  {c['description']}")

    # Metrics
    m = report["metrics"]
    console.print(f"\n[bold]Activity:[/]")
    console.print(f"  Swipes: {m['total_swipes']}  |  Matches: {m['total_matches']}  |  Dates: {m['total_dates']}")
    console.print(f"  Match rate: {m['match_rate']}%  |  Spent: ${m['total_spent']}")

    # Friction
    f = report["friction"]
    console.print(f"\n[bold]Friction:[/] {f['total_this_week']} this week ({f['unresolved']} unresolved)")

    if pushed:
        console.print(f"\n[green]Report synced to dashboard.[/]")
    else:
        console.print(f"\n[yellow]Report saved locally (sync failed).[/]")


@dogfood.command()
@click.argument("title")
@click.option("--severity", "-s", type=click.Choice(["blocker", "major", "minor", "cosmetic"]), default="minor")
@click.option("--category", "-c", type=click.Choice([
    "swiping", "conversation", "agent_setup", "auth", "stripe",
    "dashboard", "reports", "performance", "crash", "ux", "other"
]), default="ux")
@click.option("--platform", "-p", type=click.Choice(["tinder", "bumble", "hinge"]), default=None)
@click.option("--description", "-d", default="")
def friction(title: str, severity: str, category: str, platform: str | None, description: str) -> None:
    """Log a friction point encountered during dogfooding."""
    from clapcheeks.dogfood.friction_tracker import (
        FrictionCategory,
        FrictionSeverity,
        FrictionTracker,
    )

    tracker = FrictionTracker()
    event = tracker.log(
        title=title,
        description=description or title,
        severity=FrictionSeverity(severity),
        category=FrictionCategory(category),
        platform=platform,
    )

    console.print(f"[green]Friction point logged:[/] {event['id'][:8]}...")
    console.print(f"  Title: {title}")
    console.print(f"  Severity: {severity}  |  Category: {category}")
    if platform:
        console.print(f"  Platform: {platform}")


@dogfood.command(name="list-friction")
@click.option("--unresolved", "-u", is_flag=True, help="Show only unresolved issues")
def list_friction(unresolved: bool) -> None:
    """List all friction points."""
    from clapcheeks.dogfood.friction_tracker import FrictionTracker

    tracker = FrictionTracker()
    events = tracker.get_all(unresolved_only=unresolved)

    if not events:
        console.print("[dim]No friction points logged yet.[/]")
        return

    table = Table(title="Friction Points", show_header=True)
    table.add_column("ID", style="dim", width=8)
    table.add_column("Severity", width=10)
    table.add_column("Category", width=14)
    table.add_column("Title", style="white")
    table.add_column("Platform", width=10)
    table.add_column("Status", width=10)

    severity_colors = {
        "blocker": "red bold",
        "major": "red",
        "minor": "yellow",
        "cosmetic": "dim",
    }

    for e in events:
        sev = e["severity"]
        status = "[green]Resolved[/]" if e.get("resolved") else "[yellow]Open[/]"
        table.add_row(
            e["id"][:8],
            f"[{severity_colors.get(sev, 'white')}]{sev}[/]",
            e["category"],
            e["title"],
            e.get("platform") or "-",
            status,
        )

    console.print(table)
    summary = tracker.get_summary()
    console.print(f"\n[dim]Total: {summary['total']} | Unresolved: {summary['unresolved']}[/]")


@dogfood.command(name="check")
@click.option("--platform", "-p", type=click.Choice(["tinder", "bumble", "hinge"]), default=None)
def check_platforms(platform: str | None) -> None:
    """Run platform validation checks."""
    from clapcheeks.dogfood.platform_harness import PlatformTestHarness

    harness = PlatformTestHarness(platforms=[platform] if platform else None)

    with console.status("[bold]Running platform checks...[/]"):
        report = harness.run_all_checks()

    table = Table(title="Platform Check Results", show_header=True)
    table.add_column("Platform", width=10)
    table.add_column("Check", width=22)
    table.add_column("Status", width=8, justify="center")
    table.add_column("Time", width=8, justify="right")
    table.add_column("Details", style="dim")

    for r in report.results:
        status = "[green]PASS[/]" if r.passed else "[red]FAIL[/]"
        detail = r.error if r.error else str(r.details)[:50]
        table.add_row(
            r.platform,
            r.check_name,
            status,
            f"{r.duration_ms}ms",
            detail,
        )

    console.print(table)
    console.print(f"\n[bold]Healthy:[/] {', '.join(report.platforms_healthy) or 'none'}")
    console.print(f"[bold]Unhealthy:[/] {', '.join(report.platforms_unhealthy) or 'none'}")
