import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-016');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const databasePath = resolve(rootPath, '.content-terminal', 'index.sqlite');
mkdirSync(profilePath, { recursive: true });
let desktop;
let browser;
let page;

async function start() {
  desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9251'], { stdio: 'ignore' });
  browser = undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9251'); break; } catch { await delay(200); }
  }
  if (!browser) throw new Error('TASK-016 后台应用未启动');
  page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('TASK-016 主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
}
async function stop() {
  spawnSync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { encoding: 'utf8' });
  await browser.close().catch(() => undefined);
}
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
const input = (query, mode = 'keyword', cursor) => ({
  query, mode, types: ['resource', 'excerpt', 'note', 'content', 'asset', 'package', 'account'],
  tags: [], includeArchived: true, limit: 100, cursor
});

await start();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
await stop();
const seedStarted = performance.now();
const seeded = spawnSync(process.execPath, [resolve('scripts', 'task-016-scale-seed.mjs'), databasePath, rootPath], { encoding: 'utf8', timeout: 1_200_000 });
if (seeded.status !== 0) throw new Error(`规模数据生成失败: ${seeded.stderr}`);
const seedCounts = JSON.parse(seeded.stdout.trim());
if (JSON.stringify(seedCounts) !== JSON.stringify({ resources: 100000, assetVersions: 30000, contents: 5000, packages: 1000, accounts: 20, searchable: 136020 })) {
  throw new Error(`规模数量不正确: ${seeded.stdout}`);
}
const seedMs = performance.now() - seedStarted;

await start();
const indexStarted = performance.now();
const indexStatus = await dispatch('search.index_status', {});
const indexMs = performance.now() - indexStarted;
if (!indexStatus.ok || !indexStatus.result.synchronized || indexStatus.result.semantic.indexed !== 136020) throw new Error('语义向量索引不完整');
await stop();

const coldKeyword = [];
const coldSemantic = [];
for (let run = 0; run < 3; run += 1) {
  await start();
  let started = performance.now();
  const keyword = await dispatch('search.query', input('唯一标签哨兵'));
  coldKeyword.push(performance.now() - started);
  started = performance.now();
  const semantic = await dispatch('search.query', input('租房保证金退回办法', 'semantic'));
  coldSemantic.push(performance.now() - started);
  if (!keyword.ok || keyword.result.items[0]?.id !== 'scale-source-098765' ||
      !semantic.ok || semantic.result.items[0]?.id !== 'scale-source-054321') throw new Error('冷启动哨兵搜索错误');
  if (run < 2) await stop();
}
const hotKeyword = [];
const hotSemantic = [];
for (let run = 0; run < 3; run += 1) {
  let started = performance.now();
  await dispatch('search.query', input('唯一标签哨兵'));
  hotKeyword.push(performance.now() - started);
  started = performance.now();
  await dispatch('search.query', input('租房保证金退回办法', 'semantic'));
  hotSemantic.push(performance.now() - started);
}
const median = (values) => [...values].sort((a, b) => a - b)[1];
if (median(hotKeyword) >= 2000 || median(hotSemantic) >= 5000) throw new Error('搜索性能阈值失败');

const sentinels = [
  ['resource', '唯一标签哨兵', 'scale-source-098765'],
  ['content', '历史文案唯一哨兵', 'scale-content-4321-v1'],
  ['asset', '已用素材唯一哨兵', 'scale-asset-12345'],
  ['package', '规模内容 777', 'scale-package-0777'],
  ['account', '规模账号 19', 'scale-account-19']
];
for (const [type, query, id] of sentinels) {
  const result = await dispatch('search.query', { ...input(query), types: [type], limit: 25 });
  if (!result.ok || !result.result.items.some((item) => item.id === id)) throw new Error(`${type} 全局搜索未命中`);
}
const archived = await dispatch('search.query', {
  ...input('规模资料 99999'), types: ['resource'], status: 'archived', region: '英国', limit: 25
});
if (!archived.ok || archived.result.items[0]?.id !== 'scale-source-099999') throw new Error('归档哨兵未命中');

const seen = new Set();
let cursor;
do {
  const result = await dispatch('search.query', { ...input('分页哨兵', 'keyword', cursor), types: ['resource'], limit: 100 });
  if (!result.ok) throw new Error('连续翻页失败');
  for (const item of result.result.items) {
    if (seen.has(item.id)) throw new Error(`连续翻页重复: ${item.id}`);
    seen.add(item.id);
  }
  cursor = result.result.nextCursor;
} while (cursor);
if (seen.size !== 250) throw new Error(`连续翻页遗漏: ${seen.size}/250`);

const invalidSemantic = await dispatch('search.query', { ...input('', 'semantic'), types: ['resource'] });
if (invalidSemantic.ok || invalidSemantic.error.code !== 'INVALID_INPUT') throw new Error('空语义查询未失败');
const invalidCursor = await dispatch('search.query', { ...input('规模资料'), cursor: 'not-a-cursor' });
if (invalidCursor.ok || invalidCursor.error.code !== 'INVALID_INPUT') throw new Error('无效游标未失败');

const client = new Client({ name: 'task-016-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpEnvelope = JSON.parse((await client.callTool({ name: 'search.query', arguments: { ...input('租房保证金退回办法', 'semantic'), types: ['resource'], limit: 25 } })).content[0].text);
if (!mcpEnvelope.ok || mcpEnvelope.result.items[0].id !== 'scale-source-054321') throw new Error('MCP 语义搜索不一致');

await page.getByRole('textbox', { name: '全局搜索' }).fill('历史文案唯一哨兵');
await page.evaluate(() => globalThis.terminal.lifecycle.reopenWindow());
const renderStarted = performance.now();
await page.getByRole('textbox', { name: '全局搜索' }).press('Enter');
await page.getByText('规模内容 4321', { exact: true }).waitFor();
const renderMs = performance.now() - renderStarted;
await page.getByRole('combobox', { name: '全局搜索模式' }).selectOption('semantic');
await page.getByRole('textbox', { name: '全局搜索' }).fill('租房保证金退回办法');
await page.getByRole('textbox', { name: '全局搜索' }).press('Enter');
await page.getByText('旧资料：租房押金处理', { exact: true }).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'global-semantic-search.png'), animations: 'disabled' });

const memory = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${desktop.pid}).WorkingSet64`], { encoding: 'utf8' });
const peakWorkingSetBytes = Number(memory.stdout.trim());
await client.close();
await stop();
const executableBytes = statSync(executablePath).size;
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', seed: 'task-016-fixed-seed-v1', seedMs, seedCounts, databasePath,
  databaseBytes: statSync(databasePath).size, executableBytes, indexMs, indexStatus: indexStatus.result,
  timingsMs: { coldKeyword, coldSemantic, hotKeyword, hotSemantic, medianKeyword: median(hotKeyword), medianSemantic: median(hotSemantic), render: renderMs },
  peakWorkingSetBytes, cursor: { expected: 250, unique: seen.size }, failures: { emptySemantic: invalidSemantic.error, invalidCursor: invalidCursor.error },
  mcpSemanticFirst: mcpEnvelope.result.items[0]
}, null, 2));
