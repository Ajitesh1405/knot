# Knot — Mobile / Web API

REST API for the Knot assistant, designed for a mobile (or web) front-end.
Everything a client needs lives under `/api/*`. The Telegram bot keeps working
unchanged alongside it.

- **Base URL (dev):** `http://localhost:3038`
- **Auth:** JWT Bearer tokens. Send `Authorization: Bearer <accessToken>` on
  every `/api/*` route except `register`, `login`, and `refresh`.
- **Content type:** `application/json`.
- **CORS:** all origins allowed by default; set `CORS_ORIGINS` to lock down a
  web front-end.

---

## Authentication

Accounts are email + password. On success you get a short-lived **access
token** (default 1h) and a long-lived **refresh token** (default 30d). Store
both securely on the device (e.g. Keychain / Keystore / encrypted storage).

The server never trusts a client-supplied user id — the identity is taken from
the token. A user can only ever act as themselves.

### `POST /api/auth/register`
```json
{ "email": "a@b.com", "password": "min 8 chars", "name": "optional" }
```
**201** →
```json
{
  "accessToken": "…", "refreshToken": "…",
  "tokenType": "Bearer", "expiresIn": 3600,
  "user": { "id": "usr-…", "email": "a@b.com", "name": "…", "createdAt": "…" }
}
```
Errors: `409` email already registered, `400` validation.

### `POST /api/auth/login`
```json
{ "email": "a@b.com", "password": "…" }
```
**200** → same shape as register. `401` on bad credentials.

### `POST /api/auth/refresh`
```json
{ "refreshToken": "…" }
```
**200** → a fresh token pair. Call this when an access token expires (on a
`401`), then retry the original request. `401` if the refresh token is invalid
or expired (→ send the user back to login).

### `GET /api/auth/me`  *(auth)*
**200** → `{ "id": "usr-…", "email": "…", "name": "…", "createdAt": "…" }`

---

## Assistant

### `POST /api/agent/message`  *(auth)*
The main chat endpoint — natural language in, assistant reply out.
```json
{ "text": "what meetings do I have tomorrow?" }
```
**200** → `{ "answer": "…" }`

> Some actions (composing an email, scheduling a meeting) start a Human-In-The-
> Loop flow. The reply acknowledges it; the pending item then shows up under
> **Drafts** for the user to approve/edit/cancel.

### `GET /api/agent/memory`  *(auth)*
The user's knowledge graph. **200** → `{ "nodes": [...], "edges": [...] }`.
Use this to render the graph view.

### `GET /api/agent/meetings?range=today`  *(auth)*
`range` ∈ `today` (default) | `tomorrow` | `this_week`.
**200** → `{ "range": "today", "text": "…summary…" }`
(Requires the user to have connected Google Calendar.)

### Email drafts (Human-in-the-loop)
- `GET  /api/agent/drafts` → `{ "drafts": [ { id, recipient, subject, status, createdAt } ] }`
- `POST /api/agent/drafts/:id/approve` → sends it
- `POST /api/agent/drafts/:id/cancel` → discards it
- `POST /api/agent/drafts/:id/edit`
  ```json
  { "body": "full replacement text" }      // send verbatim
  // — or —
  { "instruction": "make it more formal" }  // let the AI revise
  ```
Acting on a draft that isn't yours → `403`; unknown id → `404`.

---

## Settings

### `GET /api/settings`  *(auth)*
```json
{
  "scope": "personal", "emailRange": "new_only", "briefingsEnabled": false,
  "gmailConnected": false, "outlookConnected": false, "updatedAt": "…"
}
```

### `PATCH /api/settings`  *(auth)*
Send any subset:
```json
{ "scope": "everything", "emailRange": "last_30_days", "briefingsEnabled": true }
```
- `scope`: `personal` | `everything`
- `emailRange`: `new_only` | `last_30_days` | `last_year` | `all`
- `briefingsEnabled`: boolean (pre-meeting push briefings)

**200** → the updated settings (same shape as GET).

---

## Integrations (Gmail / Outlook)

Linking uses the provider's OAuth consent screen in a browser/webview.

1. `GET /api/integrations/google/connect-url` *(auth)* →
   `{ "url": "https://accounts.google.com/…" }`
   (Outlook: `GET /api/integrations/microsoft/connect-url`)
2. Open that URL in an in-app browser / system browser.
3. The user consents; the provider redirects to the server's callback, which
   stores the tokens for this user and shows a "you can close this tab" page.
4. Poll `GET /api/integrations` to detect completion:
   ```json
   {
     "google": { "connected": true },
     "microsoft": { "connected": false, "configured": true }
   }
   ```
5. Disconnect: `DELETE /api/integrations/google` (or `/microsoft`) → `{ "ok": true }`.

> Tip: after step 2, listen for the browser returning to the foreground, then
> refetch `/api/integrations`.

---

## Errors

Standard NestJS error envelope:
```json
{ "statusCode": 400, "message": "Validation failed",
  "errors": [ { "field": "password", "message": "Password must be at least 8 characters" } ] }
```
Common codes: `400` validation, `401` missing/expired/invalid token,
`403` not your resource, `404` not found, `409` conflict (duplicate email).

---

## Environment

New variables (see `.env.example`):

| var | purpose |
|-----|---------|
| `JWT_SECRET` | **required** — signing key for tokens (long random string) |
| `JWT_ACCESS_TTL` | access token lifetime, seconds (default 3600) |
| `JWT_REFRESH_TTL` | refresh token lifetime, seconds (default 2592000) |
| `PORT` | server port (default 3038) |
| `CORS_ORIGINS` | comma-separated web origins; unset = allow all |

## Quick smoke test
```bash
BASE=http://localhost:3038
curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"supersecret1","name":"Me"}'
# → copy accessToken, then:
curl -s $BASE/api/auth/me -H "Authorization: Bearer <accessToken>"
```
