"""
DailyPilot — Database layer
SQLite local storage with multi-user isolation.
Strict rule: Zero dummy data. The database starts 100% empty until the user adds their own items.
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "dailypilot.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create clean empty tables. NEVER inserts dummy or seed data."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL DEFAULT 'default_user',
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
                user_id      TEXT NOT NULL DEFAULT 'default_user',
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
                user_id     TEXT NOT NULL DEFAULT 'default_user',
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
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       TEXT NOT NULL DEFAULT 'default_user',
                content       TEXT NOT NULL,
                tasks_handled INTEGER NOT NULL DEFAULT 0,
                alerts_raised INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS agent_runs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL DEFAULT 'default_user',
                status      TEXT NOT NULL DEFAULT 'running',
                started_at  TEXT NOT NULL DEFAULT (datetime('now')),
                finished_at TEXT,
                summary     TEXT
            );
        """)


# ── Tasks ─────────────────────────────────────────────────────────────────────

def get_user_tasks(user_id: str = "default_user", status: str = None) -> list[dict]:
    with get_connection() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE user_id=? AND status=? ORDER BY created_at DESC",
                (user_id, status),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def add_user_task(user_id: str, title: str, category: str = "general", due_date: str = None, priority: str = "medium", notes: str = "") -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (user_id, title, category, due_date, priority, notes) VALUES (?,?,?,?,?,?)",
            (user_id, title, category, due_date, priority, notes),
        )
        return cur.lastrowid


def update_user_task(task_id: int, user_id: str, title: str, category: str, due_date: str = None, priority: str = "medium", status: str = "pending", notes: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE tasks SET title=?, category=?, due_date=?, priority=?, status=?, notes=?, updated_at=datetime('now')
               WHERE id=? AND user_id=?""",
            (title, category, due_date, priority, status, notes, task_id, user_id),
        )


def delete_user_task(task_id: int, user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))


# ── Bills ─────────────────────────────────────────────────────────────────────

def get_user_bills(user_id: str = "default_user", status: str = None) -> list[dict]:
    with get_connection() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM bills WHERE user_id=? AND status=? ORDER BY due_date ASC",
                (user_id, status),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM bills WHERE user_id=? ORDER BY due_date ASC",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def add_user_bill(user_id: str, name: str, amount: float, due_date: str, category: str = "utilities", is_recurring: int = 1, notes: str = "") -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO bills (user_id, name, amount, due_date, category, is_recurring, notes) VALUES (?,?,?,?,?,?,?)",
            (user_id, name, amount, due_date, category, is_recurring, notes),
        )
        return cur.lastrowid


def update_user_bill(bill_id: int, user_id: str, name: str, amount: float, due_date: str, category: str = "utilities", status: str = "pending", is_recurring: int = 1, notes: str = "") -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE bills SET name=?, amount=?, due_date=?, category=?, status=?, is_recurring=?, notes=?, updated_at=datetime('now')
               WHERE id=? AND user_id=?""",
            (name, amount, due_date, category, status, is_recurring, notes, bill_id, user_id),
        )


def delete_user_bill(bill_id: int, user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM bills WHERE id=? AND user_id=?", (bill_id, user_id))


# ── Alerts ────────────────────────────────────────────────────────────────────

def get_user_alerts(user_id: str = "default_user", open_only: bool = False) -> list[dict]:
    with get_connection() as conn:
        if open_only:
            rows = conn.execute(
                "SELECT * FROM alerts WHERE user_id=? AND resolved=0 ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def add_user_alert(user_id: str, type_: str, title: str, description: str, severity: str = "medium", source_id: int = None, source_type: str = None) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO alerts (user_id, type, title, description, severity, source_id, source_type)
               VALUES (?,?,?,?,?,?,?)""",
            (user_id, type_, title, description, severity, source_id, source_type),
        )
        return cur.lastrowid


def resolve_user_alert(alert_id: int, user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE alerts SET resolved=1 WHERE id=? AND user_id=?", (alert_id, user_id))


def delete_user_alert(alert_id: int, user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM alerts WHERE id=? AND user_id=?", (alert_id, user_id))


# ── Briefings ─────────────────────────────────────────────────────────────────

def save_user_briefing(user_id: str, content: str, tasks_handled: int, alerts_raised: int) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO briefings (user_id, content, tasks_handled, alerts_raised) VALUES (?,?,?,?)",
            (user_id, content, tasks_handled, alerts_raised),
        )
        return cur.lastrowid


def get_latest_user_briefing(user_id: str = "default_user") -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM briefings WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


# ── Compatibility aliases for Strands tools ───────────────────────────────────

def get_pending_tasks(user_id: str = "default_user") -> list[dict]:
    return get_user_tasks(user_id=user_id, status="pending")

def get_all_tasks(user_id: str = "default_user") -> list[dict]:
    return get_user_tasks(user_id=user_id)

def get_pending_bills(user_id: str = "default_user") -> list[dict]:
    return get_user_bills(user_id=user_id, status="pending")

def get_all_bills(user_id: str = "default_user") -> list[dict]:
    return get_user_bills(user_id=user_id)

def add_task(title: str, category: str = "general", due_date: str = None, priority: str = "medium", notes: str = "", user_id: str = "default_user") -> int:
    return add_user_task(user_id=user_id, title=title, category=category, due_date=due_date, priority=priority, notes=notes)

def update_task_status(task_id: int, status: str, notes: str = "", user_id: str = "default_user") -> None:
    task = None
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if row:
            task = dict(row)
    if task:
        update_user_task(task_id, task.get("user_id", user_id), task["title"], task["category"], task["due_date"], task["priority"], status, notes)

def update_task_priority(task_id: int, priority: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE tasks SET priority=?, updated_at=datetime('now') WHERE id=?", (priority, task_id))

def add_alert(type_: str, title: str, description: str, severity: str = "medium", source_id: int = None, source_type: str = None, user_id: str = "default_user") -> int:
    return add_user_alert(user_id, type_, title, description, severity, source_id, source_type)

def get_open_alerts(user_id: str = "default_user") -> list[dict]:
    return get_user_alerts(user_id=user_id, open_only=True)

def save_briefing(content: str, tasks_handled: int, alerts_raised: int, user_id: str = "default_user") -> int:
    return save_user_briefing(user_id, content, tasks_handled, alerts_raised)

def get_latest_briefing(user_id: str = "default_user") -> dict | None:
    return get_latest_user_briefing(user_id)



def start_user_agent_run(user_id: str = "default_user") -> int:
    with get_connection() as conn:
        cur = conn.execute("INSERT INTO agent_runs (user_id, status) VALUES (?, 'running')", (user_id,))
        return cur.lastrowid

def finish_user_agent_run(run_id: int, summary: str, status: str = "success") -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE agent_runs SET status=?, finished_at=datetime('now'), summary=? WHERE id=?",
            (status, summary, run_id),
        )

def get_last_user_agent_run(user_id: str = "default_user") -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM agent_runs WHERE user_id=? ORDER BY started_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None

def start_agent_run(user_id: str = "default_user") -> int:
    return start_user_agent_run(user_id)

def finish_agent_run(run_id: int, summary: str, status: str = "success") -> None:
    return finish_user_agent_run(run_id, summary, status)

def get_last_agent_run(user_id: str = "default_user") -> dict | None:
    return get_last_user_agent_run(user_id)


def wipe_user_data(user_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM tasks WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM bills WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM alerts WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM briefings WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM agent_runs WHERE user_id=?", (user_id,))
