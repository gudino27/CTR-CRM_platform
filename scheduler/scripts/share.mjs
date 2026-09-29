import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '';
// Same PORT as .env; docker-compose publishes the container on it
const port = Number(/^PORT=(\d+)/m.exec(env)?.[1] ?? 3000);
if (!/^BASIC_AUTH=\S+/m.test(env)) {
  console.warn('Warning: BASIC_AUTH is not set in .env, so anyone with the URL can use the app.\n');
}

const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
tunnel.on('error', () => {
  const install = {
    darwin: 'brew install cloudflared',
    win32: 'winget install --id Cloudflare.cloudflared',
  }[process.platform] ?? 'see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
  console.error(`cloudflared was not found. Install it (${install}), then open a new terminal.`);
  process.exit(1);
});

let started = false;
tunnel.stderr.on('data', (chunk) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
  if (!url || started) return;
  started = true;

  console.log(`Tunnel: ${url}\nStarting the app in Docker (first build takes a few minutes)...`);
  const up = spawnSync('docker', ['compose', 'up', '-d', '--build'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, APP_URL: url },
  });
  if (up.status !== 0) {
    console.error('docker compose up failed');
    stop(1);
  }
  console.log(`\nShare this link: ${url}\nPress Ctrl+C to stop sharing (stops the tunnel and the container; data is kept).`);
});

tunnel.on('exit', (code) => {
  if (!started) console.error(`cloudflared exited (${code}) before giving a URL`);
  stop(code ?? 1);
});

function stop(code = 0) {
  tunnel.kill();
  spawnSync('docker', ['compose', 'stop'], { cwd: root, stdio: 'inherit' });
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
