// 开发启动脚本：从 .env.local / 环境变量读取 DEPLOY_RUN_PORT，禁止硬编码端口
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readPort() {
  if (process.env.DEPLOY_RUN_PORT) return process.env.DEPLOY_RUN_PORT;
  const envFile = resolve(root, '.env.local');
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*DEPLOY_RUN_PORT\s*=\s*(.+?)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const port = readPort();
const nextBin = resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = [nextBin, 'dev'];
if (port) args.push('--port', port);

const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
