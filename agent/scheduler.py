"""
agent/scheduler.py
APScheduler wrapper that runs DailyPilot autonomously on a configurable interval.
Also exposes a last_run_status dict for the API to read.
"""

import os
import logging
import threading
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from db.database import start_agent_run, finish_agent_run

logger = logging.getLogger("dailypilot.scheduler")

# Global run status — readable by the API
last_run_status: dict = {
    "status": "never_run",
    "started_at": None,
    "finished_at": None,
    "run_id": None,
}

_run_lock = threading.Lock()


def _do_agent_run() -> None:
    """Called by APScheduler and the manual trigger endpoint."""
    global last_run_status

    if _run_lock.locked():
        logger.warning("Agent run already in progress — skipping.")
        return

    with _run_lock:
        # Import here to avoid circular imports at module load
        from agent.agent import run_agent

        run_id = start_agent_run()
        last_run_status = {
            "status": "running",
            "started_at": datetime.now().isoformat(),
            "finished_at": None,
            "run_id": run_id,
        }
        logger.info(f"▶ Agent run #{run_id} started.")

        try:
            summary = run_agent()
            finish_agent_run(run_id, summary=summary[:500], status="success")
            last_run_status.update({
                "status": "success",
                "finished_at": datetime.now().isoformat(),
            })
            logger.info(f"✅ Agent run #{run_id} completed successfully.")
        except Exception as exc:
            logger.exception(f"❌ Agent run #{run_id} failed: {exc}")
            finish_agent_run(run_id, summary=str(exc), status="error")
            last_run_status.update({
                "status": "error",
                "finished_at": datetime.now().isoformat(),
                "error": str(exc),
            })


def trigger_manual_run() -> dict:
    """Trigger an immediate agent run in a background thread."""
    thread = threading.Thread(target=_do_agent_run, daemon=True, name="agent-manual-run")
    thread.start()
    return {"triggered": True, "at": datetime.now().isoformat()}


_scheduler_instance: BackgroundScheduler | None = None
_current_interval_seconds: int = int(os.getenv("AGENT_RUN_INTERVAL_SECONDS", "3600"))
_is_paused: bool = False


def get_scheduler_info() -> dict:
    """Return scheduler current state, interval, pause status, and next scheduled run."""
    global _scheduler_instance, _current_interval_seconds, _is_paused

    next_run = None
    if _scheduler_instance and not _is_paused:
        job = _scheduler_instance.get_job("dailypilot_run")
        if job and job.next_run_time:
            next_run = job.next_run_time.isoformat()

    return {
        "interval_seconds": _current_interval_seconds,
        "is_paused": _is_paused,
        "next_run_time": next_run,
        "active": _scheduler_instance.running if _scheduler_instance else False,
    }


def update_scheduler_interval(seconds: int) -> dict:
    """Update how often the autonomous agent runs."""
    global _scheduler_instance, _current_interval_seconds
    _current_interval_seconds = max(60, seconds)

    if _scheduler_instance:
        _scheduler_instance.reschedule_job(
            "dailypilot_run",
            trigger=IntervalTrigger(seconds=_current_interval_seconds),
        )
        logger.info(f"Updated agent schedule to every {_current_interval_seconds}s.")
    return get_scheduler_info()


def pause_scheduler() -> dict:
    """Pause the background autonomous schedule."""
    global _scheduler_instance, _is_paused
    if _scheduler_instance:
        _scheduler_instance.pause_job("dailypilot_run")
        _is_paused = True
        logger.info("Paused background agent scheduler.")
    return get_scheduler_info()


def resume_scheduler() -> dict:
    """Resume the background autonomous schedule."""
    global _scheduler_instance, _is_paused
    if _scheduler_instance:
        _scheduler_instance.resume_job("dailypilot_run")
        _is_paused = False
        logger.info("Resumed background agent scheduler.")
    return get_scheduler_info()


def start_scheduler() -> BackgroundScheduler:
    """Start the background scheduler. Returns the scheduler instance."""
    global _scheduler_instance, _current_interval_seconds
    _current_interval_seconds = int(os.getenv("AGENT_RUN_INTERVAL_SECONDS", "3600"))

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        func=_do_agent_run,
        trigger=IntervalTrigger(seconds=_current_interval_seconds),
        id="dailypilot_run",
        name="DailyPilot Autonomous Run",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    _scheduler_instance = scheduler
    logger.info(f"Scheduler started — agent will run every {_current_interval_seconds}s.")
    return scheduler

