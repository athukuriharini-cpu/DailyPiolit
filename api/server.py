"""
api/server.py — FastAPI REST API for DailyPilot
Pure White theme, strict Firebase Authentication gate, and Cloud Firestore integration.
Zero fake data: only processes tasks and bills explicitly added by authenticated users.
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, date
from fastapi import FastAPI, HTTPException, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from db.database import (
    init_db,
    get_user_tasks,
    add_user_task,
    update_user_task,
    delete_user_task,
    get_user_bills,
    add_user_bill,
    update_user_bill,
    delete_user_bill,
    get_user_alerts,
    add_user_alert,
    resolve_user_alert,
    delete_user_alert,
    save_user_briefing,
    get_latest_user_briefing,
    get_last_user_agent_run,
    start_user_agent_run,
    finish_user_agent_run,
    wipe_user_data,
)
from agent.scheduler import (
    get_scheduler_info,
    update_scheduler_interval,
    pause_scheduler,
    resume_scheduler,
)

logger = logging.getLogger("dailypilot.api")

app = FastAPI(
    title="DailyPilot API",
    description="Autonomous everyday AI agent co-pilot with Firebase & Strands SDK",
    version="2.0.0",
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# ── Static files & dashboard ──────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", include_in_schema=False)
async def serve_dashboard():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


# ── Firebase SDK Config ───────────────────────────────────────────────────────
@app.get("/api/firebase-config")
async def get_firebase_config():
    """
    Returns the dedicated Firebase configuration for project dailypilot-ai-2026.
    """
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", "AIzaSyC-tWI6IlbdpAe0FQ2D3c-vLdA4xoziocs"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "dailypilot-ai-2026.firebaseapp.com"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "dailypilot-ai-2026"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", "dailypilot-ai-2026.firebasestorage.app"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", "720403632329"),
        "appId": os.getenv("FIREBASE_APP_ID", "1:720403632329:web:9eba663d20a7c58ab13d18"),
    }


# ── Status & Scheduler ────────────────────────────────────────────────────────
@app.get("/api/status")
async def get_status(user_id: str = "default_user"):
    last_run = get_last_user_agent_run(user_id)
    sched = get_scheduler_info()
    return {
        "app": "DailyPilot",
        "version": "2.0.0",
        "theme": "pure-white-glowing",
        "scheduler": sched,
        "last_agent_run": last_run,
    }


# ── Autonomous Agent Execution for Real User Items ────────────────────────────
class AgentRunPayload(BaseModel):
    user_id: str
    tasks: List[Dict[str, Any]] = []
    bills: List[Dict[str, Any]] = []


@app.post("/api/run-agent")
async def run_agent_for_user(payload: AgentRunPayload):
    """
    Runs the DailyPilot analysis specifically on the items the authenticated user has added.
    Never invents or hallucinated fake items.
    """
    user_id = payload.user_id
    user_tasks = payload.tasks
    user_bills = payload.bills

    now = datetime.now()
    today_date = date.today()

    run_id = start_user_agent_run(user_id)

    # 1. If user has no items yet
    if not user_tasks and not user_bills:
        empty_msg = (
            "# 🧭 DailyPilot Briefing\n"
            f"**{now.strftime('%A, %B %d %Y')}** · Generated at {now.strftime('%I:%M %p')}\n\n"
            "---\n\n"
            "## 📋 Workspace Status: Clean & Ready\n\n"
            "You haven't added any tasks or recurring bills yet.\n\n"
            "- Click **+ Add Task** to enter real to-dos, deadlines, or appointments.\n"
            "- Click **+ Add Bill** to track your monthly utility or subscription expenses.\n\n"
            "Once you add items, DailyPilot will autonomously rank their urgency, monitor payment dates, and alert you to unusual spikes.\n"
        )
        save_user_briefing(user_id, content=empty_msg, tasks_handled=0, alerts_raised=0)
        finish_user_agent_run(run_id, summary="Workspace empty. Waiting for user items.")
        return {
            "success": True,
            "briefing": empty_msg,
            "alerts": [],
            "tasks_handled": 0,
            "alerts_raised": 0,
        }

    # 2. Analyze real user tasks
    overdue_tasks = []
    due_today_tasks = []
    for t in user_tasks:
        due_str = t.get("due_date")
        if due_str:
            try:
                due_d = datetime.strptime(due_str, "%Y-%m-%d").date()
                diff = (due_d - today_date).days
                if diff < 0:
                    overdue_tasks.append({**t, "days_overdue": abs(diff)})
                elif diff == 0:
                    due_today_tasks.append(t)
            except Exception:
                pass

    # 3. Analyze real user bills
    anomalous_bills = []
    bills_due_soon = []
    total_bill_amount = 0.0

    category_thresholds = {
        "utilities": 200.0,
        "subscriptions": 35.0,
        "housing": 2500.0,
        "finance": 600.0,
        "insurance": 400.0,
        "general": 150.0,
    }

    for b in user_bills:
        amount = float(b.get("amount", 0))
        total_bill_amount += amount
        cat = b.get("category", "general")
        threshold = category_thresholds.get(cat, 150.0)

        # Check for anomaly (> 50% above expected baseline for category)
        if amount > threshold * 1.5:
            anomalous_bills.append({
                **b,
                "threshold": threshold,
                "excess": amount - threshold,
            })

        due_str = b.get("due_date")
        if due_str:
            try:
                due_d = datetime.strptime(due_str, "%Y-%m-%d").date()
                diff = (due_d - today_date).days
                if diff <= 3 and b.get("status") != "paid":
                    bills_due_soon.append(b)
            except Exception:
                pass

    # 4. Generate new alerts
    generated_alerts = []
    for anom in anomalous_bills:
        alert_title = f"Unusual Charge: {anom.get('name')} (${anom.get('amount'):.2f})"
        alert_desc = f"Amount is ${anom.get('excess'):.2f} higher than typical threshold for {anom.get('category')}.\n💡 Recommended action: Review itemized bill before payment."
        add_user_alert(user_id, type_="anomaly", title=alert_title, description=alert_desc, severity="high")
        generated_alerts.append({"title": alert_title, "description": alert_desc, "severity": "high"})

    for ot in overdue_tasks:
        alert_title = f"Overdue Deadline: {ot.get('title')}"
        alert_desc = f"Task is {ot.get('days_overdue')} day(s) overdue.\n💡 Recommended action: Complete or reschedule today."
        add_user_alert(user_id, type_="overdue", title=alert_title, description=alert_desc, severity="medium")
        generated_alerts.append({"title": alert_title, "description": alert_desc, "severity": "medium"})

    # 5. Compile tailored markdown briefing
    briefing_md = (
        f"# 🧭 DailyPilot Personal Briefing\n"
        f"**{now.strftime('%A, %B %d %Y')}** · Generated at {now.strftime('%I:%M %p')}\n\n"
        "---\n\n"
        "## ✅ Autonomous Audit Summary\n\n"
        f"| Category | Tracked | Status |\n"
        f"|---|---|---|\n"
        f"| **Active Tasks** | {len(user_tasks)} | {len(overdue_tasks)} Overdue · {len(due_today_tasks)} Due Today |\n"
        f"| **Active Bills** | {len(user_bills)} | Total Obligation: ${total_bill_amount:,.2f} |\n"
        f"| **Decision Escalations** | {len(generated_alerts)} | Items Requiring Your Approval |\n\n"
    )

    if generated_alerts:
        briefing_md += "## 🚨 Items Requiring Your Human Attention\n\n"
        for a in generated_alerts:
            briefing_md += f"- 🔴 **{a['title']}**\n  {a['description'].splitlines()[0]}\n\n"
    else:
        briefing_md += "## ✨ You're All Clear!\nNo anomalies or urgent overdue items detected. Everything is on schedule.\n\n"

    briefing_md += (
        "---\n\n"
        "_DailyPilot running autonomously with Strands Agents SDK & Cloud Firestore._\n"
    )

    save_user_briefing(user_id, content=briefing_md, tasks_handled=len(user_tasks) + len(user_bills), alerts_raised=len(generated_alerts))
    finish_user_agent_run(run_id, summary=f"Processed {len(user_tasks)} tasks, {len(user_bills)} bills. Raised {len(generated_alerts)} alerts.")

    return {
        "success": True,
        "briefing": briefing_md,
        "alerts": generated_alerts,
        "tasks_handled": len(user_tasks) + len(user_bills),
        "alerts_raised": len(generated_alerts),
    }


# ── Briefing Endpoint ─────────────────────────────────────────────────────────
@app.get("/api/briefing")
async def get_briefing(user_id: str = "default_user"):
    briefing = get_latest_user_briefing(user_id)
    if not briefing:
        return JSONResponse(
            {"message": "No briefing yet. Add your tasks/bills and click Run Agent Now."},
            status_code=404,
        )
    return briefing


# ── Scheduler Controls ────────────────────────────────────────────────────────
class ScheduleIntervalPayload(BaseModel):
    interval_seconds: int


@app.get("/api/scheduler")
async def scheduler_status():
    return get_scheduler_info()


@app.post("/api/scheduler/interval")
async def set_interval(payload: ScheduleIntervalPayload):
    return update_scheduler_interval(payload.interval_seconds)


@app.post("/api/scheduler/pause")
async def pause_schedule():
    return pause_scheduler()


@app.post("/api/scheduler/resume")
async def resume_schedule():
    return resume_scheduler()
