# Phase 9: Spending Tracker

## Goal

Add a local spending tracker to the Outward CLI so users can log date expenses, view spending analytics, and export data to CSV. All spending data stays on-device in SQLite (`~/.outward/spending.db`). Only aggregate totals will sync to the cloud in Phase 10.

## Architecture

```
agent/outward/spending.py        -- SpendingDB class (SQLite CRUD + analytics queries)
agent/outward/commands/spend.py  -- Click command group (log, summary, export)
agent/outward/cli.py             -- Wire `spend` group into main CLI
```

Database: `~/.outward/spending.db` (SQLite3, stdlib only, no ORM)

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    amount      REAL NOT NULL,
    category    TEXT NOT NULL CHECK(category IN ('dinner','drinks','activity','transport','gift','other')),
    date        TEXT NOT NULL,  -- ISO 8601 date (YYYY-MM-DD)
    notes       TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
```

Schema version starts at 1. Future migrations check `schema_version` and apply ALTER TABLE statements incrementally.

---

## Task 1: SpendingDB class with SQLite schema and CRUD

**Type:** auto

**Files:**
- `agent/outward/spending.py` (create)
- `agent/outward/commands/__init__.py` (create, empty)

**Action:**

Create `agent/outward/spending.py` with class `SpendingDB`:

```python
class SpendingDB:
    def __init__(self, db_path: Path | None = None):
        # Default: ~/.outward/spending.db
        # Creates DB + tables on first use via _migrate()

    def _migrate(self):
        # Check schema_version table, apply migrations up to current
        # Version 1: create expenses table + indexes

    def add_expense(self, amount: float, category: str, date: str, notes: str = "") -> int:
        # Insert row, return id. Validate category in CATEGORIES constant.

    def get_expenses(self, month: str | None = None) -> list[dict]:
        # If month given (YYYY-MM), filter by date LIKE 'YYYY-MM%'
        # Otherwise return all. Return list of dicts.

    def get_summary(self) -> dict:
        # Returns: total_all_time, total_this_month, count_all_time, count_this_month,
        # by_category (dict of category -> total), monthly_breakdown (list of month -> total)

    def get_totals_for_sync(self) -> dict:
        # Returns ONLY aggregate numbers (no notes, no dates, no details)
        # total_spent, expense_count, by_category totals

    def export_csv(self, path: Path) -> int:
        # Write all expenses to CSV (id, amount, category, date, notes, created_at)
        # Return row count

    def delete_expense(self, expense_id: int) -> bool:
        # Delete by id, return True if deleted
```

Constants at module level:
```python
CATEGORIES = ("dinner", "drinks", "activity", "transport", "gift", "other")
DB_PATH = Path.home() / ".outward" / "spending.db"
SCHEMA_VERSION = 1
```

Also create empty `agent/outward/commands/__init__.py` to make it a package.

**Verify:**
```bash
cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "
from outward.spending import SpendingDB
import tempfile, os
db = SpendingDB(db_path=os.path.join(tempfile.mkdtemp(), 'test.db'))
eid = db.add_expense(45.00, 'dinner', '2026-02-14', 'Valentines dinner')
assert eid == 1
expenses = db.get_expenses()
assert len(expenses) == 1
assert expenses[0]['amount'] == 45.0
summary = db.get_summary()
assert summary['total_all_time'] == 45.0
print('ALL TESTS PASSED')
"
```

**Done:** `SpendingDB` class exists, creates SQLite DB on first use, supports add/get/summary/export/delete, migration system works.

---

## Task 2: CLI commands (log, summary, export)

**Type:** auto

**Files:**
- `agent/outward/commands/spend.py` (create)

**Action:**

Create `agent/outward/commands/spend.py` with a Click group and three subcommands:

```python
import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from datetime import date

from outward.spending import SpendingDB, CATEGORIES

console = Console()

@click.group()
def spend():
    """Track date spending and calculate ROI."""
    pass

@spend.command()
@click.option("--amount", "-a", type=float, prompt="Amount ($)", help="Amount spent")
@click.option("--category", "-c", type=click.Choice(CATEGORIES), prompt="Category", help="Expense category")
@click.option("--date", "-d", "expense_date", default=None, help="Date (YYYY-MM-DD, default: today)")
@click.option("--notes", "-n", default="", help="Optional notes")
def log(amount, category, expense_date, notes):
    """Log a date expense."""
    # Default date to today if not provided
    # Call db.add_expense(...)
    # Print confirmation with rich: "[green]Logged $45.00 dinner on 2026-02-14[/green]"

