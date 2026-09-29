// Runs the API and the Vite dev server together on any OS 
import { spawn } from 'node:child_process';

const children = ['server', 'client'].map((workspace) =>
  // One command string: npm is npm.cmd on Windows, which needs a shell
  spawn(`npm run dev --workspace ${workspace}`, { stdio: 'inherit', shell: true }));

function stop(code = 0) {
  for (const child of children) child.kill();
  process.exit(code);
}
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
