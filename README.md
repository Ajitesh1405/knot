# 🪢 Knot

**A personal AI assistant that lives in Telegram, reads your email & calendar, and builds an inspectable knowledge graph of your life.**

Talk to Knot like a friend. It reads your Gmail and Outlook, tells you what's on your calendar, drafts and sends replies **with your approval**, schedules meetings, briefs you before they start, and quietly remembers the people and facts that come up — all in a Neo4j graph you can actually *see*.

Self-hostable. Privacy-first. Your Postgres + your Neo4j + your own LLM key = the entire stack. No SaaS lock-in.

---

## ⚡ Quick start

```bash
git clone <your-repo-url> knot && cd knot
cp .env.example .env          # then fill in your keys (see below)
docker compose up -d --build  # starts Postgres + Neo4j + the app, runs migrations
```
Then open your bot in Telegram → `/start` → `/connect_gmail`.

You'll need to drop a few credentials into `.env` first — a **Telegram bot token**, an **Anthropic API key**, a **Google OAuth client**, and a **public HTTPS URL** (a domain, or an ngrok tunnel for testing). It's ~15 minutes, one-time, and every step is in **[SETUP.md](SETUP.md)**.

> No Docker? Use a managed Postgres + Neo4j (free tiers) and run with Node:
> `npm install && npx prisma migrate deploy && npm run build && npm run start:prod`. Full details in [SETUP.md](SETUP.md).

---

## ✨ What it can do

- 💬 **Just chat** — small talk, "what's the date", "weather in Mumbai" (live), "what can you do".
- 📧 **Email (Gmail + Outlook)** — "any emails today?", "check my outlook this week".
- ✍️ **Draft & send replies** — "reply to Sarah saying I'll send the deck Friday" → you get an **Approve / Edit / Cancel** card; nothing sends without your tap. Edit it yourself or let the AI revise.
- 📅 **Calendar** — "what's on my calendar tomorrow", "what's my next meeting" (with attendees + agenda).
- 🤝 **Schedule meetings** — "schedule 30 min with Aditi tomorrow morning" → finds a free slot via free/busy → you approve → sends a Google Calendar invite + Meet link.
- 🔔 **Proactive briefings** — opt-in pings ~30 min before a meeting, with who's attending, recent emails, and context.
- 🧠 **Memory graph** — Knot extracts people, places, and facts from your chats and email and stores them in Neo4j. View it live at `/graph`.
- 🧵 **Conversation memory** — follow-ups like "reply to him" or "where does she live?" resolve from recent context.

Everything works in **natural language** — slash commands are just shortcuts.

---

## 🏗️ How it works

```
Telegram ──► TelegramService
                  │
                  ▼
            AgentService  ── conversation memory (short-term)
                  │
                  ▼
            SupervisorService  ──►  routes each message to ONE specialist
                  │
   ┌──────┬───────┼───────────┬──────────┬───────────┬───────────┐
  chat  search  gmail/outlook  calendar  compose*    scheduler*   chat_tracker
  (sm   (graph  (read mail)    (read +   (draft &    (find slot   (extract
   LLM   recall)               brief)    send email) + invite)     facts)
   + tools)                              └─ HITL approval via LangGraph + Postgres ─┘

Knowledge  ──►  Neo4j  (entities + relations, per-user, visualized at /graph)
Settings/drafts ─► Postgres (Prisma)   |   HITL state ─► Postgres (LangGraph checkpointer, `langgraph` schema)
```

- **NestJS** backend, **LangChain + LangGraph** for orchestration, **Anthropic Claude** via an `LlmService` abstraction (OpenRouter/Ollama also supported).
- A **supervisor** routes every message to one **specialist**. The orchestration is plain, readable code in [`agent.service.ts`](src/agent/agent.service.ts) — no magic.
- **Human-in-the-loop** flows (email send, meeting scheduling) pause on a LangGraph `interrupt()` and resume on your Telegram button tap, surviving restarts via a Postgres checkpointer.
- **Memory** is a Neo4j graph, isolated per user, that grows from your conversations.

---

## ✅ Prerequisites

