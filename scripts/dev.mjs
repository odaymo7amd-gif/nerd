// تشغيل الخادم والواجهة معًا في التطوير
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function start(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`[dev] توقف ${name} بالرمز ${code}`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 150);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const tsxCli = 'node_modules/tsx/dist/cli.mjs';
const viteCli = 'node_modules/vite/bin/vite.js';

start('الخادم', [tsxCli, 'watch', 'server/index.ts']);
start('الواجهة', [viteCli]);
