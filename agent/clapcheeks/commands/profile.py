"""CLI commands for managing your dating profile and preferences."""
from __future__ import annotations

import dataclasses

import click
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table

from clapcheeks.profile import Profile, load_profile, profile_exists, save_profile

console = Console()

LOOKING_FOR_CHOICES = ["casual", "serious", "open", "friends", "not sure"]
CONVO_STYLE_CHOICES = ["shy", "balanced", "flirty", "bold"]
LIST_FIELDS = {"pref_traits", "dealbreakers", "topics_to_avoid"}
INT_FIELDS = {"age", "pref_age_min", "pref_age_max", "pref_max_distance_miles"}


@click.group()
def profile() -> None:
    """Manage your dating profile and preferences."""


@profile.command()
def setup() -> None:
    """Interactive wizard to create your dating profile."""
    if profile_exists():
        if not Confirm.ask("[yellow]A profile already exists.[/yellow] Overwrite?", default=False):
            console.print("[dim]Keeping existing profile.[/dim]")
            return

    console.print(Panel(
        "[bold magenta]Let's set up your dating profile.[/bold magenta]\n"
        "[dim]All data stays on this device.[/dim]",
        border_style="magenta",
        padding=(1, 2),
    ))

    p = Profile()

    # --- About You ---
    console.print("\n[bold cyan]About You[/bold cyan]")
    p.name = Prompt.ask("  Name")
    p.age = IntPrompt.ask("  Age")
    p.location = Prompt.ask("  Location (city/region)")
    p.looking_for = Prompt.ask(
        "  Looking for",
        choices=LOOKING_FOR_CHOICES,
        default="not sure",
    )
    p.bio_summary = Prompt.ask("  One-liner about yourself")

    # --- Attraction Preferences ---
    console.print("\n[bold cyan]Attraction Preferences[/bold cyan]")
    p.pref_age_min = IntPrompt.ask("  Min age", default=18)
    p.pref_age_max = IntPrompt.ask("  Max age", default=35)
    p.pref_max_distance_miles = IntPrompt.ask("  Max distance (miles)", default=25)
    traits_raw = Prompt.ask("  Traits you care about (comma-separated)", default="")
    p.pref_traits = [t.strip() for t in traits_raw.split(",") if t.strip()]

    # --- Dealbreakers ---
    console.print("\n[bold cyan]Dealbreakers[/bold cyan]")
    db_raw = Prompt.ask("  Hard dealbreakers, comma-separated (e.g. smoking, long distance, no humor)", default="")
    p.dealbreakers = [d.strip() for d in db_raw.split(",") if d.strip()]

    # --- Conversation Style ---
    console.print("\n[bold cyan]Conversation Style[/bold cyan]")
    p.convo_style = Prompt.ask(
        "  Style",
        choices=CONVO_STYLE_CHOICES,
        default="balanced",
    )
    avoid_raw = Prompt.ask("  Topics to avoid (comma-separated)", default="")
    p.topics_to_avoid = [t.strip() for t in avoid_raw.split(",") if t.strip()]

    # --- Summary ---
    console.print()
    _render_summary_table(p)
    console.print()

    if Confirm.ask("Save this profile?", default=True):
        save_profile(p)
        console.print("[green]Profile saved![/green]")
    else:
        console.print("[dim]Discarded.[/dim]")


@profile.command()
def show() -> None:
    """Display your saved profile."""
    if not profile_exists():
        console.print("[yellow]No profile found. Run [cyan]clapcheeks profile setup[/cyan] first.[/yellow]")
        return

    p = load_profile()

    sections = []
    sections.append("[bold cyan]About You[/bold cyan]")
    sections.append(f"  Name:        {p.name}")
    sections.append(f"  Age:         {p.age}")
    sections.append(f"  Location:    {p.location}")
    sections.append(f"  Looking for: {p.looking_for}")
    sections.append(f"  Bio:         {p.bio_summary}")

    sections.append("\n[bold cyan]Preferences[/bold cyan]")
    sections.append(f"  Age range:   {p.pref_age_min}–{p.pref_age_max}")
    sections.append(f"  Distance:    {p.pref_max_distance_miles} miles")
    sections.append(f"  Traits:      {', '.join(p.pref_traits) or '(none)'}")

    sections.append("\n[bold cyan]Dealbreakers[/bold cyan]")
    sections.append(f"  {', '.join(p.dealbreakers) or '(none)'}")

    sections.append("\n[bold cyan]Conversation Style[/bold cyan]")
    sections.append(f"  Style:       {p.convo_style}")
    sections.append(f"  Avoid:       {', '.join(p.topics_to_avoid) or '(none)'}")

    console.print(Panel(
        "\n".join(sections),
        title="[bold magenta]Your Profile[/bold magenta]",
        border_style="magenta",
        padding=(1, 2),
    ))
    console.print(f"  [dim]Last updated: {p.updated_at}[/dim]")


@profile.command()
@click.argument("field_name")
@click.argument("value")
def edit(field_name: str, value: str) -> None:
    """Update a single profile field. Example: clapcheeks profile edit age 28"""
    valid_fields = {f.name for f in dataclasses.fields(Profile) if f.name != "updated_at"}

    if field_name not in valid_fields:
        console.print(f"[red]Unknown field:[/red] {field_name}")
        console.print(f"[dim]Available fields: {', '.join(sorted(valid_fields))}[/dim]")
        raise SystemExit(1)

    if not profile_exists():
        console.print("[yellow]No profile found. Run [cyan]clapcheeks profile setup[/cyan] first.[/yellow]")
        raise SystemExit(1)

    p = load_profile()

    if field_name in LIST_FIELDS:
        setattr(p, field_name, [v.strip() for v in value.split(",") if v.strip()])
    elif field_name in INT_FIELDS:
        try:
            setattr(p, field_name, int(value))
        except ValueError:
            console.print(f"[red]{field_name} must be a number.[/red]")
            raise SystemExit(1)
    else:
        setattr(p, field_name, value)

    save_profile(p)
    console.print(f"[green]Updated {field_name}[/green] = {getattr(p, field_name)}")


def _render_summary_table(p: Profile) -> None:
    """Render a summary table of the profile."""
    table = Table(title="Profile Summary", border_style="magenta", show_lines=True)
    table.add_column("Field", style="bold")
    table.add_column("Value")

    table.add_row("Name", p.name)
    table.add_row("Age", str(p.age))
    table.add_row("Location", p.location)
    table.add_row("Looking for", p.looking_for)
    table.add_row("Bio", p.bio_summary)
    table.add_row("Age range", f"{p.pref_age_min}–{p.pref_age_max}")
    table.add_row("Max distance", f"{p.pref_max_distance_miles} miles")
    table.add_row("Traits", ", ".join(p.pref_traits) or "(none)")
    table.add_row("Dealbreakers", ", ".join(p.dealbreakers) or "(none)")
    table.add_row("Convo style", p.convo_style)
    table.add_row("Topics to avoid", ", ".join(p.topics_to_avoid) or "(none)")

    console.print(table)