@spend.command()
@click.option("--month", "-m", default=None, help="Filter by month (YYYY-MM)")
def summary(month):
    """Show spending stats and ROI breakdown."""
    # Call db.get_summary()
    # Rich table output (see Task 3 formatting below):
    # - Panel header with total spent
    # - Table: category | total | count | avg per date
    # - Monthly breakdown if all-time
    # - "Cost per date" = total / count

@spend.command()
@click.option("--output", "-o", default="spending.csv", help="Output file path")
def export(output):
    """Export all spending data to CSV."""
    # Call db.export_csv(Path(output))
    # Print "[green]Exported N expenses to spending.csv[/green]"
```

The `summary` command output format:

```
 Spending Summary — February 2026

  Total:  $245.00 across 6 dates
  Avg:    $40.83 per date

  ┌──────────┬─────────┬───────┬─────────┐
  │ Category │  Total  │ Count │ Avg/Date│
  ├──────────┼─────────┼───────┼─────────┤
  │ dinner   │ $120.00 │   3   │  $40.00 │
  │ drinks   │  $65.00 │   4   │  $16.25 │
  │ transport│  $35.00 │   3   │  $11.67 │
  │ gift     │  $25.00 │   1   │  $25.00 │
  └──────────┴─────────┴───────┴─────────┘
```

Use `rich.table.Table` with `box=rich.box.ROUNDED`, style categories with colors:
- dinner: green
- drinks: cyan
- activity: yellow
- transport: blue
- gift: magenta
- other: dim

**Verify:**
```bash
cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "
from outward.commands.spend import spend
from click.testing import CliRunner
runner = CliRunner()

# Test log
result = runner.invoke(spend, ['log', '-a', '50', '-c', 'dinner', '-d', '2026-02-14', '-n', 'test'])
assert result.exit_code == 0, result.output
assert '50' in result.output

# Test summary
result = runner.invoke(spend, ['summary'])
assert result.exit_code == 0, result.output

# Test export
result = runner.invoke(spend, ['export', '-o', '/tmp/test_spend.csv'])
assert result.exit_code == 0, result.output
print('ALL CLI TESTS PASSED')
"
```

**Done:** `outward spend log`, `outward spend summary`, and `outward spend export` all work with rich formatted output.

---

## Task 3: Wire into main CLI

**Type:** auto

**Files:**
- `agent/outward/cli.py` (modify)

**Action:**

Add the spend command group to the main CLI. Add these lines to `cli.py`:

1. Import the spend group:
   ```python
   from outward.commands.spend import spend
   ```

2. Register it with the main group (after the existing command definitions):
   ```python
   main.add_command(spend)
   ```

This makes `outward spend log`, `outward spend summary`, `outward spend export` available.

**Verify:**
```bash
cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "
from outward.cli import main
from click.testing import CliRunner
runner = CliRunner()
result = runner.invoke(main, ['spend', '--help'])
assert result.exit_code == 0
assert 'log' in result.output
assert 'summary' in result.output
assert 'export' in result.output
print('WIRING TEST PASSED')
"
```

**Done:** `outward spend --help` shows log/summary/export subcommands.

---

## Dependency Order

```
Task 1 (SpendingDB) ──→ Task 2 (CLI commands) ──→ Task 3 (Wire into CLI)
```

All three are sequential. Task 2 imports from Task 1. Task 3 imports from Task 2.

## Acceptance Criteria

- [ ] `outward spend log -a 50 -c dinner -d 2026-02-14` creates `~/.outward/spending.db` and inserts row
- [ ] `outward spend log` with no flags prompts interactively for amount, category
- [ ] `outward spend summary` shows rich-formatted table with totals and per-category breakdown
- [ ] `outward spend summary -m 2026-02` filters to that month
- [ ] `outward spend export -o dates.csv` writes valid CSV with all expenses
- [ ] SQLite DB uses migration system (schema_version table) for future upgrades
- [ ] `SpendingDB.get_totals_for_sync()` returns only aggregates (no personal details) for Phase 10
- [ ] All spending data stays local in `~/.outward/spending.db` — nothing leaves the machine
