import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3/win32-x64';
import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-015');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

let desktop;
let browser;
let page;
async function start() {
  desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9250'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9250'); break; } catch { await delay(200); }
  }
  if (!browser) throw new Error('TASK-015 后台应用未启动');
  page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('TASK-015 主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
}
await start();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const [emptyAccounts, emptyTasks, emptyCandidates] = await Promise.all([
  dispatch('account.search', { query: '', limit: 25 }),
  dispatch('task.list', { query: '', limit: 25 }),
  dispatch('package.list_candidates', { query: '', limit: 100 })
]);
if (!emptyAccounts.ok || !emptyTasks.ok || !emptyCandidates.ok ||
    emptyAccounts.result.items.length || emptyTasks.result.items.length || emptyCandidates.result.items.length) throw new Error('工作台首次空状态错误');
const firstScan = await dispatch('storage.scan', {});
const resource = await dispatch('resource.create', {
  caller: 'task-015', idempotencyKey: 'growth-file', title: '增长核验', body: '固定字节内容'
});
const sourceSize = statSync(resource.result.filePath).size;
const secondScan = await dispatch('storage.scan', {});
if (secondScan.result.growthFiles !== 1 || secondScan.result.growthBytes !== sourceSize) {
  throw new Error(`存储增长不等于真实磁盘差: ${JSON.stringify({ firstScan, secondScan, sourceSize })}`);
}
const bulkDirectory = resolve(rootPath, 'sources', 'responsiveness');
mkdirSync(bulkDirectory, { recursive: true });
for (let index = 0; index < 3000; index += 1) writeFileSync(resolve(bulkDirectory, `${index}.txt`), '');
const responsiveness = await page.evaluate(async () => {
  const scan = globalThis.terminal.business.dispatch('storage.scan', {});
  await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 0));
  const startedAt = globalThis.performance.now();
  await globalThis.terminal.settings.get();
  const mainResponseMs = globalThis.performance.now() - startedAt;
  const completedScan = await scan;
  return { mainResponseMs, scanId: completedScan.result.id };
});
if (responsiveness.mainResponseMs > 500) throw new Error(`扫描阻塞 Electron 主进程: ${responsiveness.mainResponseMs.toFixed(0)}ms`);

const exportDirectory = resolve(rootPath, 'exports');
await dispatch('settings.update_export_directory', { directory: exportDirectory });
await dispatch('settings.update_platform_template', { platform: 'wechat', template: { version: 'wechat-v1', format: 'html' } });
const settings = await dispatch('settings.get', {});
if (!settings.ok || settings.result.exportDirectory !== exportDirectory || settings.result.platformTemplates.wechat.version !== 'wechat-v1' ||
    settings.result.lastScan.id !== responsiveness.scanId || settings.result.databaseByteSize <= 0) throw new Error('设置写后读回失败');
const alertImage = resolve(runDirectory, 'disk-alert.png');
copyFileSync(resolve('artifacts', 'task-receipts', 'TASK-012', 'sharp-dev', 'original.png'), alertImage);
const alertAsset = await dispatch('asset.import', { caller: 'task-015', idempotencyKey: 'disk-alert-asset', filePath: alertImage });
const diskFull = await dispatch('asset.resize', {
  caller: 'task-015', idempotencyKey: 'disk-alert', assetId: alertAsset.result.id, versionId: alertAsset.result.versionId,
  width: 2147483647, height: 2147483647
});
const settingsWithAlert = await dispatch('settings.get', {});
if (diskFull.ok || diskFull.error.code !== 'DISK_FULL' || settingsWithAlert.result.storageAlert.code !== 'DISK_FULL') throw new Error('设置未显示磁盘不足影响');

writeFileSync(resolve(rootPath, 'blocked-parent'), 'file');
const failedTask = await dispatch('task.start', {
  caller: 'task-015', idempotencyKey: 'failed', type: 'file.write',
  parameters: { relativePath: 'blocked-parent/child.txt', content: '失败', durationMs: 0 }
});
await delay(100);
const failedReadback = await dispatch('task.get', { taskId: failedTask.result.id });
if (failedReadback.result.status !== 'failed' || failedReadback.result.error.code !== 'TASK_FAILED') throw new Error('失败任务状态错误');

writeFileSync(resolve(rootPath, 'sources', 'conflict.txt'), 'existing');
const partialTask = await dispatch('task.start', {
  caller: 'task-015', idempotencyKey: 'partial', type: 'file.write_batch',
  parameters: { durationMs: 0, items: [
    { relativePath: 'sources/batch-ok.txt', content: 'ok' },
    { relativePath: 'sources/conflict.txt', content: 'conflict' }
  ] }
});
await delay(100);
const partialReadback = await dispatch('task.get', { taskId: partialTask.result.id });
if (partialReadback.result.status !== 'partial' || !existsSync(resolve(rootPath, 'sources', 'batch-ok.txt')) ||
    readFileSync(resolve(rootPath, 'sources', 'conflict.txt'), 'utf8') !== 'existing') throw new Error('部分成功任务状态或磁盘结果错误');

