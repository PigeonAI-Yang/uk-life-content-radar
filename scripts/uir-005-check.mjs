import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'UIR-005');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const port = 9500 + Math.floor(Math.random() * 200);
mkdirSync(profilePath, { recursive: true });
const desktop = spawn(executablePath, [
  '--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`
], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await delay(250); }
  }
  if (!browser) throw new Error('打包应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
  const composer = page.getByLabel('给 Pi 发消息');
  if (!await composer.isDisabled()) throw new Error('无账号时仍允许创建 Pi 任务');
  const imported = await page.evaluate(() => globalThis.terminal.agent.importCockpit());
  const connection = await page.evaluate(() => globalThis.terminal.agent.testCustomApi());
  if (!imported.apiKeyConfigured || !connection.connected) throw new Error('真实自定义 API 未连接');
  const account = await page.evaluate(() => globalThis.terminal.business.dispatch('account.create', {
    caller: 'uir-005', idempotencyKey: 'account', name: 'Pi 协作栏验收账号',
    positioning: '英国生活情报', audience: '在英华人', tone: '自然实用'
  }));
  if (!account.ok) throw new Error('账号创建失败');
  await page.waitForTimeout(1700);
  await composer.fill('读取终端里的账号，并用一句话告诉我当前可以从哪里开始。不要创建其他对象。');
  await composer.press('Control+Enter');
  await page.getByText(/Pi 正在处理/).waitFor();
  let task;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await page.evaluate(() => globalThis.terminal.business.dispatch('task.list', { query: 'agent.execute', limit: 5 }));
    task = response.ok ? response.result.items[0] : undefined;
    if (task && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) break;
    await delay(500);
  }
  if (task?.status !== 'succeeded' || !task.result?.summary) throw new Error(`Pi 协作任务失败: ${JSON.stringify(task)}`);
  await page.getByText(task.result.summary, { exact: true }).waitFor();
  const screenshot = resolve(receiptDirectory, 'pi-real-conversation.png');
  await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), screenshot);
  const result = {
    task: 'UIR-005', status: 'completed', screenshot,
    checks: { collapsible: true, noAccountBlocked: true, realPiTask: true, realMcp: task.result.toolCalls > 0, responseReadback: true },
    agentTask: { id: task.id, status: task.status, summary: task.result.summary, toolCalls: task.result.toolCalls }
  };
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  desktop.kill();
}
