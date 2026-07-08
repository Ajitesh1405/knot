# Deploying Knot to Vercel

Knot was built as an always-on process (a long-polling Telegram bot + an
in-process cron). Vercel is **serverless** — functions spin up per request and
die seconds later — so a few things are wired differently in this setup:

| Concern            | Local / always-on          | Vercel (serverless)                             |
| ------------------ | -------------------------- | ----------------------------------------------- |
| Telegram updates   | long-polling (`polling`)   | **webhook** → `POST /telegram/webhook`          |
| Meeting briefings  | in-process `@Cron` (5 min) | **Vercel Cron** → `GET /cron/briefing`          |
| HTTP server        | `main.ts` `app.listen()`   | `api/index.ts` serverless handler (cached)      |
| Postgres           | embedded / local           | **hosted + pooled** (Neon)                       |
| Neo4j              | local Docker               | **Neo4j Aura**                                   |
| LLM                | Anthropic                  | **Gemini** (free tier, `LLM_PROVIDER=gemini`)   |

The bot auto-selects webhook mode when `VERCEL=1` is present (Vercel sets this
automatically). No code change needed to switch.

## 1. Provision managed data stores

- **Postgres → [Neon](https://neon.tech):** create a database, copy the
  **pooled** connection string (host contains `-pooler`) into `DATABASE_URL`.
- **Neo4j → [Aura Free](https://neo4j.com/cloud/aura-free/):** create an
  instance, set `NEO4J_URI` (`neo4j+s://…`), `NEO4J_USER`, `NEO4J_PASSWORD`.

Run migrations once against Neon (from your laptop):

```bash
DATABASE_URL="<neon-pooled-url>" npm run db:deploy
```

## 2. Import the project on Vercel

- **Root Directory:** set it to `knot` (this folder), not the repo root.
- Build command / install are picked up from `vercel.json` + `package.json`
  (`vercel-build` runs `prisma generate && nest build`).

## 3. Environment variables (Vercel → Settings → Environment Variables)

Set everything from `.env.example`. The must-haves for Vercel:

```
LLM_PROVIDER=gemini
GOOGLE_API_KEY=...              # https://aistudio.google.com/apikey
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...     # long random string
CRON_SECRET=...                 # long random string (Vercel Cron auth)
DATABASE_URL=...                # Neon pooled URL
NEO4J_URI=... NEO4J_USER=... NEO4J_PASSWORD=...
PUBLIC_URL=https://<your-app>.vercel.app
JWT_SECRET=...
# Google/Microsoft OAuth client IDs + secrets, with redirect URIs pointing
# at https://<your-app>.vercel.app/auth/{google,microsoft}/callback
```

Also update the OAuth redirect URIs in Google Cloud / Azure to the Vercel URL.

## 4. Deploy, then register the Telegram webhook (one-time)

After the first deploy, point Telegram at your webhook. Either:

```bash
# from your laptop, with .env pointing at PUBLIC_URL + TELEGRAM_WEBHOOK_SECRET
npm run webhook:set
# undo (back to polling for local dev):  npm run webhook:set -- --delete
```

or hit the app endpoint once:

```bash
curl -X POST https://<your-app>.vercel.app/telegram/setup \
  -H "X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>"
```

The Vercel Cron for briefings is declared in `vercel.json` and is active
automatically once deployed (Production).

## Known serverless caveats (by design)

- **No proactive timers.** Features relying on in-memory timers within a single
  process — the 1-hour draft-expiry notice and some HITL approval flows — won't
  fire between invocations. Request/response and webhook-driven flows work; the
  timer-based nudges do not, unless moved to a durable store + cron.
- **Cold starts.** First request after idle re-creates the Nest app (and runs
  the LangGraph checkpointer `.setup()`), adding latency. It's cached on warm
  instances.
- **Connections.** Use Neon's **pooled** string; each cold start opens fresh
  DB/Neo4j connections. Keep an eye on Aura's connection limits under load.
- **maxDuration.** `vercel.json` sets 60s. Long agent turns near that limit
  will be cut off (Hobby plan caps lower — bump the plan if needed).

If these caveats matter, an always-on host (Railway / Render / Fly.io) runs the
original polling + `@Cron` architecture unchanged — only the DBs need hosting.
