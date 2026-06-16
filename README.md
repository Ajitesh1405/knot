# 🪢 Knot — Self-Hosted AI Assistant for Telegram

> **Read your Gmail & Outlook, draft replies with your approval, schedule meetings, and build a living knowledge graph — all from Telegram. Privacy-first. No SaaS lock-in.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-95%25-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-Backend-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Neo4j](https://img.shields.io/badge/Neo4j-Knowledge%20Graph-008CC1?logo=neo4j&logoColor=white)](https://neo4j.com/)
[![Anthropic Claude](https://img.shields.io/badge/Powered%20by-Claude%20AI-blueviolet)](https://anthropic.com/)
[![Stars](https://img.shields.io/github/stars/Ajitesh1405/knot?style=social)](https://github.com/Ajitesh1405/knot/stargazers)

---

<!-- Add a GIF here: screen-record a 30s Telegram conversation (email summary → approve reply) and drop it in /public/demo.gif -->
<!-- ![Knot Demo](public/demo.gif) -->

---

## 🤔 What Is Knot?

**Knot** is an open-source, self-hosted personal AI assistant that runs inside **Telegram**. It connects to your Gmail, Outlook, and Google Calendar — reads your inbox, drafts replies, schedules meetings, and quietly builds an inspectable **Neo4j knowledge graph** of the people and facts that come up in your life.

**Your data never leaves your stack.** Your Postgres. Your Neo4j. Your own LLM API key.

| Feature | Details |
|---|---|
| 📧 Email | Gmail + Outlook read & summarise |
| ✍️ Draft & Send | Human-in-the-loop approval before anything sends |
| 📅 Calendar | Read events, next meeting briefings |
| 🤝 Schedule | Find free slots → invite + Meet link |
| 🧠 Memory | Neo4j knowledge graph, per-user, inspectable |
| 🔔 Briefings | Proactive pings 30 min before meetings |
| 🤖 LLM | Anthropic Claude, OpenRouter, or Ollama |
| 🐳 Deploy | One `docker compose up` |

---

## ⚡ Quick Start (Docker — recommended)

```bash
git clone https://github.com/Ajitesh1405/knot.git knot && cd knot
cp .env.example .env          # fill in your keys (see SETUP.md — ~15 min, one-time)
docker compose up -d --build  # starts Postgres + Neo4j + app, runs migrations
```

Then open your Telegram bot → `/start` → `/connect_gmail`.

**Minimum credentials required in `.env`:**
- `TELEGRAM_BOT_TOKEN` — free, from [@BotFather](https://t.me/BotFather)
- `ANTHROPIC_API_KEY` — or use OpenRouter/Ollama
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
- `PUBLIC_URL` — your domain or an [ngrok](https://ngrok.com) tunnel

> **No Docker?** `npm install && npx prisma migrate deploy && npm run build && npm run start:prod` — full walkthrough in [SETUP.md](SETUP.md).

---

## ✨ What Knot Can Do

Talk to it in plain English — slash commands are just shortcuts.

| You say | Knot does |
|---|---|
| `any emails today?` | Summarises Gmail inbox |
| `check my outlook this week` | Summarises Outlook |
| `reply to Sarah saying I'll send the deck Friday` | Drafts reply → **Approve / Edit / Cancel** card — nothing sends without your tap |
| `email john@acme.com about the demo` | Drafts fresh email → approval card |
| `what's on my calendar tomorrow` | Lists meetings with attendees |
| `schedule 30 min with Aditi tomorrow morning` | Finds free slot → you approve → sends Calendar invite + Meet link |
| `my friend Sam works at Stripe in Pune` | Remembers it in the graph; later: `where does Sam work?` → "Stripe" |
| `what do you know about me?` | Summarises your knowledge graph |
| `weather in Mumbai` / `what's the date?` | Answers live |

**On a draft card:** tap ✏️ Edit → send the **full text** to replace, or prefix `ai:` to have Knot revise it (`ai: make it shorter`), or `cancel` to abort.

---

## 🏗️ Architecture

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
  (LLM  (graph  (read mail)    (read +   (draft &    (find slot   (extract
  +tools recall)               brief)    send email) + invite)     facts)
                               └─ HITL approval via LangGraph + Postgres ─┘

Knowledge  ──►  Neo4j  (entities + relations, per-user, visualized at /graph)
Settings/drafts ─► Postgres (Prisma)  |  HITL state ─► Postgres (LangGraph checkpointer)
```

**Key design decisions:**
- **NestJS** backend — typed, modular, testable.
- **LangChain + LangGraph** for agent orchestration. Human-in-the-loop flows pause on `interrupt()` and resume from Telegram button taps, surviving restarts via Postgres checkpointer.
- **`LlmService` abstraction** — swap Anthropic Claude for OpenRouter or Ollama with one env var.
- **Supervisor pattern** — every message routes to exactly one specialist. Logic lives in plain, readable TypeScript; no framework magic.
- **Neo4j knowledge graph** — isolated per user, grows from conversations and email. Visualised as a Telegram Mini App at `/graph`.

---

## ✅ Prerequisites

- **Node.js 20+** and **npm**, or **Docker**
- **Postgres** and **Neo4j** (bundled in Docker Compose, or use free managed tiers)
- **Telegram bot token** — free from [@BotFather](https://t.me/BotFather)
- **Google Cloud OAuth client** — for Gmail + Calendar
- *(Optional)* **Azure app registration** — for Outlook
- **Anthropic API key** — or OpenRouter / Ollama
- **Public HTTPS URL** — domain in production; ngrok tunnel in dev

---

## 🚀 Setup

> 📘 See **[SETUP.md](SETUP.md)** for a complete, step-by-step walkthrough covering managed cloud DBs, Docker, and native install.

### 1. Clone & configure
```bash
git clone https://github.com/Ajitesh1405/knot.git knot && cd knot
cp .env.example .env
```
Fill in `.env` — see comments in [`.env.example`](.env.example). Key vars: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_URL`, and the Google OAuth trio.

### 2. Telegram bot
Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.

### 3. Google OAuth (Gmail + Calendar)
1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **Gmail API** + **Google Calendar API**.
3. **Credentials → Create OAuth client ID → Web application**.
4. Authorized redirect URI: `https://YOUR_PUBLIC_URL/auth/google/callback`.
5. OAuth consent screen scopes: `gmail.readonly`, `gmail.send`, `calendar.readonly`, `calendar.events`. Add yourself as a test user.
6. Copy into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.

### 4. Microsoft OAuth (Outlook) — optional
[Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration** → multitenant + personal accounts → redirect URI `https://YOUR_PUBLIC_URL/auth/microsoft/callback` → add client secret → API permissions → Microsoft Graph delegated: `Mail.Read`, `User.Read`, `offline_access`. Copy into the `MS_*` vars.

### 5. Database (pick one)

| Option | Steps |
|---|---|
| 🅰️ **Managed free tiers** *(recommended, no install)* | Free [Neo4j AuraDB](https://neo4j.com/cloud/aura-free/) + free Postgres on [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app). Paste connection strings into `.env`. |
| 🅱️ **Docker (DBs only)** | `docker compose up -d postgres neo4j` |
| 🅲 **Native install** | [Postgres](https://www.postgresql.org/download/) + [Neo4j](https://neo4j.com/download/), then point `.env` at them. |

Set `DATABASE_URL`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` in `.env`.

### 6. Run

**Docker — full stack:**
```bash
docker compose up -d --build
# Starts Postgres + Neo4j + app. Migrations run automatically.
```

**Node (no Docker):**
```bash
npm install
npx prisma migrate deploy
npm run build
npm run start:prod   # or: npm run start:dev (watch mode)
```

A healthy start logs: `Compose HITL graph ready`, `Scheduler HITL graph ready`, `Telegram bot started`.

---

## 💬 Using Knot

```
/connect_gmail        Link Gmail + Calendar
/connect_outlook      Link Outlook / Microsoft (optional)
```

### Command reference

| Command | Purpose |
|---|---|
| `/start` | Help & onboarding |
| `/connect_gmail` / `/disconnect_gmail` | Gmail + Calendar |
| `/connect_outlook` / `/disconnect_outlook` | Outlook |
| `/meetings today\|tomorrow` | Calendar list |
| `/next meeting` | Next meeting + full briefing |
| `/schedule <who + when>` | Schedule a meeting |
| `/briefings on\|off\|test` | Proactive pre-meeting pings |
| `/draft <instruction>` | Draft an email directly |
| `/pending` | Drafts awaiting your approval |
| `/graph` | Live knowledge graph (Telegram Mini App) |
| `/settings` / `/scope` / `/range` | Preferences |

### Knowledge graph
`/graph` opens the Neo4j visualiser inside Telegram.
Direct URL: `https://YOUR_PUBLIC_URL/viz.html?userId=tg-<your-telegram-id>`
Neo4j Browser also works at `http://localhost:7474`.

---

## 🌐 Deployment Notes

- **Fixed public HTTPS URL is required** — for OAuth callbacks and the Telegram Mini App. Use Caddy or Nginx as a reverse proxy with TLS.
- If your URL changes (new ngrok tunnel in dev), update `PUBLIC_URL`, `GOOGLE_REDIRECT_URI`, `MS_REDIRECT_URI`, **and** the redirect URIs in Google Cloud + Azure consoles.
- The app polls Telegram — no inbound webhook needed. Only the OAuth callbacks and `/viz.html` must be publicly reachable.
- **Change the default Neo4j password** in `docker-compose.yml` + `NEO4J_PASSWORD` before any production deployment.

---

## 📁 Project Structure

```
src/
  agent/        Supervisor + specialists (chat, search, gmail, outlook,
                calendar, compose*, scheduler*, chat_tracker) + HITL graphs
  calendar/     Calendar read, briefings, briefing cron scheduler
  gmail/        Gmail OAuth + read/send
  outlook/      Microsoft Graph OAuth + read
  graph/        Neo4j knowledge graph
  llm/          Model-tier abstraction (chat / fast / smart)
  settings/     Per-user preferences (Prisma)
  telegram/     Telegram bot (commands + inline buttons)
prisma/         Schema + migrations
public/         viz.html — graph viewer
```

`*` = human-in-the-loop flows (LangGraph + Postgres checkpointer).

---

## 🗺️ Roadmap

- [ ] Daily digest scheduler (overnight email + open commitments)
- [ ] Slack connector
- [ ] Richer cross-channel identity resolution
- [ ] Persistent long-term conversation memory

Have a feature idea? [Open an issue](https://github.com/Ajitesh1405/knot/issues) — contributions welcome.

---

## 🤝 Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push: `git push origin feat/your-feature`
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## 🙏 Acknowledgements

Built with [NestJS](https://nestjs.com/), [LangChain](https://www.langchain.com/), [LangGraph](https://www.langchain.com/langgraph), [Anthropic Claude](https://anthropic.com/), [Neo4j](https://neo4j.com/), [Prisma](https://www.prisma.io/), and the [Telegram Bot API](https://core.telegram.org/bots/api).

---

⭐ **If Knot saves you time, a star helps others find it — thank you!**
