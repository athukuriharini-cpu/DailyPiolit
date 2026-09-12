"""
db/seed.py — Populates the database with realistic demo data.
Run once before the first demo: python -m db.seed
"""

from datetime import datetime, timedelta
from db.database import init_db, get_connection


def _today(offset_days: int = 0) -> str:
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


TASKS = [
    # Overdue
    {"title": "Pay gym membership renewal", "category": "health", "due_date": _today(-3), "priority": "high"},
    # Due today
    {"title": "Schedule dentist appointment", "category": "health", "due_date": _today(0), "priority": "medium"},
    {"title": "Respond to HOA newsletter request", "category": "home", "due_date": _today(0), "priority": "low"},
    # Due this week
    {"title": "Renew car insurance", "category": "finance", "due_date": _today(2), "priority": "high"},
    {"title": "Order birthday gift for mom", "category": "family", "due_date": _today(3), "priority": "high"},
    {"title": "Book flight for October trip", "category": "travel", "due_date": _today(4), "priority": "medium"},
    {"title": "Submit expense report", "category": "finance", "due_date": _today(5), "priority": "medium"},
    # Next week
    {"title": "Refill prescription", "category": "health", "due_date": _today(7), "priority": "high"},
    {"title": "Schedule oil change", "category": "errands", "due_date": _today(8), "priority": "low"},
    {"title": "Review monthly budget", "category": "finance", "due_date": _today(10), "priority": "medium"},
    # Low urgency
    {"title": "Clean garage", "category": "home", "due_date": _today(14), "priority": "low"},
    {"title": "Update emergency contact list", "category": "home", "due_date": _today(21), "priority": "low"},
]

BILLS = [
    # Overdue
    {"name": "Water & Sewage", "amount": 47.80, "due_date": _today(-2), "category": "utilities", "is_recurring": 1},
    # Due very soon
    {"name": "Netflix", "amount": 15.99, "due_date": _today(1), "category": "subscriptions", "is_recurring": 1},
    {"name": "Electricity Bill", "amount": 312.50, "due_date": _today(2), "category": "utilities", "is_recurring": 1},  # unusually high — will trigger alert
    # Due this week
    {"name": "Internet (Spectrum)", "amount": 79.99, "due_date": _today(4), "category": "utilities", "is_recurring": 1},
    {"name": "Spotify Family", "amount": 16.99, "due_date": _today(5), "category": "subscriptions", "is_recurring": 1},
    # Next week
    {"name": "Rent / Mortgage", "amount": 1850.00, "due_date": _today(9), "category": "housing", "is_recurring": 1},
    {"name": "Car Loan", "amount": 487.00, "due_date": _today(10), "category": "finance", "is_recurring": 1},
    # Later
    {"name": "Amazon Prime", "amount": 14.99, "due_date": _today(15), "category": "subscriptions", "is_recurring": 1},
    {"name": "Phone Bill (T-Mobile)", "amount": 95.00, "due_date": _today(18), "category": "utilities", "is_recurring": 1},
    {"name": "Health Insurance Premium", "amount": 220.00, "due_date": _today(22), "category": "insurance", "is_recurring": 1},
]


def seed() -> None:
    print("[*] Initializing database...")
    init_db()

    with get_connection() as conn:
        # Clear existing data for a clean demo
        conn.execute("DELETE FROM tasks")
        conn.execute("DELETE FROM bills")
        conn.execute("DELETE FROM alerts")
        conn.execute("DELETE FROM briefings")
        conn.execute("DELETE FROM agent_runs")

        print("[*] Seeding tasks...")
        for t in TASKS:
            conn.execute(
                "INSERT INTO tasks (title, category, due_date, priority) VALUES (?,?,?,?)",
                (t["title"], t["category"], t["due_date"], t["priority"]),
            )

        print("[*] Seeding bills...")
        for b in BILLS:
            conn.execute(
                "INSERT INTO bills (name, amount, due_date, category, is_recurring) VALUES (?,?,?,?,?)",
                (b["name"], b["amount"], b["due_date"], b["category"], b["is_recurring"]),
            )

    print(f"[OK] Seeded {len(TASKS)} tasks and {len(BILLS)} bills.")
    print("[>>] Run `python run.py` to start DailyPilot.")


if __name__ == "__main__":
    seed()
