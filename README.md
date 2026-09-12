<div align="center">

# 🧭 DailyPilot

### *Your AI co-pilot for daily life — runs quietly, acts fast, pings you only when it matters.*

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org)
[![Strands Agents SDK](https://img.shields.io/badge/Built_with-Strands_Agents_SDK-orange)](https://strandsagents.com)
[![Firebase](https://img.shields.io/badge/Hosted_on-Firebase-ffca28?logo=firebase&logoColor=black)](https://dailypilot-ai-2026.web.app)
[![Track](https://img.shields.io/badge/Track-Everyday_Agents-green)](https://devpost.com)

**Agents for Humans Hackathon | AWS × Devpost 2026**

🌐 **Live Deployed App**: **[https://dailypilot-ai-2026.web.app](https://dailypilot-ai-2026.web.app)**

</div>

---

## 🎯 The Problem

Every day, people lose 1–2 hours to small, repetitive tasks:
- Checking which bills are due this week
- Scanning emails for action items
- Deciding what's urgent vs. what can wait
- Drafting and sending routine reminders

**Individually minor. Collectively exhausting.**

## ✅ The Solution

DailyPilot is an **autonomous AI agent** built with the [Strands Agents SDK](https://strandsagents.com) that:

1. 🔍 **Scans** your task inbox every hour — bills, reminders, appointments
2. 🏷️ **Categorizes & ranks** by urgency and due date automatically
3. ⚡ **Acts autonomously** — marks routine items handled, sends scheduled reminders
4. 🚨 **Only pings you** when there's a real decision (unusual charge, scheduling conflict, new bill)
5. 📋 **Sends a daily briefing** — what happened, what's upcoming, what needs you

You open your laptop to a one-page summary. Everything routine is done. Only real decisions wait for you.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         DailyPilot                             │
│                                                                │
│   ┌─────────────┐     ┌───────────────────────────────────┐   │
│   │  Dashboard  │◄────│       Strands Agent Core          │   │
│   │  (Web UI)   │     │  (Claude Sonnet 4 via Bedrock)    │   │
│   └─────────────┘     └───────────────────────────────────┘   │
│                                     │                          │
│                    ┌────────────────┼────────────────┐         │
│             ┌──────▼──┐    ┌────────▼──┐    ┌────────▼──┐     │
│             │  Task   │    │   Bill    │    │ Reminder  │     │
│             │ Scanner │    │  Tracker  │    │  Sender   │     │
│             └─────────┘    └───────────┘    └───────────┘     │
│             ┌──────────┐   ┌───────────┐    ┌───────────┐     │
│             │Priority  │   │ Decision  │    │ Briefing  │     │
│             │ Ranker   │   │ Escalator │    │ Generator │     │
│             └──────────┘   └───────────┘    └───────────┘     │
│                                                                │
│   ┌────────────────────────────────────────────────────────┐  │
│   │         SQLite DB  (tasks, bills, alerts, briefings)   │  │
│   └────────────────────────────────────────────────────────┘  │
│                                                                │
│   APScheduler — Runs agent autonomously every hour             │
└────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- AWS account with Amazon Bedrock access (Claude Sonnet 4)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/dailypilot.git
cd dailypilot

python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Configure AWS Credentials

```bash
cp .env.example .env
```

Edit `.env` and fill in your AWS credentials:

```env
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_DEFAULT_REGION=us-east-1
```

> **Getting AWS credentials:** Sign in to [AWS Console](https://console.aws.amazon.com) → IAM → Create user with `AmazonBedrockFullAccess` → Security credentials → Create access key.
>
> **Enable Bedrock model access:** AWS Console → Amazon Bedrock → Model access → Enable Claude Sonnet 4.

### 3. Seed Demo Data & Run

```bash
# Seed the database with realistic demo tasks and bills
python -m db.seed

# Start DailyPilot
python run.py
```

Open your browser to **http://localhost:8000** to see the dashboard.

### 4. Trigger the Agent

Click **"Run Agent Now"** in the dashboard, or call the API:

```bash
curl -X POST http://localhost:8000/api/run-agent
```

Watch the agent scan tasks, rank priorities, handle routine items, escalate decisions, and produce a briefing — all autonomously.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/briefing` | Latest daily briefing |
| `GET` | `/api/tasks` | All tasks with status |
| `GET` | `/api/alerts` | Items escalated for human decision |
| `POST` | `/api/tasks` | Add a new task |
| `POST` | `/api/run-agent` | Trigger agent run immediately |
| `GET` | `/api/status` | Agent health & last run time |

---

## 🛠️ Built With

| Technology | Purpose |
|---|---|
| [Strands Agents SDK](https://strandsagents.com) | AI agent orchestration |
| Amazon Bedrock (Claude Sonnet 4) | LLM reasoning |
| FastAPI | REST API server |
| APScheduler | Autonomous background scheduling |
| SQLite | Persistent task & bill storage |
| Vanilla HTML/CSS/JS | Dashboard UI |

---

## 📁 Project Structure

```
dailypilot/
├── run.py                    # Entry point
├── requirements.txt
├── .env.example
├── LICENSE                   # Apache 2.0
│
├── agent/
│   ├── agent.py              # Strands Agent definition
│   ├── scheduler.py          # Autonomous background runner
│   └── tools/
│       ├── task_scanner.py   # Scans pending tasks
│       ├── bill_tracker.py   # Tracks bills & due dates
│       ├── reminder_sender.py# Logs & sends reminders
│       ├── priority_ranker.py# Ranks by urgency
│       ├── decision_escalator.py  # Flags human decisions
│       └── briefing_generator.py  # Daily summary
│
├── api/
│   └── server.py             # FastAPI endpoints
│
├── db/
│   ├── database.py           # SQLite schema & helpers
│   └── seed.py               # Demo data seeder
│
└── frontend/
    ├── index.html            # Dashboard SPA
    ├── style.css
    └── app.js
```

---

## 📄 License

Apache 2.0 — see [LICENSE](LICENSE).
