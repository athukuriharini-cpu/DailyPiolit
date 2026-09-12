"""
Tool: scan_pending_tasks
Reads all pending tasks from the database and returns a structured summary.
The Strands agent uses this to understand what needs attention today.
"""

import json
from datetime import datetime, date
from strands import tool
from db.database import get_pending_tasks


def _days_until(due_date_str: str | None) -> int | None:
    """Return how many days until a due date (negative = overdue)."""
    if not due_date_str:
        return None
    try:
        due = datetime.strptime(due_date_str, "%Y-%m-%d").date()
        return (due - date.today()).days
    except ValueError:
        return None


@tool
def scan_pending_tasks() -> str:
    """
    Scan the task database and return all pending tasks with urgency context.

    Returns a JSON string with:
    - total_count: number of pending tasks
    - overdue: list of tasks past their due date
    - due_today: list of tasks due today
    - due_this_week: list of tasks due within 7 days
    - upcoming: list of tasks due after 7 days or with no date

    Use this tool first to understand the current task landscape.
    """
    tasks = get_pending_tasks()

    overdue, due_today, due_this_week, upcoming = [], [], [], []

    for t in tasks:
        days = _days_until(t.get("due_date"))
        enriched = {**t, "days_until_due": days}

        if days is None:
            upcoming.append(enriched)
        elif days < 0:
            enriched["overdue_by_days"] = abs(days)
            overdue.append(enriched)
        elif days == 0:
            due_today.append(enriched)
        elif days <= 7:
            due_this_week.append(enriched)
        else:
            upcoming.append(enriched)

    result = {
        "total_count": len(tasks),
        "overdue": overdue,
        "due_today": due_today,
        "due_this_week": due_this_week,
        "upcoming": upcoming,
        "scanned_at": datetime.now().isoformat(),
    }
    return json.dumps(result, default=str)
