"""
DailyPilot — Core Strands Agent
Orchestrates all tools to autonomously manage daily tasks and bills.
"""

import os
import sys
import json
import logging
from strands import Agent

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

logger = logging.getLogger("dailypilot.agent")

try:
    from agent.tools import (
        scan_pending_tasks,
        scan_pending_bills,
        send_reminder,
        rank_tasks_by_priority,
        escalate_decision,
        generate_daily_briefing,
    )
except ImportError:
    from tools import (
        scan_pending_tasks,
        scan_pending_bills,
        send_reminder,
        rank_tasks_by_priority,
        escalate_decision,
        generate_daily_briefing,
    )

# ── System prompt ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are DailyPilot, an autonomous AI agent that manages daily tasks,
bills, and reminders on behalf of the user. You run quietly in the background and only
surface items that genuinely require a human decision.

Your workflow every time you run:
1. Call scan_pending_tasks() to see what's pending.
2. Call scan_pending_bills() to see upcoming bills and any anomalies.
3. Call rank_tasks_by_priority() to reorder tasks by computed urgency.
4. For EACH task that is overdue or due today:
   - If it's a routine reminder (pay a known bill, schedule a standard appointment):
     call send_reminder() to mark it handled.
   - If it requires real judgment (unusual charge, medical decision, travel booking):
     call escalate_decision() with severity 'high' or 'critical'.
5. For EACH bill anomaly returned by scan_pending_bills():
   - Always call escalate_decision() — unusual bills need human eyes.
6. For bills due within 2 days that are NOT anomalies:
   - Call send_reminder() with a friendly payment reminder.
7. Finally, call generate_daily_briefing() with a summary paragraph of what you found
   and what you handled.

Rules:
- Be autonomous. Don't ask the user for input — act.
- Prefer send_reminder() for routine items. Reserve escalate_decision() for genuine anomalies.
- Always call generate_daily_briefing() as your last action.
- Be concise and factual in descriptions. The user trusts you to handle the routine.
"""


def create_agent() -> Agent:
    """Create and return the configured DailyPilot Strands agent."""
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[
            scan_pending_tasks,
            scan_pending_bills,
            send_reminder,
            rank_tasks_by_priority,
            escalate_decision,
            generate_daily_briefing,
        ],
    )


def _run_deterministic_agent_cycle() -> str:
    """
    Autonomous fallback cycle executed directly using the exact same tools and logic.
    Used if AWS credentials are not set or Bedrock is unreachable, guaranteeing
    that local evaluation and demos always run smoothly.
    """
    logger.info("[Agent] Executing autonomous cycle using registered Strands tools...")
    tasks_raw = json.loads(scan_pending_tasks())
    bills_raw = json.loads(scan_pending_bills())
    ranked_raw = json.loads(rank_tasks_by_priority())

    reminders_sent = 0
    escalations_raised = 0

    # 1. Handle overdue & due today tasks
    for task in tasks_raw.get("overdue", []) + tasks_raw.get("due_today", []):
        cat = task.get("category", "")
        if cat in ("health", "home", "errands", "utilities"):
            send_reminder("task", task["id"], task["title"], f"Urgent reminder for {task['title']}")
            reminders_sent += 1
        else:
            escalate_decision(
                title=f"Action Required: {task['title']}",
                description=f"Task is urgent/overdue ({task.get('category')} category).",
                severity="high",
                source_type="task",
                source_id=task["id"],
                recommended_action="Review and take immediate action on this task."
            )
            escalations_raised += 1

    # 2. Handle bill anomalies
    for anomaly in bills_raw.get("anomalies", []):
        escalate_decision(
            title=f"Unusual Bill: {anomaly['name']} (${anomaly['amount']:.2f})",
            description=f"Amount is ${anomaly['excess_amount']:.2f} higher than typical threshold (${anomaly['normal_threshold']:.2f}).",
            severity="critical",
            source_type="bill",
            source_id=anomaly["bill_id"],
            recommended_action="Inspect statement for unexpected fees or billing errors before paying."
        )
        escalations_raised += 1

    # 3. Handle routine bills due soon
    for bill in bills_raw.get("due_soon", []):
        if not bill.get("is_anomaly"):
            send_reminder("bill", bill["id"], bill["name"], f"Upcoming payment: ${bill['amount']:.2f} due on {bill['due_date']}")
            reminders_sent += 1

    total_handled = reminders_sent + escalations_raised
    summary_text = (
        f"DailyPilot completed background audit. Discovered {len(bills_raw.get('anomalies', []))} anomalous bill(s) "
        f"and {len(tasks_raw.get('overdue', []))} overdue task(s). Dispatched {reminders_sent} routine reminders "
        f"and escalated {escalations_raised} decision items requiring personal review."
    )

    briefing_raw = json.loads(generate_daily_briefing(
        tasks_handled=total_handled,
        reminders_sent=reminders_sent,
        escalations_raised=escalations_raised,
        agent_summary=summary_text
    ))

    return briefing_raw.get("content", summary_text)


def run_agent() -> str:
    """
    Run the DailyPilot agent through one full cycle.
    Attempts Amazon Bedrock via Strands Agent, and seamlessly falls back
    to deterministic tool cycle if AWS Bedrock credentials are unavailable.
    """
    # Check if AWS credentials exist
    has_aws = bool(
        (os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"))
        or os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    )

    if not has_aws:
        logger.info("[Agent] No AWS Bedrock credentials detected in environment. Running autonomous fallback agent cycle.")
        return _run_deterministic_agent_cycle()

    try:
        agent = create_agent()
        result = agent(
            "Run your full daily management cycle now. "
            "Scan tasks and bills, rank priorities, handle routine items autonomously, "
            "escalate anything that needs human attention, then generate today's briefing."
        )
        return str(result)
    except Exception as e:
        logger.warning(f"[Agent] Bedrock invocation error ({e}). Falling back to local autonomous execution.")
        return _run_deterministic_agent_cycle()


if __name__ == "__main__":
    print("[*] DailyPilot agent running...")
    output = run_agent()
    print(output)

