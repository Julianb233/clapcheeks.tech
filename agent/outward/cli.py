"""Outward local agent CLI."""
import click
from rich.console import Console

console = Console()

@click.group()
def main():
    """Outward — AI Dating Co-Pilot (local agent)"""
    pass

@main.command()
def setup():
    """Interactive first-time setup: connect account, configure apps."""
    console.print("[bold green]Welcome to Outward![/bold green]")
    console.print("Visit https://clapcheeks.tech to create an account first.")
    # TODO: prompt for API token, test connection, configure apps

@main.command()
def status():
    """Show current agent status and connected apps."""
    console.print("[bold]Outward Agent[/bold] — not yet configured")
    console.print("Run [cyan]outward setup[/cyan] to get started.")

@main.command()
def menu():
    """Open the interactive menu."""
    console.print("Interactive menu — coming soon")

@main.command()
def sync():
    """Sync today's metrics to your Outward dashboard."""
    console.print("Syncing metrics...")
    # TODO: collect local analytics, POST to api/analytics/sync
