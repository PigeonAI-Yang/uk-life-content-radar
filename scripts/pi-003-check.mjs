import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const receiptDirectory = resolve(project, 'artifacts', 'task-receipts', 'PI-003');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const screenshotPath = resolve(receiptDirectory, 'settings-and-tasks.png');
const executablePath = resolve(project, 'out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const port = 9500 + Math.floor(Math.random() * 200);
mkdirSync(profilePath, { recursive: true });

const unit = spawnSync(process.execPath, [
  resolve(project, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
  'tests/strategy-agent-handoff.test.ts', 'tests/agent-auth.test.ts', 'tests/agent-task.test.ts'
], { cwd: project, stdio: 'inherit' });
if (unit.status !== 0) throw new Error('PI-003 单元与失败实验未通过');

const desktop = spawn(executablePath, [
  '--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`
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
  if (!browser) throw new Error('PI-003 打包应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('PI-003 业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const account = await dispatch('account.create', {
    caller: 'pi-003', idempotencyKey: 'account', name: 'Pi 接力验收账号',
    positioning: '英国生活', audience: '在英华人', tone: '自然'
  });
  if (!account.ok) throw new Error(`账号失败: ${JSON.stringify(account)}`);
  const proposal = await dispatch('strategy.propose', {
    caller: 'pi-003', idempotencyKey: 'proposal', accountId: account.result.id,
    proposalType: 'conversion', proposed: { direction: '解释英国租房新规并引导私信' },
    rationale: '发布英国租房新规解读', evidence: [], successMeasure: '7天10条有效私信'
  });
  if (!proposal.ok) throw new Error(`提案失败: ${JSON.stringify(proposal)}`);
  await page.getByRole('button', { name: '经营' }).click();
  await page.getByRole('button', { name: '批准为正式策略' }).click();
  await page.getByText(/策略已批准，Pi 接力任务/).waitFor();
  const tasks = await dispatch('task.list', { query: 'agent.execute', limit: 5 });
  if (!tasks.ok || tasks.result.items.length !== 1) throw new Error(`未创建唯一接力任务: ${JSON.stringify(tasks)}`);
  await page.getByRole('button', { name: '任务' }).click();
  await page.getByText('Pi 接力工作').waitFor();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('heading', { name: 'Pi 工作助手' }).waitFor();
  for (const name of [
    '扫描本机登录', '使用本机 Codex 登录', '订阅登录', '验证码登录',
    '导入 CockpitTools', '保存 API 配置', '读取模型', '测试连接'
  ]) {
    await page.getByRole('button', { name }).waitFor();
  }
  await page.getByLabel('自定义 API 地址').waitFor();
  await page.getByLabel('自定义 API Key').waitFor();
  await page.getByLabel('自定义 API 模型').waitFor();
  const auth = await page.evaluate(() => globalThis.terminal.agent.scanAuth());
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const approval = await dispatch('strategy.get', { id: proposal.result.id });
  if (!approval.ok || approval.result.status !== 'approved'
    || !existsSync(approval.result.approvedStrategy.versionFile.filePath)) throw new Error('批准版本文件未真实读回');
  const result = {
    task: 'PI-003', status: 'completed', packagedApp: executablePath,
    taskId: tasks.result.items[0].id, auth, approval: approval.result, screenshot: screenshotPath,
    checks: {
      approvalCreatesOneAgentTask: true, taskUi: true, authUi: true,
      codexImportEntry: true, oauthEntries: true, customApiEntry: true, failureKeepsApproval: true
    }
  };
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  desktop.kill();
  await Promise.race([new Promise((done) => desktop.once('exit', done)), delay(5000)]);
}
