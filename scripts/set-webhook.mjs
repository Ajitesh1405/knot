// Register (or clear) the Telegram webhook for a deployed Knot instance.
//
//   npm run webhook:set              # set webhook to $PUBLIC_URL/telegram/webhook
//   npm run webhook:set -- --delete  # remove the webhook (back to polling/dev)
//
// Talks to the Telegram Bot API directly, so it works from your laptop against
// the production bot without booting the app. Reads .env for the token, URL,
// and optional secret.
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

const del = process.argv.includes('--delete');
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

async function main() {
  if (del) {
    const res = await fetch(api('deleteWebhook'), { method: 'POST' });
    console.log('deleteWebhook →', await res.json());
    return;
  }

  const base = process.env.PUBLIC_URL;
  if (!base) {
    console.error('PUBLIC_URL is not set in .env — cannot build the webhook URL.');
    process.exit(1);
  }
  const url = `${base.replace(/\/+$/, '')}/telegram/webhook`;

  const body = { url, allowed_updates: ['message', 'callback_query'] };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) body.secret_token = secret;

  const res = await fetch(api('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log(`setWebhook → ${url}`);
  console.log(json);
  if (!json.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
