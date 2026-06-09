# 🛠️ Knot — Setup Guide (all options)

Pick the path that fits you. Every path produces the same running app; only **where the databases live** and **how you launch** differ.

```
1. Common setup    → tokens, OAuth, .env        (everyone does this)
2. Databases       → A) Managed cloud  B) Docker  C) Native install   (pick ONE)
3. Run             → A) Docker full-stack   B) Plain Node             (pick ONE)
```

> **No Docker?** Use **Databases → A (Managed cloud)** + **Run → B (Plain Node)**. It's the least setup.

---

## 1 · Common setup (everyone)

```bash
git clone <your-repo-url> knot && cd knot
cp .env.example .env
```

### 1.1 Telegram bot token
Open [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts → copy the token into `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABC-yourBotToken
```

### 1.2 LLM key
```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxx
```
(OpenRouter/Ollama also supported — see `.env.example`.)

### 1.3 Public HTTPS URL
OAuth callbacks and the in-Telegram graph viewer need a public HTTPS origin.
- **Production:** your domain, e.g. `https://knot.yourdomain.com` (put TLS in front — see README → Deployment).
- **Dev/testing:** an [ngrok](https://ngrok.com) tunnel, e.g. `ngrok http 3038` → use the `https://…ngrok…` URL.

```
PUBLIC_URL=https://YOUR_PUBLIC_URL
```

### 1.4 Google OAuth (Gmail + Calendar)
1. [Google Cloud Console](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs** → add: `https://YOUR_PUBLIC_URL/auth/google/callback`
5. **OAuth consent screen** → add scopes `gmail.readonly`, `gmail.send`, `calendar.readonly`, `calendar.events` → add your Google account under **Test users**.
6. Copy values into `.env`:
```
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
GOOGLE_REDIRECT_URI=https://YOUR_PUBLIC_URL/auth/google/callback
```

> **⚠️ You do NOT need Google to "verify" the app for personal use.** While the
> consent screen is in **Testing**, add yourself under **Test users** and you can
> use Gmail/Calendar scopes immediately. Two things to know:
> - During `/connect_gmail` you'll see an **"unverified app"** warning →
>   **Advanced → Go to {app} → Continue**. Expected for a self-hosted app.
> - **In Testing mode, refresh tokens expire after ~7 days**, so the bot loses
>   access weekly. To avoid that, click **Publish app** (→ "In production") on the
>   OAuth consent screen — for a personal project where you own the Cloud project,
>   this works right away and **still doesn't require formal verification**. Full
>   verification (security assessment) is only needed to let *other people's*
>   accounts connect without warnings.

### 1.5 Microsoft OAuth (Outlook) — optional
[Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**:
- Account types: **any org directory + personal Microsoft accounts**
- Redirect URI (Web): `https://YOUR_PUBLIC_URL/auth/microsoft/callback`
- **Certificates & secrets → New client secret** → copy the **Value**
- **API permissions → Microsoft Graph → Delegated**: `Mail.Read`, `User.Read`, `offline_access`
```
MS_CLIENT_ID=xxxx
MS_CLIENT_SECRET=xxxx
MS_REDIRECT_URI=https://YOUR_PUBLIC_URL/auth/microsoft/callback
```

---

## 2 · Databases — pick ONE

You need a **Postgres** database and a **Neo4j** instance. Set their connection details in `.env`.

### Option A — Managed cloud (no install, no Docker) ⭐ recommended without Docker

**Neo4j → AuraDB Free**
1. [neo4j.com/cloud/aura-free](https://neo4j.com/cloud/aura-free/) → create a **Free** instance.
2. **Download/copy the credentials** when shown (you only see the password once).
3. In `.env`:
   ```
   NEO4J_URI=neo4j+s://xxxxxxxx.databases.neo4j.io
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your-aura-password
   ```

**Postgres → Neon (or Supabase / Railway) Free**
1. [neon.tech](https://neon.tech) → create a project → copy the connection string.
2. In `.env` (keep `?sslmode=require` if the provider needs it):
   ```
   DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
   ```

➡️ Now go to **Run → Option B (Plain Node)**.

---

### Option B — Docker for just the databases

Run only the DB containers, then run the app with Node:
```bash
docker compose up -d postgres neo4j
```
Defaults match `.env.example` (`localhost`):
```
DATABASE_URL=postgresql://knot:knot@localhost:5432/knot?schema=public
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=please-change-me
```
➡️ Now go to **Run → Option B (Plain Node)** — or use **Run → Option A** to containerize the app too.

---

### Option C — Install natively

**Postgres**
1. Install: [postgresql.org/download](https://www.postgresql.org/download/) (Win/Mac/Linux) — or `brew install postgresql`, `apt install postgresql`.
2. Create a database and user:
   ```bash
   createdb knot
   # or in psql:  CREATE DATABASE knot; CREATE USER knot WITH PASSWORD 'knot'; GRANT ALL ON DATABASE knot TO knot;
   ```
3. `.env`:
   ```
   DATABASE_URL=postgresql://knot:knot@localhost:5432/knot?schema=public
   ```

**Neo4j**
1. Install [Neo4j Desktop](https://neo4j.com/download/) (easiest) or [Community Server](https://neo4j.com/deployment-center/).
2. Create/start a local DB and set a password.
3. `.env`:
   ```
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your-local-password
   ```
➡️ Now go to **Run → Option B (Plain Node)**.

---

## 3 · Run — pick ONE

### Option A — Docker, full stack (one command)
Starts Postgres + Neo4j + the app; migrations run automatically on boot.
```bash
docker compose up -d --build
```
> Inside Docker the app uses the service hostnames (`postgres`, `neo4j`) automatically — your `.env` can keep `localhost`. Use this with **Databases → B**.

### Option B — Plain Node (no Docker for the app)
Works with **any** database from step 2 (managed, Docker-DBs, or native):
```bash
npm install
npx prisma migrate deploy    # creates all tables on a fresh database
npm run build
npm run start:prod           # production
# or, for development with auto-reload:
npm run start:dev
```

✅ **Healthy start** prints:
```
Compose HITL graph ready
Scheduler HITL graph ready
Telegram bot started (polling mode)
```

---

## 4 · First use

In Telegram, message your bot:
```
/start
/connect_gmail        → approve the Google account you want Knot to use
/connect_outlook      → optional
```
Then just talk: `what's on my calendar tomorrow`, `reply to Sarah saying thanks`, `schedule 30 min with Aditi tomorrow morning`, `/graph`.

See the **README** for the full command + natural-language reference.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| OAuth "redirect_uri_mismatch" | The redirect URI in Google/Azure must **exactly** match `*_REDIRECT_URI` in `.env` (scheme, host, path, no trailing slash). |
| `prisma migrate deploy` can't connect | Check `DATABASE_URL`; for cloud Postgres add `?sslmode=require`. |
| Neo4j connection fails | AuraDB uses `neo4j+s://` (TLS); local uses `bolt://`. Verify user/password. |
| Bot reads the wrong account's mail/calendar | `/disconnect_gmail` then `/connect_gmail` and pick the correct account at Google's chooser. |
| ngrok URL changed | Update `PUBLIC_URL` + both `*_REDIRECT_URI` in `.env` **and** the console redirect URIs. |
| Telegram bot silent | Confirm `TELEGRAM_BOT_TOKEN`; only one instance can poll a token at a time. |
