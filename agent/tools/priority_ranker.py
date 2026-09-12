"""
Tool: rank_tasks_by_priority
Analyzes pending tasks and re-ranks them by computed urgency score,
then updates the priority field in the database accordingly.
"""

import json
from datetime import datetime, date
from strands import tool
from db.database import get_pending_tasks, update_task_priority


PRIORITY_WEIGHTS = {
    "high":   3,
    "medium": 2,
    "low":    1,
}

CATEGORY_URGENCY = {
    "health":   1.5,
    "finance":  1.4,
    "family":   1.3,
    "home":     1.1,
    "errands":  1.0,
    "travel":   1.0,
    "general":  1.0,
}


def _urgency_score(task: dict) -> float:
    """Compute a numeric urgency score. Higher = more urgent."""
    base = PRIORITY_WEIGHTS.get(task.get("priority", "medium"), 2)
    category_mult = CATEGORY_URGENCY.get(task.get("category", "general"), 1.0)

    due_str = task.get("due_date")
    if due_str:
        try:
            days = (datetime.strptime(due_str, "%Y-%m-%d").date() - date.today()).days
        except ValueError:
            days = 30
    else:
        days = 30

    # Overdue tasks get maximum urgency boost
    if days < 0:
        time_mult = 5.0
    elif days == 0:
        time_mult = 3.0
    elif days <= 3:
        time_mult = 2.0
    elif days <= 7:
        time_mult = 1.5
    elif days <= 14:
        time_mult = 1.1
    else:
        time_mult = 1.0

    return round(base * category_mult * time_mult, 2)


def _score_to_priority(score: float) -> str:
    if score >= 6.0:
        return "critical"
    elif score >= 3.0:
        return "high"
    elif score >= 1.5:
        return "medium"
    else:
        return "low"


@tool
def rank_tasks_by_priority() -> str:
    """
    Compute urgency scores for all pending tasks, re-rank them, and update the database.

    Urgency scoring considers:
    - Original priority label (high/medium/low)
    - Task category (health/finance tasks score higher)
    - Days until due (overdue = 5x multiplier, due today = 3x)

    Returns a JSON list of tasks sorted by urgency score descending,
    with their computed score and updated priority label.

    Call this tool after scan_pending_tasks to establish the action order.
    """
    tasks = get_pending_tasks()

    ranked = []
    for t in tasks:
        score = _urgency_score(t)
        new_priority = _score_to_priority(score)

        # Update DB if priority changed
        if new_priority != t.get("priority"):
            update_task_priority(t["id"], new_priority)

        ranked.append({
            "id": t["id"],
            "title": t["title"],
            "category": t["category"],
            "due_date": t.get("due_date"),
            "urgency_score": score,
            "priority": new_priority,
            "old_priority": t.get("priority"),
        })

    ranked.sort(key=lambda x: x["urgency_score"], reverse=True)

    return json.dumps({
        "ranked_count": len(ranked),
        "tasks": ranked,
        "ranked_at": datetime.now().isoformat(),
    }, default=str)