const cancelledTask = await dispatch('task.start', {
  caller: 'task-015', idempotencyKey: 'cancelled', type: 'file.write',
  parameters: { relativePath: 'sources/cancelled.txt', content: '不应提交', durationMs: 30_000 }
});
await delay(100);
const cancelled = await dispatch('task.cancel', { taskId: cancelledTask.result.id });
if (cancelled.result.status !== 'cancelled' || existsSync(resolve(rootPath, 'sources', 'cancelled.txt'))) throw new Error('取消任务仍提交了文件');

const interruptedTask = await dispatch('task.start', {
  caller: 'task-015', idempotencyKey: 'interrupted', type: 'file.write',
  parameters: { relativePath: 'sources/interrupted.txt', content: '待恢复临时产物', durationMs: 60_000 }
});
await delay(100);
if ((await dispatch('task.get', { taskId: interruptedTask.result.id })).result.status !== 'running') throw new Error('中断实验任务未运行');
spawnSync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { encoding: 'utf8' });
await browser.close().catch(() => undefined);
browser = undefined;
await delay(500);
await start();
await page.evaluate(() => globalThis.terminal.lifecycle.reopenWindow());
const dispatchAfterRestart = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
const interrupted = await dispatchAfterRestart('task.get', { taskId: interruptedTask.result.id });
if (interrupted.result.status !== 'interrupted' || !String(interrupted.result.temporaryResult).startsWith('retained:')) throw new Error('重启未读回已中断任务');

const client = new Client({ name: 'task-015-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const tools = (await client.listTools()).tools.map((tool) => tool.name);
if (tools.some((name) => name.includes('delete') || name.includes('purge'))) throw new Error('界面业务能力或 MCP 暴露永久删除');
const mcpScanEnvelope = JSON.parse((await client.callTool({ name: 'storage.scan', arguments: {} })).content[0].text);
if (!mcpScanEnvelope.ok || mcpScanEnvelope.result.rootPath !== rootPath) throw new Error('MCP 存储扫描与界面业务根不一致');

await page.getByRole('button', { name: '任务', exact: true }).click();
await page.getByText('file.write_batch').waitFor();
await page.getByText('partial').waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'task-center.png'), animations: 'disabled', timeout: 60_000 });
await page.getByRole('button', { name: '设置', exact: true }).click();
const deniedDirectory = resolve(rootPath, 'sources', 'unreadable-probe');
mkdirSync(deniedDirectory);
const userName = process.env.USERNAME;
if (!userName) throw new Error('无法读取 Windows 用户名');
const deny = spawnSync('icacls.exe', [deniedDirectory, '/deny', `${userName}:(OI)(CI)F`], { encoding: 'utf8' });
if (deny.status !== 0) throw new Error(`无法建立真实不可读目录: ${deny.stderr || deny.stdout}`);
let restoreAcl;
try {
  await page.getByRole('button', { name: '扫描存储' }).click();
  await page.getByText(/FILE_UNREADABLE/).waitFor();
  await page.screenshot({ path: resolve(receiptDirectory, 'storage-unreadable.png'), animations: 'disabled', timeout: 60_000 });
} finally {
  restoreAcl = spawnSync('icacls.exe', [deniedDirectory, '/remove:d', userName], { encoding: 'utf8' });
}
if (restoreAcl.status !== 0) throw new Error(`无法恢复测试目录权限: ${restoreAcl.stderr || restoreAcl.stdout}`);
const database = new Database(resolve(rootPath, '.content-terminal', 'index.sqlite'));
database.exec('DROP TABLE search_fts');
database.close();
await page.getByRole('button', { name: '扫描存储' }).click();
await page.getByText('本次增长').waitFor();
await page.getByText('不可用', { exact: true }).waitFor();
await page.getByText(/DISK_FULL/).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'storage-settings.png'), animations: 'disabled', timeout: 60_000 });
await page.getByRole('button', { name: '工作台', exact: true }).click();
await page.getByText('需要处理', { exact: true }).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'dashboard.png'), animations: 'disabled', timeout: 60_000 });
const failedDatabase = new Database(resolve(rootPath, '.content-terminal', 'index.sqlite'));
failedDatabase.exec('DROP TABLE tasks');
failedDatabase.close();
await page.getByRole('button', { name: '刷新状态', exact: true }).click();
await page.getByText(/DATABASE_UNAVAILABLE/).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'dashboard-failure.png'), animations: 'disabled', timeout: 60_000 });

await client.close();
spawnSync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { encoding: 'utf8' });
await browser.close().catch(() => undefined);
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', rootPath, databasePath: settings.result.databasePath,
  scans: { first: firstScan.result, second: secondScan.result, mcp: mcpScanEnvelope.result, fixedFileBytes: sourceSize },
  settings: settingsWithAlert.result,
  tasks: { failed: failedReadback.result, partial: partialReadback.result, cancelled: cancelled.result, interrupted: interrupted.result },
  noPermanentDelete: true,
  failures: { diskFull: diskFull.error, unreadable: 'FILE_UNREADABLE', index: 'unavailable', dashboard: 'DATABASE_UNAVAILABLE' }
}, null, 2));
