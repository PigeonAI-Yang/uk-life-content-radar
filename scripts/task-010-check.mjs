import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-010');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9244'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9244'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('TASK-010 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-010 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const created = [];
const start = Date.now();
for (let index = 0; index < 300; index += 1) {
  const result = await dispatch('resource.create', {
    caller: 'task-010', idempotencyKey: `scale-${index}`, title: `规模资料 ${String(index).padStart(3, '0')}`,
    body: `阶段规模检索 唯一正文 ${index}`, topic: index % 2 ? '租房' : '签证', region: index % 3 ? '伦敦' : '曼城',
    targetAudience: index % 2 ? '留学生' : '工作人士', tags: [index % 5 ? '实用' : '官方']
  });
  if (!result.ok) throw new Error(`规模资料创建失败: ${JSON.stringify(result)}`);
  created.push(result.result.id);
}
const createMilliseconds = Date.now() - start;

const seen = new Set();
let cursor;
do {
  const result = await dispatch('search.query', { query: '阶段规模检索', cursor, limit: 37 });
  if (!result.ok) throw new Error(`分页搜索失败: ${JSON.stringify(result)}`);
  for (const item of result.result.items) {
    if (seen.has(item.id)) throw new Error(`稳定游标产生重复: ${item.id}`);
    seen.add(item.id);
  }
  cursor = result.result.nextCursor;
} while (cursor);
if (seen.size !== created.length || created.some((id) => !seen.has(id))) throw new Error(`稳定游标遗漏: ${seen.size}/${created.length}`);

const filtered = await dispatch('search.query', {
  query: '阶段规模检索', types: ['resource'], topic: '租房', region: '伦敦', targetAudience: '留学生',
  tags: ['实用'], dateFrom: '2000-01-01T00:00:00.000Z', status: 'active', limit: 100
});
if (!filtered.ok || !filtered.result.items.length || filtered.result.items.some((item) =>
  item.topic !== '租房' || item.region !== '伦敦' || item.targetAudience !== '留学生' || !item.tags.includes('实用'))) {
  throw new Error('组合筛选未由真实结果证明');
}

const sentinel = await dispatch('resource.get', { id: created[0] });
await dispatch('resource.archive', { id: sentinel.result.id, expectedVersion: sentinel.result.version });
const hidden = await dispatch('search.query', { query: '阶段规模检索', types: ['resource'], limit: 100 });
const archived = await dispatch('search.query', { query: '阶段规模检索', types: ['resource'], includeArchived: true, limit: 100 });
if (hidden.result.items.some((item) => item.id === sentinel.result.id) || !archived.result.items.some((item) => item.id === sentinel.result.id)) {
  throw new Error('归档对象的默认隐藏或全局可见失败');
}

const account = await dispatch('account.create', { caller: 'task-010', idempotencyKey: 'account', name: '检索账号' });
const content = await dispatch('content.create', { caller: 'task-010', idempotencyKey: 'content', accountId: account.result.id, title: '检索内容' });
await dispatch('content.link_resource', { contentId: content.result.id, resourceId: created[1] });
await dispatch('content.generate_platform_version', { caller: 'task-010', idempotencyKey: 'platform', contentId: content.result.id, platform: 'xiaohongshu' });
const accountPlatform = await dispatch('search.query', { query: '阶段规模检索', accountId: account.result.id, platform: 'xiaohongshu', limit: 10 });
if (!accountPlatform.ok || accountPlatform.result.items.length !== 1 || accountPlatform.result.items[0].id !== created[1]) {
  throw new Error('账号平台筛选失败');
}

const excerpt = await dispatch('excerpt.create', { sourceId: created[1], text: '来源筛选摘录', context: '原文上下文' });
const bySource = await dispatch('search.query', { query: '来源筛选摘录', types: ['excerpt'], source: created[1], limit: 10 });
if (!bySource.ok || bySource.result.items[0]?.id !== excerpt.result.id) throw new Error('来源筛选失败');

await page.getByRole('button', { name: '资料库', exact: true }).click();
await page.getByRole('textbox', { name: '资料库搜索' }).fill('阶段规模检索');
await page.getByRole('textbox', { name: '主题筛选' }).fill('租房');
await page.getByRole('textbox', { name: '开始日期筛选' }).fill('2000-01-01');
await page.getByRole('combobox', { name: '账号筛选' }).selectOption(account.result.id);
await page.getByRole('combobox', { name: '平台筛选' }).selectOption('xiaohongshu');
await page.getByRole('combobox', { name: '状态筛选' }).selectOption('active');
await page.getByRole('button', { name: '搜索', exact: true }).click();
await page.getByRole('button', { name: /规模资料 001/ }).waitFor();
await page.getByRole('button', { name: '保存视图' }).click();
await page.getByText(/视图已保存/).waitFor();
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'search-ui.png'));
const views = await dispatch('saved_view.list', { scope: 'library' });
if (!views.ok || views.result.length !== 1 || views.result[0].filters.topic !== '租房' ||
    views.result[0].filters.accountId !== account.result.id || views.result[0].filters.platform !== 'xiaohongshu') throw new Error('保存视图写后读回失败');
await page.getByRole('textbox', { name: '主题筛选' }).fill('');
await page.getByRole('combobox', { name: '账号筛选' }).selectOption('');
await page.getByRole('combobox', { name: '已保存视图' }).selectOption(views.result[0].id);
await page.waitForFunction(() => globalThis.document.querySelector('[aria-label="主题筛选"]')?.value === '租房');
await page.getByRole('button', { name: /规模资料 001/ }).waitFor();

const invalidCursor = await dispatch('search.query', { query: '', cursor: 'broken', limit: 10 });
if (invalidCursor.ok || invalidCursor.error.code !== 'INVALID_INPUT') throw new Error('无效游标失败实验不明确');
const indexStatus = await dispatch('search.index_status', {});
if (!indexStatus.ok || !indexStatus.result.synchronized) throw new Error(`索引未同步: ${JSON.stringify(indexStatus)}`);

const client = new Client({ name: 'task-010-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpSearch = await client.callTool({ name: 'search.query', arguments: { query: '阶段规模检索', topic: '租房', limit: 5 } });
const mcpEnvelope = JSON.parse(mcpSearch.content[0].text);
if (!mcpEnvelope.ok || !mcpEnvelope.result.items.length) throw new Error('MCP 搜索入口失败');
await client.close();
await browser.close();
desktop.kill();

writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', sampleSize: created.length, createMilliseconds, pagedCount: seen.size,
  indexStatus: indexStatus.result, savedView: views.result[0], mcpSample: mcpEnvelope.result.items[0],
  failures: { invalidCursor: invalidCursor.error }, rootPath
}, null, 2));
