import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const receiptDirectory = resolve(project, 'artifacts', 'task-receipts', 'PI-004');
const runDirectory = resolve(receiptDirectory, `api-run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const screenshotPath = resolve(receiptDirectory, 'custom-api-agent-result.png');
const executablePath = resolve(project, 'out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const port = 9900 + Math.floor(Math.random() * 80);
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, [
  '--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`
], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) throw new Error('PI-004 打包应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('PI-004 业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);

  const imported = await page.evaluate(() => globalThis.terminal.agent.importCockpit());
  if (!imported.apiKeyConfigured || !imported.config?.model) throw new Error('CockpitTools 导入失败');
  const connection = await page.evaluate(() => globalThis.terminal.agent.testCustomApi());
  if (!connection.connected) throw new Error(`自定义 API 连接失败: ${JSON.stringify(connection)}`);

  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const account = await dispatch('account.create', {
    caller: 'pi-004', idempotencyKey: 'account', name: 'Pi 真实接力账号',
    positioning: '英国生活实用资讯', audience: '在英华人', tone: '自然可信'
  });
  if (!account.ok) throw new Error(`账号创建失败: ${JSON.stringify(account)}`);
  const proposal = await dispatch('strategy.propose', {
    caller: 'pi-004', idempotencyKey: 'proposal', accountId: account.result.id,
    proposalType: 'conversion',
    proposed: { direction: '围绕英国租房新规建立一条可执行内容任务' },
    rationale: '把已批准策略转成下一步真实工作', evidence: [],
    successMeasure: '生成并保存一个可继续执行的内容对象'
  });
  if (!proposal.ok) throw new Error(`提案创建失败: ${JSON.stringify(proposal)}`);

  await page.getByRole('button', { name: '情报' }).click();
  await page.getByRole('button', { name: '批准为正式策略' }).click();
  await page.getByText(/策略已批准，Pi 接力任务/).waitFor();
  const tasks = await dispatch('task.list', { query: 'agent.execute', limit: 5 });
  if (!tasks.ok || tasks.result.items.length !== 1) throw new Error('批准未创建唯一 Pi 任务');
  const taskId = tasks.result.items[0].id;
  let task;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await dispatch('task.get', { taskId });
    if (!response.ok) throw new Error(`任务读回失败: ${JSON.stringify(response)}`);
    task = response.result;
    if (['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(task.status)) break;
    await delay(500);
  }
  if (task?.status !== 'succeeded') throw new Error(`Pi 真实接力未成功: ${JSON.stringify(task)}`);
  const files = task.result?.files ?? [];
  if (files.length !== 2 || files.some((file) => !existsSync(file.filePath))) {
    throw new Error('Pi 事件与结果文件未真实读回');
  }
  const resultFile = files.find((file) => file.filePath.endsWith('result.json'));
  const eventFile = files.find((file) => file.filePath.endsWith('events.jsonl'));
  const agentResult = JSON.parse(readFileSync(resultFile.filePath, 'utf8'));
  const events = readFileSync(eventFile.filePath, 'utf8');
  if (agentResult.toolCalls < 1 || !events.includes('"type":"tool_call"')) {
    throw new Error('Pi 未通过 MCP 调用业务工具');
  }
  await page.getByRole('button', { name: '任务' }).click();
  await page.getByText('Pi 接力工作').waitFor();
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const result = {
    task: 'PI-004', status: 'completed', runtime: 'pi',
    api: { source: 'CockpitTools', baseUrl: imported.config.baseUrl, model: imported.config.model },
    connection, agentTask: task, agentResult, screenshot: screenshotPath,
    checks: {
      realCustomApi: true, realModelResponse: true, humanApprovalUi: true,
      realMcpToolCall: true, sqliteTaskReadback: true, eventAndResultFiles: true
    }
  };
  writeFileSync(resolve(receiptDirectory, 'custom-api-result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  desktop.kill();
  await Promise.race([new Promise((done) => desktop.once('exit', done)), delay(5000)]);
}
