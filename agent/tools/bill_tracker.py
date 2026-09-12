"""
Tool: scan_pending_bills
Reads all pending bills from the database and flags anomalies.
Typical monthly amounts are compared to detect unusually high bills.
"""

import json
from datetime import datetime, date
from strands import tool
from db.database import get_pending_bills

# Rough "normal" thresholds per category for anomaly detection
NORMAL_AMOUNT_THRESHOLDS: dict[str, float] = {
    "utilities":     200.0,
    "subscriptions":  30.0,
    "housing":      2500.0,
    "finance":       600.0,
    "insurance":     400.0,
    "general":       150.0,
}


def _days_until(due_date_str: str) -> int:
    try:
        due = datetime.strptime(due_date_str, "%Y-%m-%d").date()
        return (due - date.today()).days
    except ValueError:
        return 999


@tool
def scan_pending_bills() -> str:
    """
    Scan the bills database and return all pending bills with urgency and anomaly flags.

    Returns a JSON string with:
    - total_count: total pending bill count
    - total_amount_due: sum of all pending amounts
    - overdue: bills past their due date
    - due_soon: bills due within 5 days
    - upcoming: bills due after 5 days
    - anomalies: bills with amounts unusually higher than typical for their category

    Use this tool to understand upcoming financial obligations and flag unusual charges.
    """
    bills = get_pending_bills()

    overdue, due_soon, upcoming, anomalies = [], [], [], []
    total_amount = 0.0

    for b in bills:
        days = _days_until(b["due_date"])
        threshold = NORMAL_AMOUNT_THRESHOLDS.get(b.get("category", "general"), 150.0)
        is_anomaly = b["amount"] > threshold * 1.5  # 50% above normal = flag
        enriched = {**b, "days_until_due": days, "is_anomaly": is_anomaly}
        total_amount += b["amount"]

        if is_anomaly:
            anomalies.append({
                "bill_id": b["id"],
                "name": b["name"],
                "amount": b["amount"],
                "category": b["category"],
                "normal_threshold": threshold,
                "excess_amount": round(b["amount"] - threshold, 2),
            })

        if days < 0:
            overdue.append(enriched)
        elif days <= 5:
            due_soon.append(enriched)
        else:
            upcoming.append(enriched)

    result = {
        "total_count": len(bills),
        "total_amount_due": round(total_amount, 2),
        "overdue": overdue,
        "due_soon": due_soon,
        "upcoming": upcoming,
        "anomalies": anomalies,
        "scanned_at": datetime.now().isoformat(),
    }
    return json.dumps(result, default=str)
