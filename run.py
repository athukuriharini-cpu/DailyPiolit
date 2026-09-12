"""
run.py — DailyPilot entry point
Starts the database, background scheduler, and FastAPI server.
"""

import os
import sys
import logging
import uvicorn
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).parent / ".env")

# Reconfigure stdout/stderr for utf-8 on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── Logging ────────────────────────────────────────────────────────────────
log_level = logging.DEBUG if os.getenv("DEBUG", "").lower() == "true" else logging.INFO
logging.basicConfig(
    level=log_level,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("dailypilot")


def main() -> None:
    logger.info("[*] DailyPilot starting up...")

    # 1. Initialise database
    from db.database import init_db
    init_db()
    logger.info("[OK] Database ready.")

    # 2. Start autonomous scheduler
    from agent.scheduler import start_scheduler
    scheduler = start_scheduler()

    # 3. Start FastAPI server
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"[>>] Dashboard -> http://localhost:{port}")
    logger.info(f"[>>] API docs  -> http://localhost:{port}/docs")

    try:
        uvicorn.run(
            "api.server:app",
            host="0.0.0.0",
            port=port,
            log_level="warning",  # uvicorn access logs suppressed; use our logger
            reload=False,
        )
    finally:
        scheduler.shutdown(wait=False)
        logger.info("[*] DailyPilot shut down.")


if __name__ == "__main__":
    main()
