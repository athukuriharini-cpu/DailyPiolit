"""
Tool: escalate_decision
Creates a high-priority alert for items that require a human decision.
The agent uses this when it encounters something it cannot handle autonomously:
unusual charges, scheduling conflicts, new recurring bills above threshold, etc.
"""

import json
from datetime import datetime
from strands import tool
from db.database import add_alert


VALID_SEVERITIES = {"low", "medium", "high", "critical"}


@tool
def escalate_decision(
    title: str,
    description: str,
    severity: str,
    source_type: str,
    source_id: int,
    recommended_action: str,
) -> str:
    """
    Escalate an item to the human for a decision and create a high-priority alert.

    Use this when:
    - A bill amount is unusually high (>150% of normal for its category)
    - A task requires real judgment (booking flights, medical decisions)
    - There is a scheduling conflict
    - Something doesn't match expected patterns

    Do NOT use this for routine reminders — use send_reminder for those.

    Args:
        title: Short title for the alert (e.g. "Electricity Bill 2.5x Higher Than Normal")
        description: Full context explaining WHY this needs human attention
        severity: One of 'low', 'medium', 'high', 'critical'
        source_type: 'task' or 'bill'
        source_id: Database ID of the source item
        recommended_action: What the agent suggests the human should do

    Returns:
        JSON with alert_id and confirmation.
    """
    if severity not in VALID_SEVERITIES:
        severity = "medium"

    full_description = f"{description}\n\n💡 Recommended action: {recommended_action}"

    alert_id = add_alert(
        type_="escalation",
        title=title,
        description=full_description,
        severity=severity,
        source_id=source_id,
        source_type=source_type,
    )

    return json.dumps({
        "escalated": True,
        "alert_id": alert_id,
        "title": title,
        "severity": severity,
        "escalated_at": datetime.now().isoformat(),
        "message": "Alert created — human review required.",
    })
