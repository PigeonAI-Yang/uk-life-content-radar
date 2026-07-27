import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-003');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

async function launch(port) {
  const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) throw new Error(`TASK-003 应用调试端口未就绪: ${port}`);
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('TASK-003 业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  return { browser, child, page };
}

async function dispatch(page, name, input) {
  return page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
}

async function waitForStatus(page, id, expected) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await dispatch(page, 'task.get', { taskId: id });
    if (result.ok && result.result.status === expected) return result.result;
    await delay(100);
  }
  throw new Error(`任务 ${id} 未进入状态 ${expected}`);
}

const first = await launch(9235);
await first.page.evaluate((path) => globalThis.terminal.settings.initializeRoot(path), rootPath);

const succeededStart = await dispatch(first.page, 'task.start', {
  caller: 'task-003',
  idempotencyKey: 'succeeded',
  type: 'file.write',
  parameters: { relativePath: 'sources/succeeded.txt', content: '成功产物', durationMs: 50 }
});
if (!succeededStart.ok) throw new Error(`成功任务创建失败: ${JSON.stringify(succeededStart)}`);
const succeeded = await waitForStatus(first.page, succeededStart.result.id, 'succeeded');
const succeededPath = resolve(rootPath, 'sources', 'succeeded.txt');
if (readFileSync(succeededPath, 'utf8') !== '成功产物') throw new Error('成功任务磁盘内容不一致');
const completedCancel = await dispatch(first.page, 'task.cancel', { taskId: succeeded.id });
if (completedCancel.ok || completedCancel.error.code !== 'TASK_COMPLETED') throw new Error('提交后取消未返回任务已完成');

const cancelledStart = await dispatch(first.page, 'task.start', {
  caller: 'task-003',
  idempotencyKey: 'cancelled',
  type: 'file.write',
  parameters: { relativePath: 'sources/cancelled.txt', content: '不得提交', durationMs: 5000 }
});
if (!cancelledStart.ok) throw new Error('取消任务创建失败');
await waitForStatus(first.page, cancelledStart.result.id, 'running');
const cancelledResult = await dispatch(first.page, 'task.cancel', { taskId: cancelledStart.result.id });
if (!cancelledResult.ok || cancelledResult.result.status !== 'cancelled') throw new Error('提交点前取消失败');
if (existsSync(resolve(rootPath, 'sources', 'cancelled.txt'))) throw new Error('已取消任务留下完成产物');

const interruptedStart = await dispatch(first.page, 'task.start', {
  caller: 'task-003',
  idempotencyKey: 'interrupted',
  type: 'file.write',
  parameters: { relativePath: 'sources/interrupted.txt', content: '中断临时内容', durationMs: 20000 }
});
if (!interruptedStart.ok) throw new Error('中断任务创建失败');
const running = await waitForStatus(first.page, interruptedStart.result.id, 'running');
const temporaryPath = String(running.temporaryResult).replace(/^pending:/, '');
if (!existsSync(temporaryPath)) throw new Error('运行中任务没有真实临时文件');

await first.page.getByRole('button', { name: '任务' }).click();
await first.page.getByRole('button', { name: '刷新' }).click();
await first.page.getByText('running', { exact: true }).waitFor();
await first.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'running.png'));
await first.browser.close();
first.child.kill();
await delay(1000);

const second = await launch(9236);
const interrupted = await waitForStatus(second.page, interruptedStart.result.id, 'interrupted');
if (!String(interrupted.temporaryResult).startsWith('retained:')) throw new Error('中断任务临时产物结果不可读回');
if (!existsSync(temporaryPath)) throw new Error('中断任务临时文件状态与磁盘不一致');
if (existsSync(resolve(rootPath, 'sources', 'interrupted.txt'))) throw new Error('中断任务存在完成产物');
await second.page.getByRole('button', { name: '任务' }).click();
await second.page.getByText('interrupted', { exact: true }).waitFor();
await second.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'restart-interrupted.png'));
await second.browser.close();
second.child.kill();

writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  succeeded: { id: succeeded.id, status: succeeded.status, outputPath: succeededPath },
  completedCancel: completedCancel.error.code,
  cancelled: { id: cancelledResult.result.id, status: cancelledResult.result.status, outputExists: false, temporaryResult: cancelledResult.result.temporaryResult },
  interrupted: { id: interrupted.id, status: interrupted.status, temporaryResult: interrupted.temporaryResult, temporaryPath, outputExists: false }
}, null, 2));