- **Node.js 20+** and **npm** (for local runs), or **Docker** (for the one-command path).
- **Postgres** and **Neo4j** (both included in the Docker setup).
- A **Telegram bot token** (free, from [@BotFather](https://t.me/BotFather)).
- A **Google Cloud OAuth client** (for Gmail + Calendar).
- *(Optional)* An **Azure app registration** (for Outlook).
- An **Anthropic API key** (or OpenRouter/Ollama).
- A **public HTTPS URL** for OAuth redirects + the Telegram Mini App graph viewer (a domain in production; an [ngrok](https://ngrok.com) tunnel in dev).

---

## 🚀 Setup

> 📘 **Prefer step-by-step for your exact setup?** See **[SETUP.md](SETUP.md)** — it walks through every option end-to-end: managed cloud DBs (no install), Docker, or native install, plus both run modes. The summary below covers the same ground more briefly.

### 1. Clone & configure
```bash
git clone <your-repo-url> knot && cd knot
cp .env.example .env
```
Fill in `.env` (see comments in [`.env.example`](.env.example)). The key ones: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_URL`, the Google OAuth trio, and (optionally) the Microsoft trio.

### 2. Telegram bot
Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.

### 3. Google OAuth (Gmail + Calendar)
1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**.
3. **Credentials → Create OAuth client ID → Web application**.
4. Add **Authorized redirect URI**: `https://YOUR_PUBLIC_URL/auth/google/callback`.
5. On the **OAuth consent screen**, add scopes: `gmail.readonly`, `gmail.send`, `calendar.readonly`, `calendar.events`. Add yourself as a test user.
6. Copy the client ID/secret + redirect into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.

### 4. Microsoft OAuth (Outlook) — optional
[Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration** → multitenant + personal accounts → redirect URI `https://YOUR_PUBLIC_URL/auth/microsoft/callback` → add a client secret → API permissions → Microsoft Graph **delegated**: `Mail.Read`, `User.Read`, `offline_access`. Copy into the `MS_*` vars.

### 5. Get a Postgres + Neo4j (pick one)

You need a Postgres database and a Neo4j instance. Any of these work — set the connection strings in `.env` (`DATABASE_URL`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`):

- **🅰️ Managed free tiers — easiest, no install, no Docker.**
  Create a free **[Neo4j AuraDB](https://neo4j.com/cloud/aura-free/)** instance and a free hosted Postgres (**[Neon](https://neon.tech)**, **[Supabase](https://supabase.com)**, or **[Railway](https://railway.app)**). Paste the connection strings into `.env`. Nothing to install locally. *Recommended if you don't use Docker.*
- **🅱️ Docker for just the databases.** `docker compose up -d postgres neo4j` (uses the bundled defaults; `.env` already points at `localhost`).
- **🅲 Install natively.** [Postgres](https://www.postgresql.org/download/) + [Neo4j](https://neo4j.com/download/) on your machine, then point `.env` at them.

### 6. Run

**Option A — Docker, full stack (one command):**
```bash
docker compose up -d --build
```
Starts Postgres, Neo4j, and the app. Migrations run automatically on boot. Done.

**Option B — Without Docker (Node directly):**
```bash
npm install
npx prisma migrate deploy   # creates all tables on a fresh DB
npm run build
npm run start:prod          # or: npm run start:dev  (watch mode)
```
Requires a reachable Postgres + Neo4j from step 5 (managed or native). That's the only difference from the Docker path — same app, same migrations.

On a healthy start you'll see `Compose HITL graph ready`, `Scheduler HITL graph ready`, and `Telegram bot started`.

---

## 💬 Using Knot

Open your bot in Telegram and send `/start`, then connect your accounts:

```
/connect_gmail        link Gmail + Calendar (pick the right Google account!)
/connect_outlook      link Outlook / Microsoft (optional)
```

Then just talk to it:

| You say | Knot does |
|---|---|
| `what's the date today?` / `weather in Pune?` | answers (live) |
| `any emails today?` | summarizes Gmail |
| `check my outlook this week` | summarizes Outlook |
| `reply to Sarah saying I'll send Friday` | drafts a reply → **Approve/Edit/Cancel** card |
| `email john@acme.com about the demo` | drafts a fresh email → approval card |
| `what's on my calendar tomorrow` | lists meetings |
| `what's my next meeting` | full briefing (attendees + agenda) |
| `schedule 30 min with Aditi tomorrow morning` | finds a slot → approve → invite + Meet link |
| `my friend Sam works at Stripe in Pune` | remembers it; later `where does Sam live?` → "Pune" |
| `what do you know about me?` | summarizes the graph |

**On an email draft card**, tap **✏️ Edit** → reply with the **full text** to use it verbatim, or prefix `ai:` to have Knot revise (e.g. `ai: make it shorter`), or send `cancel` to abort.

### Command reference

| Command | Purpose |
|---|---|
| `/start` | help |
| `/connect_gmail`, `/disconnect_gmail` | Gmail + Calendar |
| `/connect_outlook`, `/disconnect_outlook` | Outlook |
| `/meetings today \| tomorrow` | calendar list |
| `/next meeting` | next meeting + briefing |
| `/schedule <who + when>` | schedule a meeting |
| `/briefings on \| off \| test` | proactive pre-meeting pings |
| `/draft <instruction>` | draft an email directly |
| `/pending` | drafts awaiting approval |
| `/graph` | open the knowledge graph (Mini App) |
| `/settings`, `/scope`, `/range` | preferences |

### See the graph
`/graph` opens the live knowledge graph inside Telegram, or visit `https://YOUR_PUBLIC_URL/viz.html?userId=tg-<your-id>` in a browser. Neo4j Browser (`http://localhost:7474`) works too.

---

## 🌐 Deployment notes

- **Stable public URL is required.** Google/Microsoft OAuth redirects and the Telegram Mini App need a fixed HTTPS origin. Put the app behind a reverse proxy with TLS (Caddy/Nginx) on your server, and set `PUBLIC_URL` + the two `*_REDIRECT_URI` vars to that domain.
- If your URL ever changes (e.g. a new ngrok tunnel in dev), update `PUBLIC_URL`, `GOOGLE_REDIRECT_URI`, `MS_REDIRECT_URI`, **and** the redirect URIs in the Google/Azure consoles.
- The app polls Telegram (no inbound webhook needed), so only the OAuth callbacks and `/viz.html` need to be reachable.
- Change the default Neo4j password (`docker-compose.yml` + `NEO4J_PASSWORD`).

---

## 🗺️ Roadmap

- Daily digest scheduler (overnight email + open commitments)
- Slack connector
- Richer cross-channel identity resolution
- Persistent conversation memory

---

## 📁 Project structure

```
src/
  agent/        supervisor + specialists (chat, search, gmail, outlook,
                calendar, compose*, scheduler*, chat_tracker) + HITL graphs
  calendar/     calendar read, briefings, briefing cron scheduler
  gmail/        Gmail OAuth + read/send
  outlook/      Microsoft Graph OAuth + read
  graph/        Neo4j knowledge graph
  llm/          model-tier abstraction (chat / fast / smart)
  settings/     per-user preferences (Prisma)
  telegram/     the Telegram bot (commands + inline buttons)
prisma/         schema + migrations
public/         viz.html (graph viewer)
```
`*` = human-in-the-loop flows (LangGraph + Postgres checkpointer).

---

## 📄 License

MIT — see [LICENSE](LICENSE).
