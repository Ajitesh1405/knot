// Public HTTPS tunnel for Knot — wraps ngrok so you don't fight PATH or flags.
//
//   npm run tunnel
//
// Reads PUBLIC_URL from .env for the reserved domain and forwards it to the
// local app port (3038). Finds the ngrok binary on PATH, or falls back to the
// winget install location if PATH hasn't refreshed in this shell yet.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APP_PORT = process.env.PORT ?? '3038';

const publicUrl = process.env.PUBLIC_URL;
if (!publicUrl) {
  console.error('PUBLIC_URL is not set in .env — cannot pick a tunnel domain.');
  process.exit(1);
}
// ngrok wants the bare host (no scheme / trailing slash).
const domain = publicUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

// Prefer ngrok on PATH; otherwise look where winget installs it.
function resolveNgrok() {
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const pkgRoot = join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      const dir = readdirSync(pkgRoot).find((d) => d.startsWith('Ngrok.Ngrok'));
      if (dir) {
        const exe = join(pkgRoot, dir, 'ngrok.exe');
        if (existsSync(exe)) return exe;
      }
    } catch {
      /* Packages dir may not exist — fall through to bare 'ngrok'. */
    }
  }
  return 'ngrok'; // rely on PATH
}

const ngrok = resolveNgrok();
const args = ['http', `--url=https://${domain}`, APP_PORT];

console.log(`Starting tunnel: https://${domain}  ->  http://localhost:${APP_PORT}`);
console.log(`(${ngrok} ${args.join(' ')})\n`);

const child = spawn(ngrok, args, { stdio: 'inherit' });

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      '\nngrok not found. Install it with `winget install ngrok.ngrok`, ' +
        'then run `ngrok config add-authtoken <token>` once.',
    );
  } else {
    console.error('Failed to start ngrok:', err.message);
  }
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
