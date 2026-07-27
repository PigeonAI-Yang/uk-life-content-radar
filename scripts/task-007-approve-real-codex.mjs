import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const result = JSON.parse(readFileSync(resolve('artifacts', 'task-receipts', 'TASK-007', 'codex-preapproval-result.json'), 'utf8'));
const run = JSON.parse(readFileSync(resolve('artifacts', 'task-receipts', 'TASK-007', 'result.json'), 'utf8'));
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
spawn(executablePath, [`--user-data-dir=${run.profilePath}`, '--remote-debugging-port=9241'], { detached: true, stdio: 'ignore' }).unref();
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9241'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('人工批准窗口未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
await page.getByRole('button', { name: '发布包', exact: true }).click();
await page.getByRole('button', { name: '刷新候选' }).click();
await page.locator('select[aria-label="待批准候选"]').selectOption(result.candidateId);
await page.getByRole('button', { name: '加载候选' }).click();
await page.getByRole('button', { name: '人工批准' }).click();
await page.getByText('人工批准已绑定当前指纹').waitFor();
await page.screenshot({ path: resolve('artifacts', 'task-receipts', 'TASK-007', 'real-codex-human-approval.png'), fullPage: true });
await browser.close();
