"""
api/server.py — FastAPI REST API for DailyPilot
Serves the luminous pure-white dashboard frontend and exposes complete CRUD,
scheduling, Firebase config, and agent control endpoints.
"""

import os
import logging
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from db.database import (
    get_all_tasks,
    get_pending_tasks,
    get_task,
    add_task,
    update_task,
    delete_task,
    get_all_bills,
    get_pending_bills,
    get_bill,
    add_bill,
    update_bill,
    delete_bill,
    get_all_alerts,
    get_open_alerts,
    add_alert,
    resolve_alert,
    delete_alert,
    get_latest_briefing,
    get_all_briefings,
    get_last_agent_run,
    clear_all_data,
)
from db.seed import seed as seed_database
from agent.scheduler import (
    trigger_manual_run,
    last_run_status,
    get_scheduler_info,
    update_scheduler_interval,
    pause_scheduler,
    resume_scheduler,
)

logger = logging.getLogger("dailypilot.api")

app = FastAPI(
    title="DailyPilot API",
    description="Autonomous everyday AI agent co-pilot with Firebase & Strands SDK",
    version="1.1.0",
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
    Returns the real Firebase configuration discovered and verified via Firebase MCP.
    Allows frontend to dynamically authenticate and sync with Firestore.
    """
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", "AIzaSyA83IoYuwWzuAlmU8lo3BbKSWq7ggCEB7U"),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "ats-showcase-2026.firebaseapp.com"),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "ats-showcase-2026"),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", "ats-showcase-2026.firebasestorage.app"),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", "123765295193"),
        "appId": os.getenv("FIREBASE_APP_ID", "1:123765295193:web:cf3059e30129f024b3c948"),
    }


# ── Status & Scheduler ────────────────────────────────────────────────────────
@app.get("/api/status")
async def get_status():
    """Agent health, scheduler status, and last run metadata."""
    last_run = get_last_agent_run()
    sched = get_scheduler_info()
    return {
        "app": "DailyPilot",
        "version": "1.1.0",
        "theme": "pure-white-glowing",
        "agent_status": last_run_status,
        "scheduler": sched,
        "last_db_run": last_run,
    }


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


# ── Task CRUD ─────────────────────────────────────────────────────────────────
class TaskPayload(BaseModel):
    title: str
    category: str = "general"
    due_date: Optional[str] = None
    priority: str = "medium"
    status: str = "pending"
    notes: Optional[str] = ""


@app.get("/api/tasks")
async def list_tasks(status: Optional[str] = None):
    if status == "pending":
        return get_pending_tasks()
    return get_all_tasks()


@app.get("/api/tasks/{task_id}")
async def fetch_task(task_id: int):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/api/tasks", status_code=201)
async def create_task(body: TaskPayload):
    task_id = add_task(
        title=body.title,
        category=body.category,
        due_date=body.due_date,
        priority=body.priority,
        notes=body.notes or "",
    )
    return {"id": task_id, "title": body.title, "status": "pending", "success": True}


@app.put("/api/tasks/{task_id}")
async def edit_task(task_id: int, body: TaskPayload):
    existing = get_task(task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    update_task(
        task_id=task_id,
        title=body.title,
        category=body.category,
        due_date=body.due_date,
        priority=body.priority,
        status=body.status,
        notes=body.notes or "",
    )
    return {"id": task_id, "updated": True}


@app.delete("/api/tasks/{task_id}")
async def remove_task(task_id: int):
    delete_task(task_id)
    return {"id": task_id, "deleted": True}


# ── Bill CRUD ─────────────────────────────────────────────────────────────────
class BillPayload(BaseModel):
    name: str
    amount: float
    due_date: str
    category: str = "utilities"
    status: str = "pending"
    is_recurring: int = 1
    notes: Optional[str] = ""


@app.get("/api/bills")
async def list_bills(status: Optional[str] = None):
    if status == "pending":
        return get_pending_bills()
    return get_all_bills()


@app.get("/api/bills/{bill_id}")
async def fetch_bill(bill_id: int):
    bill = get_bill(bill_id)
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


@app.post("/api/bills", status_code=201)
async def create_bill(body: BillPayload):
    bill_id = add_bill(
        name=body.name,
        amount=body.amount,
        due_date=body.due_date,
        category=body.category,
        is_recurring=body.is_recurring,
        notes=body.notes or "",
    )
    return {"id": bill_id, "name": body.name, "amount": body.amount, "success": True}


@app.put("/api/bills/{bill_id}")
async def edit_bill(bill_id: int, body: BillPayload):
    existing = get_bill(bill_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    update_bill(
        bill_id=bill_id,
        name=body.name,
        amount=body.amount,
        due_date=body.due_date,
        category=body.category,
        status=body.status,
        is_recurring=body.is_recurring,
        notes=body.notes or "",
    )
    return {"id": bill_id, "updated": True}


@app.delete("/api/bills/{bill_id}")
async def remove_bill(bill_id: int):
    delete_bill(bill_id)
    return {"id": bill_id, "deleted": True}


# ── Alert / Decision CRUD ─────────────────────────────────────────────────────
class AlertPayload(BaseModel):
    type: str = "custom"
    title: str
    description: str
    severity: str = "medium"
    source_id: Optional[int] = None
    source_type: Optional[str] = None


@app.get("/api/alerts")
async def list_alerts(open_only: bool = False):
    if open_only:
        return get_open_alerts()
    return get_all_alerts()


@app.post("/api/alerts", status_code=201)
async def create_alert(body: AlertPayload):
    alert_id = add_alert(
        type_=body.type,
        title=body.title,
        description=body.description,
        severity=body.severity,
        source_id=body.source_id,
        source_type=body.source_type,
    )
    return {"id": alert_id, "title": body.title, "success": True}


@app.post("/api/alerts/{alert_id}/resolve")
async def resolve_alert_endpoint(alert_id: int):
    resolve_alert(alert_id)
    return {"resolved": True, "alert_id": alert_id}


@app.delete("/api/alerts/{alert_id}")
async def remove_alert(alert_id: int):
    delete_alert(alert_id)
    return {"deleted": True, "alert_id": alert_id}


# ── Briefings ─────────────────────────────────────────────────────────────────
@app.get("/api/briefing")
async def get_briefing():
    briefing = get_latest_briefing()
    if not briefing:
        return JSONResponse(
            {"message": "No briefing yet. Run the agent first."},
            status_code=404,
        )
    return briefing


@app.get("/api/briefings")
async def list_briefings():
    return get_all_briefings()


# ── Agent Execution ───────────────────────────────────────────────────────────
@app.post("/api/run-agent")
async def run_agent_now():
    if last_run_status.get("status") == "running":
        return JSONResponse(
            {"message": "Agent is already running.", "status": "running"},
            status_code=409,
        )
    result = trigger_manual_run()
    return {"message": "Agent run triggered.", **result}


# ── Data Reset & Wipe ─────────────────────────────────────────────────────────
@app.post("/api/data/clear")
async def clear_database():
    clear_all_data()
    return {"message": "All data cleared successfully.", "status": "empty"}


@app.post("/api/data/reset")
async def reset_sample_data():
    seed_database()
    return {"message": "Sample data seeded fresh.", "status": "seeded"}
