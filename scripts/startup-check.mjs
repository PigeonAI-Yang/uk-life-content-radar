import { spawn } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

const appPath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptPath = resolve('artifacts', 'task-receipts', 'TASK-000', 'startup.json');
if (!existsSync(appPath)) throw new Error(`打包应用不存在: ${appPath}`);
mkdirSync(resolve(receiptPath, '..'), { recursive: true });

const child = spawn(appPath, [], {
  env: { ...process.env, CONTENT_TERMINAL_SMOKE_FILE: receiptPath },
  stdio: 'inherit'
});
const timer = setTimeout(() => child.kill(), 30_000);
const exitCode = await new Promise((resolveExit) => child.once('exit', resolveExit));
clearTimeout(timer);
if (exitCode !== 0 || !existsSync(receiptPath)) throw new Error(`应用启动检查失败: ${exitCode}`);
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
if (receipt.ready !== true) throw new Error('应用未报告 ready');
console.log(`打包应用启动通过，版本 ${receipt.version}`);
