import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'PI-005');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const port = 9700 + Math.floor(Math.random() * 100);
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
  const resources = resolve(executablePath, '..', 'resources');
  for (const name of ['SKILL.md', 'source-map.md', 'content-business-partner/SKILL.md']) {
    if (!existsSync(resolve(resources, name))) throw new Error(`安装包缺少 Pi Skill 资源: ${name}`);
  }
  const imported = await page.evaluate(() => globalThis.terminal.agent.importCockpit());
  const connection = await page.evaluate(() => globalThis.terminal.agent.testCustomApi());
  if (!imported.apiKeyConfigured || !connection.connected) throw new Error('真实自定义 API 未连接');
  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const account = await dispatch('account.create', {
    caller: 'pi-005', idempotencyKey: 'account', name: 'Pi 情报收集验收账号',
    positioning: '英国生活情报', audience: '在英华人', tone: '自然实用'
  });
  if (!account.ok) throw new Error(`账号创建失败: ${JSON.stringify(account)}`);
  const started = await dispatch('task.start', {
    caller: 'pi-005', idempotencyKey: 'continue-research', type: 'agent.execute',
    parameters: {
      accountId: account.result.id, triggerEvent: 'desktop_chat',
      goal: '继续收集英国资讯。按英国生活内容雷达流程，用多个窄查询发现近30天对在英华人有影响的官方信息；打开原始页面核验，至少形成1条真实候选。通过 intelligence.record_scan 写回每个来源的成功或失败，再读取 scan_status 和候选确认。不要创建发布包、客户或成交。'
    }
  });
  if (!started.ok) throw new Error(`任务创建失败: ${JSON.stringify(started)}`);
  let task;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const response = await dispatch('task.get', { taskId: started.result.id });
    task = response.ok ? response.result : undefined;
    if (task && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) break;
    await delay(500);
  }
  if (task?.status !== 'succeeded') throw new Error(`Pi 情报收集失败: ${JSON.stringify(task)}`);
  const eventFile = task.result.files.find((file) => file.filePath.endsWith('events.jsonl'));
  const events = readFileSync(eventFile.filePath, 'utf8');
  for (const tool of ['web_search', 'web_read', 'intelligence.record_scan', 'intelligence.scan_status']) {
    if (!events.includes(`"name":"${tool}"`)) throw new Error(`Pi 未调用 ${tool}`);
  }
  const scan = await dispatch('intelligence.scan_status', {});
  const candidates = await dispatch('intelligence.list', { limit: 20 });
  const scanTasks = await dispatch('task.list', { query: 'intelligence.scan', limit: 10 });
  if (!scan.ok || !scan.result.latest || !candidates.ok || !candidates.result.items.length) {
    throw new Error('情报扫描或候选未写后读回');
  }
  if (!scanTasks.ok || scanTasks.result.items.length !== 1) throw new Error('同一轮研究产生了重复扫描记录');
  const result = {
    task: 'PI-005', status: 'completed',
    checks: { radarSkillPackaged: true, webSearch: true, webRead: true, scanWritten: true, candidateReadback: true },
    agentTask: { id: task.id, summary: task.result.summary, toolCalls: task.result.toolCalls },
    scan: scan.result.latest,
    candidates: candidates.result.items,
    rootPath
  };
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({ status: result.status, checks: result.checks, candidates: result.candidates.length }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  desktop.kill();
}
