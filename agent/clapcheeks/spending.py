"""Local spending tracker — SQLite-backed expense logging and analytics."""
from __future__ import annotations

import csv
import sqlite3
from datetime import date, datetime
from pathlib import Path

CATEGORIES = ("dinner", "drinks", "activity", "transport", "gift", "other")
DB_PATH = Path.home() / ".clapcheeks" / "spending.db"
SCHEMA_VERSION = 1


class SpendingDB:
    """SQLite CRUD + analytics for date-night expenses."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = Path(db_path) if db_path else DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    # ------------------------------------------------------------------
    # Schema migrations
    # ------------------------------------------------------------------

    def _migrate(self):
        cur = self._conn.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
        )
        row = cur.execute(
            "SELECT MAX(version) AS v FROM schema_version"
        ).fetchone()
        current = row["v"] if row["v"] is not None else 0

        if current < 1:
            cur.executescript("""
                CREATE TABLE IF NOT EXISTS expenses (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    amount      REAL NOT NULL,
                    category    TEXT NOT NULL,
                    date        TEXT NOT NULL,
                    notes       TEXT DEFAULT '',
                    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
                CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
                INSERT INTO schema_version (version) VALUES (1);
            """)

        self._conn.commit()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add_expense(self, amount: float, category: str, date: str, notes: str = "") -> int:
        if category not in CATEGORIES:
            raise ValueError(f"Invalid category '{category}'. Must be one of {CATEGORIES}")
        cur = self._conn.execute(
            "INSERT INTO expenses (amount, category, date, notes) VALUES (?, ?, ?, ?)",
            (amount, category, date, notes),
        )
        self._conn.commit()
        return cur.lastrowid

    def get_expenses(self, month: str | None = None) -> list[dict]:
        if month:
            rows = self._conn.execute(
                "SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC",
                (f"{month}%",),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM expenses ORDER BY date DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_summary(self) -> dict:
        cur = self._conn.cursor()

        # All-time totals
        row = cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM expenses"
        ).fetchone()
        total_all_time = row["total"]
        count_all_time = row["cnt"]

        # This month
        this_month = date.today().strftime("%Y-%m")
        row = cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt "
            "FROM expenses WHERE date LIKE ?",
            (f"{this_month}%",),
        ).fetchone()
        total_this_month = row["total"]
        count_this_month = row["cnt"]

        # By category
        by_category = {}
        for r in cur.execute(
            "SELECT category, SUM(amount) AS total, COUNT(*) AS cnt "
            "FROM expenses GROUP BY category ORDER BY total DESC"
        ).fetchall():
            by_category[r["category"]] = {"total": r["total"], "count": r["cnt"]}

        # Monthly breakdown
        monthly_breakdown = []
        for r in cur.execute(
            "SELECT SUBSTR(date, 1, 7) AS month, SUM(amount) AS total, COUNT(*) AS cnt "
            "FROM expenses GROUP BY month ORDER BY month DESC"
        ).fetchall():
            monthly_breakdown.append(
                {"month": r["month"], "total": r["total"], "count": r["cnt"]}
            )

        return {
            "total_all_time": total_all_time,
            "total_this_month": total_this_month,
            "count_all_time": count_all_time,
            "count_this_month": count_this_month,
            "by_category": by_category,
            "monthly_breakdown": monthly_breakdown,
        }

    def get_totals_for_sync(self) -> dict:
        """Return only aggregate numbers — no notes, dates, or personal details."""
        cur = self._conn.cursor()
        row = cur.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM expenses"
        ).fetchone()

        by_category = {}
        for r in cur.execute(
            "SELECT category, SUM(amount) AS total FROM expenses GROUP BY category"
        ).fetchall():
            by_category[r["category"]] = r["total"]

        return {
            "total_spent": row["total"],
            "expense_count": row["cnt"],
            "by_category": by_category,
        }

    def export_csv(self, path: Path) -> int:
        rows = self._conn.execute(
            "SELECT id, amount, category, date, notes, created_at FROM expenses ORDER BY date"
        ).fetchall()
        path = Path(path)
        with open(path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "amount", "category", "date", "notes", "created_at"])
            for r in rows:
                writer.writerow([r["id"], r["amount"], r["category"], r["date"], r["notes"], r["created_at"]])
        return len(rows)

    def delete_expense(self, expense_id: int) -> bool:
        cur = self._conn.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
        self._conn.commit()
        return cur.rowcount > 0
