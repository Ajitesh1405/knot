# Knot Mobile API

REST API that lets a mobile app use Knot without Telegram. Base path: **`/mobile`**.
All bodies are JSON. All protected endpoints require a bearer token:

```
Authorization: Bearer <token>
```

---

## Auth flow (pairing)

Knot has no passwords. A device is paired via a one-time code issued from Telegram:

1. In the Telegram bot, the user sends **`/pair`** → bot replies with a **6-digit code** (valid 10 min, single use).
2. The app calls `POST /mobile/auth/pair` with that code → receives a long-lived **bearer token**.
3. The app stores the token and sends it on every subsequent request.

> The token maps to the user's `userId` (e.g. `tg-12345678`). One token per paired device; a user can pair multiple devices.

---

## Endpoints

### `POST /mobile/auth/pair`  · public
Exchange a pairing code for a token.
```jsonc
// request
{ "code": "428193", "deviceName": "Pixel 8" }   // deviceName optional
// 200
{ "token": "e3f1…(64 hex)", "userId": "tg-12345678" }
// 400 — invalid/expired code
{ "statusCode": 400, "message": "Pairing code expired. Run /pair again." }
```

### `POST /mobile/auth/unpair`  · auth
Revoke the current device's token.
```jsonc
{ "ok": true }
```

### `GET /mobile/me`  · auth
```jsonc
{
  "userId": "tg-12345678",
  "gmailConnected": true,
  "settings": { "scope": "personal", "emailRange": "new_only", "briefingsEnabled": false }
}
```

### `POST /mobile/chat`  · auth
The catch-all. Send natural language; the agent routes it (email, calendar, memory,
scheduling, drafting, etc.) exactly like the Telegram bot. **Start here — most features
are reachable through this one endpoint.**
```jsonc
// request
{ "message": "any emails from Sarah today?" }
// 200
{ "reply": "Yes — Sarah sent 2 emails this morning about…" }
```
> Note: drafting/scheduling replies are human-in-the-loop. When the user asks to draft
> or send, the draft is created and appears under `GET /mobile/drafts` for approval —
> `chat` returns an acknowledgement, it does **not** send anything.

### `GET /mobile/emails?range=today|this_week|all`  · auth
```jsonc
{ "emails": [
  { "id": "18f…", "threadId": "18f…", "from": "Sarah <sarah@acme.com>",
    "subject": "Deck", "date": "Wed, 2 Jul 2026 09:12:00 +0530", "snippet": "Can you…" }
] }
```

### `GET /mobile/meetings?range=today|tomorrow|this_week`  · auth
```jsonc
{ "text": "📅 10:00 — Standup — team\n14:00 — 1:1 with Aditi" }
```

### `GET /mobile/drafts`  · auth
Drafts awaiting the user's approval (human-in-the-loop).
```jsonc
{ "drafts": [
  { "id": "uuid", "status": "awaiting_approval", "kind": "approve",
    "recipient": "Sarah Mehta", "subject": "Re: Deck",
    "body": "Hi Sarah, I'll send it Friday…", "createdAt": "2026-07-02T…Z" },
  { "id": "uuid", "status": "awaiting_sender", "kind": "choose_sender",
    "recipient": "sarah", "candidates": [ { "index": 0, "address": "sarah@acme.com", … } ],
    "createdAt": "…" }
] }
```

### `POST /mobile/drafts/:id/approve`  · auth
Sends the draft.
```jsonc
{ "id": "uuid", "state": "sent", "recipient": "Sarah Mehta" }
```

### `POST /mobile/drafts/:id/cancel`  · auth
```jsonc
{ "id": "uuid", "state": "cancelled" }
```

### `POST /mobile/drafts/:id/edit`  · auth
Revise a draft, then it returns to `awaiting_approval`.
```jsonc
// mode "ai" → the model revises using your instruction
{ "mode": "ai", "text": "make it shorter and warmer" }
// mode "replace" → your text becomes the email body verbatim
{ "mode": "replace", "text": "Hi Sarah, sending Friday. Thanks!" }
// 200
{ "id": "uuid", "state": "awaiting", "kind": "approve" }
```

### `GET /mobile/settings`  · auth
```jsonc
{ "scope": "personal", "emailRange": "new_only", "briefingsEnabled": false }
```

### `PATCH /mobile/settings`  · auth
Any subset of fields.
```jsonc
// request
{ "briefingsEnabled": true, "emailRange": "last_30_days", "scope": "everything" }
// 200 — returns the updated settings
{ "scope": "everything", "emailRange": "last_30_days", "briefingsEnabled": true }
```
`scope`: `personal | everything` · `emailRange`: `new_only | last_30_days | last_year | all`

---

## Errors
- `401 Unauthorized` — missing/invalid token → re-pair.
- `400 Bad Request` — validation error or a domain error (e.g. "Gmail not connected"); read `message`.

## Notes for the FE team
- **`POST /mobile/chat` is the backbone** — you can ship a chat-first app against just `auth/pair` + `chat` + `drafts`, and layer the typed endpoints (`emails`, `meetings`, `settings`) as richer screens.
- Draft flow is **HITL**: nothing sends without an explicit `approve`. Poll `GET /mobile/drafts` (push notifications are a later phase).
- `userId` format is `tg-<telegramId>` today; treat it as an opaque string.
