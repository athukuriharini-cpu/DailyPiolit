"""
Tool: generate_daily_briefing
Produces a human-readable Markdown daily briefing and saves it to the database.
This is the final tool the agent calls — the summary of everything it did.
"""

import json
from datetime import datetime
from strands import tool
from db.database import save_briefing, get_open_alerts, get_all_tasks, get_pending_bills


@tool
def generate_daily_briefing(
    tasks_handled: int,
    reminders_sent: int,
    escalations_raised: int,
    agent_summary: str,
) -> str:
    """
    Generate a Markdown daily briefing summarizing all agent actions taken this run.
    Saves the briefing to the database and returns it as a string.

    Args:
        tasks_handled: How many tasks were autonomously handled (reminded/completed)
        reminders_sent: How many reminders were sent
        escalations_raised: How many items were escalated to the human
        agent_summary: A paragraph written by the agent summarizing key findings

    Returns:
        JSON with briefing_id and the full Markdown content of the briefing.

    Always call this tool last, after all other tools have run.
    """
    now = datetime.now()
    date_str = now.strftime("%A, %B %d %Y")
    time_str = now.strftime("%I:%M %p")

    # Pull live counts for the briefing
    open_alerts = get_open_alerts()
    all_tasks = get_all_tasks()
    pending_bills = get_pending_bills()

    pending_count = sum(1 for t in all_tasks if t["status"] == "pending")
    reminded_count = sum(1 for t in all_tasks if t["status"] == "reminded")
    critical_alerts = [a for a in open_alerts if a["severity"] in ("high", "critical")]

    bill_total = sum(b["amount"] for b in pending_bills)

    briefing_md = f"""# 🧭 DailyPilot Briefing
**{date_str}** · Generated at {time_str}

---

## ✅ What I Did This Run

| Action | Count |
|--------|-------|
| Tasks processed | {tasks_handled} |
| Reminders sent | {reminders_sent} |
| Items escalated to you | {escalations_raised} |

{agent_summary}

---

## 🚨 Needs Your Attention ({len(critical_alerts)} item{'s' if len(critical_alerts) != 1 else ''})

"""

    if critical_alerts:
        for a in critical_alerts:
            severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(a["severity"], "⚪")
            briefing_md += f"- {severity_emoji} **{a['title']}**\n  {a['description'].splitlines()[0]}\n\n"
    else:
        briefing_md += "_No critical items — you're all clear! ✨_\n\n"

    briefing_md += f"""---

## 📋 Task Overview

- **Pending tasks:** {pending_count}
- **Tasks reminded:** {reminded_count}
- **Open alerts:** {len(open_alerts)}

---

## 💳 Bills Summary

- **Pending bills:** {len(pending_bills)}
- **Total amount due:** ${bill_total:,.2f}

---

_DailyPilot ran autonomously · Powered by [Strands Agents SDK](https://strandsagents.com) + Amazon Bedrock_
"""

    briefing_id = save_briefing(
        content=briefing_md,
        tasks_handled=tasks_handled,
        alerts_raised=escalations_raised,
    )

    return json.dumps({
        "briefing_id": briefing_id,
        "content": briefing_md,
        "generated_at": now.isoformat(),
    })
