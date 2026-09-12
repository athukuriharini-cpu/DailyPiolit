"""
Tool: send_reminder
Marks a task or bill reminder as sent and logs it to the alerts table.
In production this would integrate with email/SMS/push; here it logs to DB.
"""

import json
from datetime import datetime
from strands import tool
from db.database import add_alert, update_task_status


@tool
def send_reminder(item_type: str, item_id: int, item_title: str, message: str) -> str:
    """
    Send (log) a reminder for a task or bill and mark it as 'reminded' in the database.

    Args:
        item_type: Either 'task' or 'bill'
        item_id: The database ID of the task or bill
        item_title: Human-readable name of the item
        message: The reminder message to log (what you would send to the user)

    Returns:
        JSON confirmation with reminder_id and timestamp.

    Use this for routine reminders that don't require a human decision.
    For items that need a human decision, use escalate_decision instead.
    """
    if item_type not in ("task", "bill"):
        return json.dumps({"error": "item_type must be 'task' or 'bill'"})

    # Log the reminder as a low-severity info alert
    alert_id = add_alert(
        type_="reminder",
        title=f"Reminder: {item_title}",
        description=message,
        severity="low",
        source_id=item_id,
        source_type=item_type,
    )

    # For tasks, update their status to 'reminded'
    if item_type == "task":
        update_task_status(item_id, "reminded", f"Reminder sent: {message}")

    return json.dumps({
        "success": True,
        "alert_id": alert_id,
        "item_type": item_type,
        "item_id": item_id,
        "item_title": item_title,
        "sent_at": datetime.now().isoformat(),
        "channel": "dashboard",  # In production: email/SMS/push
    })
