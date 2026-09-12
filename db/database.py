"""
DailyPilot — Database layer
SQLite schema and helper functions for tasks, bills, alerts, and briefings.
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "dailypilot.db"


def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with row_factory set to dict-like rows."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create all tables if they don't already exist."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT 'general',
                due_date    TEXT,
                priority    TEXT NOT NULL DEFAULT 'medium',
                status      TEXT NOT NULL DEFAULT 'pending',
                notes       TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS bills (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL,
                amount       REAL NOT NULL,
                due_date     TEXT NOT NULL,
                category     TEXT NOT NULL DEFAULT 'utilities',
                status       TEXT NOT NULL DEFAULT 'pending',
                is_recurring INTEGER NOT NULL DEFAULT 1,
                notes        TEXT,
                created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                type        TEXT NOT NULL,
                title       TEXT NOT NULL,
                description TEXT NOT NULL,
                severity    TEXT NOT NULL DEFAULT 'medium',
                resolved    INTEGER NOT NULL DEFAULT 0,
                source_id   INTEGER,
                source_type TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS briefings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                content     TEXT NOT NULL,
                tasks_handled INTEGER NOT NULL DEFAULT 0,
                alerts_raised INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS agent_runs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                status      TEXT NOT NULL DEFAULT 'running',
                started_at  TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at TEXT,
                summary     TEXT
            );
        """)


# ── Task helpers ──────────────────────────────────────────────────────────────

# ── Full CRUD Task helpers ───────────────────────────────────────────────────

def get_pending_tasks() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY due_date ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_tasks() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_task(task_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return dict(row) if row else None


def update_task_status(task_id: int, status: str, notes: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE tasks SET status=?, notes=?, updated_at=datetime('now') WHERE id=?",
            (status, notes, task_id),
        )


def update_task_priority(task_id: int, priority: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE tasks SET priority=?, updated_at=datetime('now') WHERE id=?",
            (priority, task_id),
        )


def add_task(title: str, category: str = "general", due_date: str = None, priority: str = "medium", notes: str = "") -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (title, category, due_date, priority, notes) VALUES (?,?,?,?,?)",
            (title, category, due_date, priority, notes),
        )
        return cur.lastrowid


def update_task(task_id: int, title: str, category: str, due_date: str = None, priority: str = "medium", status: str = "pending", notes: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE tasks SET title=?, category=?, due_date=?, priority=?, status=?, notes=?, updated_at=datetime('now')
               WHERE id=?""",
            (title, category, due_date, priority, status, notes, task_id),
        )


def delete_task(task_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))


# ── Full CRUD Bill helpers ───────────────────────────────────────────────────

def get_pending_bills() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM bills WHERE status = 'pending' ORDER BY due_date ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_bills() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM bills ORDER BY due_date ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_bill(bill_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
    return dict(row) if row else None


def add_bill(name: str, amount: float, due_date: str, category: str = "utilities", is_recurring: int = 1, notes: str = "") -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO bills (name, amount, due_date, category, is_recurring, notes) VALUES (?,?,?,?,?,?)",
            (name, amount, due_date, category, is_recurring, notes),
        )
        return cur.lastrowid


def update_bill(bill_id: int, name: str, amount: float, due_date: str, category: str = "utilities", status: str = "pending", is_recurring: int = 1, notes: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE bills SET name=?, amount=?, due_date=?, category=?, status=?, is_recurring=?, notes=?, updated_at=datetime('now')
               WHERE id=?""",
            (name, amount, due_date, category, status, is_recurring, notes, bill_id),
        )


def update_bill_status(bill_id: int, status: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE bills SET status=?, updated_at=datetime('now') WHERE id=?",
            (status, bill_id),
        )


def delete_bill(bill_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM bills WHERE id=?", (bill_id,))


# ── Alert helpers ─────────────────────────────────────────────────────────────

def add_alert(type_: str, title: str, description: str, severity: str = "medium",
              source_id: int = None, source_type: str = None) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO alerts (type, title, description, severity, source_id, source_type)
               VALUES (?,?,?,?,?,?)""",
            (type_, title, description, severity, source_id, source_type),
        )
        return cur.lastrowid


def get_open_alerts() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM alerts WHERE resolved=0 ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_all_alerts() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


def resolve_alert(alert_id: int) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE alerts SET resolved=1 WHERE id=?", (alert_id,))


def delete_alert(alert_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM alerts WHERE id=?", (alert_id,))


# ── Briefing helpers ──────────────────────────────────────────────────────────

def save_briefing(content: str, tasks_handled: int, alerts_raised: int) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO briefings (content, tasks_handled, alerts_raised) VALUES (?,?,?)",
            (content, tasks_handled, alerts_raised),
        )
        return cur.lastrowid


def get_latest_briefing() -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def get_all_briefings() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM briefings ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
    return [dict(r) for r in rows]


# ── Agent run helpers ─────────────────────────────────────────────────────────

def start_agent_run() -> int:
    with get_connection() as conn:
        cur = conn.execute("INSERT INTO agent_runs (status) VALUES ('running')")
        return cur.lastrowid


def finish_agent_run(run_id: int, summary: str, status: str = "success") -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE agent_runs SET status=?, finished_at=datetime('now'), summary=? WHERE id=?",
            (status, summary, run_id),
        )


def get_last_agent_run() -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def clear_all_data() -> None:
    """Clear all records for a clean slate."""
    with get_connection() as conn:
        conn.execute("DELETE FROM tasks")
        conn.execute("DELETE FROM bills")
        conn.execute("DELETE FROM alerts")
        conn.execute("DELETE FROM briefings")
        conn.execute("DELETE FROM agent_runs")

