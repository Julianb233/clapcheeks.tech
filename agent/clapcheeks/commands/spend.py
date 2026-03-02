"""CLI commands for the local spending tracker."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import click
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from clapcheeks.spending import SpendingDB, CATEGORIES

console = Console()

CATEGORY_COLORS = {
    "dinner": "green",
    "drinks": "cyan",
    "activity": "yellow",
    "transport": "blue",
    "gift": "magenta",
    "other": "dim",
}


@click.group()
def spend():
    """Track date spending and view analytics."""
    pass


@spend.command()
@click.option("--amount", "-a", type=float, prompt="Amount ($)", help="Amount spent")
@click.option(
    "--category",
    "-c",
    type=click.Choice(CATEGORIES),
    prompt="Category",
    help="Expense category",
)
@click.option(
    "--date",
    "-d",
    "expense_date",
    default=None,
    help="Date (YYYY-MM-DD, default: today)",
)
@click.option("--notes", "-n", default="", help="Optional notes")
def log(amount: float, category: str, expense_date: str | None, notes: str):
    """Log a date expense."""
    if expense_date is None:
        expense_date = date.today().isoformat()
    db = SpendingDB()
    eid = db.add_expense(amount, category, expense_date, notes)
    console.print(
        f"[green]Logged ${amount:.2f} {category} on {expense_date}[/green] (id={eid})"
    )


@spend.command()
@click.option("--month", "-m", default=None, help="Filter by month (YYYY-MM)")
def summary(month: str | None):
    """Show spending stats and category breakdown."""
    db = SpendingDB()
    data = db.get_summary()

    if data["count_all_time"] == 0:
        console.print("[dim]No expenses recorded yet. Use [cyan]spend log[/cyan] to add one.[/dim]")
        return

    # Header
    if month:
        expenses = db.get_expenses(month=month)
        total = sum(e["amount"] for e in expenses)
        count = len(expenses)
        title = f"Spending Summary -- {month}"
        # Build per-category from filtered data
        cats: dict[str, dict] = {}
        for e in expenses:
            c = e["category"]
            if c not in cats:
                cats[c] = {"total": 0.0, "count": 0}
            cats[c]["total"] += e["amount"]
            cats[c]["count"] += 1
    else:
        total = data["total_all_time"]
        count = data["count_all_time"]
        cats = data["by_category"]
        title = "Spending Summary -- All Time"

    avg = total / count if count else 0

    console.print()
    console.print(
        Panel(
            f"[bold]Total:[/bold]  ${total:,.2f} across {count} dates\n"
            f"[bold]Avg:[/bold]    ${avg:,.2f} per date",
            title=f"[bold magenta]{title}[/bold magenta]",
            border_style="magenta",
            padding=(0, 2),
        )
    )

    # Category table
    table = Table(box=box.ROUNDED, show_header=True, header_style="bold")
    table.add_column("Category", style="bold")
    table.add_column("Total", justify="right")
    table.add_column("Count", justify="center")
    table.add_column("Avg/Date", justify="right")

    for cat, info in sorted(cats.items(), key=lambda x: x[1]["total"], reverse=True):
        color = CATEGORY_COLORS.get(cat, "white")
        cat_avg = info["total"] / info["count"] if info["count"] else 0
        table.add_row(
            f"[{color}]{cat}[/{color}]",
            f"${info['total']:,.2f}",
            str(info["count"]),
            f"${cat_avg:,.2f}",
        )

    console.print(table)

    # Monthly breakdown (only in all-time view)
    if not month and data["monthly_breakdown"]:
        console.print()
        mtable = Table(
            box=box.SIMPLE, show_header=True, header_style="bold dim", title="Monthly Breakdown"
        )
        mtable.add_column("Month")
        mtable.add_column("Total", justify="right")
        mtable.add_column("Dates", justify="center")
        for m in data["monthly_breakdown"]:
            mtable.add_row(m["month"], f"${m['total']:,.2f}", str(m["count"]))
        console.print(mtable)

    console.print()


@spend.command()
@click.option("--output", "-o", default="spending.csv", help="Output file path")
def export(output: str):
    """Export all spending data to CSV."""
    db = SpendingDB()
    count = db.export_csv(Path(output))
    console.print(f"[green]Exported {count} expenses to {output}[/green]")
