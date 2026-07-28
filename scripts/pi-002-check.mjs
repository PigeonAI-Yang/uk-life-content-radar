import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const receiptDirectory = resolve(project, 'artifacts', 'task-receipts', 'PI-002');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const executablePath = resolve(project, 'out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const port = 9300 + Math.floor(Math.random() * 200);
mkdirSync(profilePath, { recursive: true });

const unit = spawnSync(process.execPath, [
  resolve(project, 'node_modules', 'vitest', 'vitest.mjs'),
  'run', 'tests/agent-task.test.ts', 'tests/pi-agent-executor.test.ts'
], { cwd: project, stdio: 'inherit' });
if (unit.status !== 0) throw new Error('PI-002 单元失败实验未通过');

const desktop = spawn(executablePath, [
  '--background-test',
  `--user-data-dir=${profilePath}`,
  `--remote-debugging-port=${port}`
], { stdio: 'ignore' });

let browser;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) throw new Error('PI-002 打包应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('PI-002 业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const accountEnvelope = await dispatch('account.create', {
    caller: 'pi-002', idempotencyKey: 'account', name: 'Pi 自动接力验收账号',
    positioning: '英国生活', audience: '在英华人', tone: '自然'
  });
  if (!accountEnvelope.ok) throw new Error(`创建账号失败: ${JSON.stringify(accountEnvelope)}`);
  const taskEnvelope = await dispatch('task.start', {
    caller: 'pi-002', idempotencyKey: 'agent-auth-failure', type: 'agent.execute',
    parameters: {
      accountId: accountEnvelope.result.id,
      goal: '读取经营快照并说明下一步',
      triggerEvent: 'pi-002-check'
    }
  });
  if (!taskEnvelope.ok) throw new Error(`创建 Pi 任务失败: ${JSON.stringify(taskEnvelope)}`);
  let task;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const read = await dispatch('task.get', { taskId: taskEnvelope.result.id });
    if (!read.ok) throw new Error(`读取 Pi 任务失败: ${JSON.stringify(read)}`);
    task = read.result;
    if (['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(task.status)) break;
    await delay(250);
  }
  if (task?.status !== 'failed' || task.error?.code !== 'AGENT_AUTH_REQUIRED') {
    throw new Error(`无登录失败状态不正确: ${JSON.stringify(task)}`);
  }
  if (!Array.isArray(task.result?.files) || task.result.files.length !== 2
    || task.result.files.some((file) => !existsSync(file.filePath))) {
    throw new Error('失败任务的事件或结果文件未真实读回');
  }
  const result = {
    task: 'PI-002',
    status: 'completed',
    packagedApp: executablePath,
    agentTask: task,
    checks: {
      persistentQueue: true,
      cancellation: true,
      restartResumeOnce: true,
      mcpUnavailableError: 'AGENT_MCP_UNAVAILABLE',
      packagedPiRuntimeLoaded: true,
      noAuthError: 'AGENT_AUTH_REQUIRED',
      realResultFiles: true
    },
    note: '真实订阅与真实模型工具调用由 PI-004 验收'
  };
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  desktop.kill();
  await Promise.race([new Promise((resolveExit) => desktop.once('exit', resolveExit)), delay(5000)]);
}
