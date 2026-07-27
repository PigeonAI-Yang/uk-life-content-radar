import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-009');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9243'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9243'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('TASK-009 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-009 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const account = await dispatch('account.create', { caller: 'task-009', idempotencyKey: 'account', name: '资料账号', positioning: '', audience: '', tone: '' });
const content = await dispatch('content.create', { caller: 'task-009', idempotencyKey: 'content', accountId: account.result.id, title: '引用内容' });

await page.getByRole('button', { name: '资料库', exact: true }).click();
await page.getByRole('textbox', { name: '资料标题' }).fill('英国押金资料');
await page.getByRole('textbox', { name: '资料正文' }).fill('押金必须进入政府认可的保护计划。');
await page.getByRole('button', { name: '新建资料' }).click();
await page.getByRole('button', { name: /英国押金资料/ }).click();
const resource = (await dispatch('resource.search', { query: '英国押金资料', limit: 10 })).result.items[0];
const originalPath = resource.filePath;
await page.getByRole('combobox', { name: '资料对象类型' }).selectOption('excerpt');
await page.getByRole('combobox', { name: '来源资料' }).selectOption(resource.id);
await page.getByRole('textbox', { name: '资料正文' }).fill('界面创建的押金摘录');
await page.getByRole('button', { name: '新建摘录' }).click();
const uiExcerpt = (await dispatch('search.query', { query: '界面创建的押金摘录', types: ['excerpt'], tags: [], includeArchived: false, limit: 10 })).result.items[0];
if (!uiExcerpt || (await dispatch('excerpt.get', { id: uiExcerpt.id })).result.sourceId !== resource.id) throw new Error('界面摘录未使用来源资料选择器');
await page.getByRole('combobox', { name: '资料对象类型' }).selectOption('note');
await page.getByRole('combobox', { name: '来源资料' }).selectOption(resource.id);
await page.getByRole('combobox', { name: '笔记所属内容' }).selectOption(content.result.id);
await page.getByRole('textbox', { name: '资料正文' }).fill('界面创建的关联笔记');
await page.getByRole('button', { name: '新建笔记' }).click();
const uiNote = (await dispatch('search.query', { query: '界面创建的关联笔记', types: ['note'], tags: [], includeArchived: false, limit: 10 })).result.items[0];
if (!uiNote || (await dispatch('note.get', { id: uiNote.id })).result.sourceId !== resource.id) throw new Error('界面笔记未使用可读选择器');
await page.getByRole('combobox', { name: '资料对象类型' }).selectOption('resource');
const updated = await dispatch('resource.update', { id: resource.id, expectedVersion: resource.version, title: '英国押金资料已更新', body: '更新后的资料正文。' });
if (!updated.ok || updated.result.id !== resource.id || updated.result.filePath === originalPath || !existsSync(originalPath)) throw new Error('资料更新覆盖原文件或改变稳定标识');
const conflict = await dispatch('resource.update', { id: resource.id, expectedVersion: 1, title: '冲突' });
if (conflict.ok || conflict.error.code !== 'VERSION_CONFLICT') throw new Error('资料版本冲突不明确');
const archivedResource = await dispatch('resource.archive', { id: resource.id, expectedVersion: updated.result.version });
const restoredResource = await dispatch('resource.restore', { id: resource.id, expectedVersion: archivedResource.result.version });
await dispatch('resource.link_content', { id: resource.id, contentId: content.result.id });
if ((await dispatch('resource.get', { id: resource.id })).result.usage.length !== 1) throw new Error('资料关联未读回');
await dispatch('resource.unlink_content', { id: resource.id, contentId: content.result.id });
if (!(await dispatch('resource.get', { id: resource.id })).ok) throw new Error('移除资料关系删除了资料');

const excerpt = await dispatch('excerpt.create', { sourceId: resource.id, text: '政府认可的保护计划', context: '押金段落上下文' });
const updatedExcerpt = await dispatch('excerpt.update', { id: excerpt.result.id, expectedVersion: 1, text: '押金保护计划', context: '更新上下文' });
await dispatch('excerpt.link_content', { id: excerpt.result.id, contentId: content.result.id });
if ((await dispatch('excerpt.get', { id: excerpt.result.id })).result.usage.length !== 1) throw new Error('摘录关联未读回');
await dispatch('excerpt.unlink_content', { id: excerpt.result.id, contentId: content.result.id });
const archivedExcerpt = await dispatch('excerpt.archive', { id: excerpt.result.id, expectedVersion: updatedExcerpt.result.version });
const restoredExcerpt = await dispatch('excerpt.restore', { id: excerpt.result.id, expectedVersion: archivedExcerpt.result.version });

const note = await dispatch('note.create', { body: '核对租约和押金凭证', sourceId: resource.id });
const updatedNote = await dispatch('note.update', { id: note.result.id, expectedVersion: 1, body: '核对租约、押金凭证和账单' });
await dispatch('note.link_content', { id: note.result.id, contentId: content.result.id });
if ((await dispatch('note.get', { id: note.result.id })).result.usage.length !== 1) throw new Error('笔记关联未读回');
await dispatch('note.unlink_content', { id: note.result.id, contentId: content.result.id });
const archivedNote = await dispatch('note.archive', { id: note.result.id, expectedVersion: updatedNote.result.version });
const restoredNote = await dispatch('note.restore', { id: note.result.id, expectedVersion: archivedNote.result.version });

await page.setViewportSize({ width: 1600, height: 900 });
await page.getByRole('textbox', { name: '资料库搜索' }).fill('英国押金');
await page.getByRole('button', { name: '搜索' }).click();
await page.getByRole('button', { name: /英国押金资料已更新/ }).click();
await page.waitForFunction(() => globalThis.document.querySelector('[aria-label="资料正文"]')?.value === '更新后的资料正文。');
await page.getByRole('combobox', { name: '关联内容' }).selectOption(content.result.id);
await page.getByRole('button', { name: '加入内容' }).click();
if ((await dispatch('resource.get', { id: resource.id })).result.usage.length !== 1) throw new Error('界面关联内容未写后读回');
await page.getByRole('heading', { name: '英国押金资料已更新' }).waitFor();
await page.getByRole('button', { name: '移除关联' }).click();
const wideReader = await page.getByRole('complementary', { name: '资料阅读器' }).boundingBox();
if (!wideReader || wideReader.x < 700 || wideReader.width < 420) throw new Error('1600 宽资料库不是有效双栏');
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'library-1600.png'));
await page.setViewportSize({ width: 1280, height: 720 });
const narrowReader = await page.getByRole('complementary', { name: '资料阅读器' }).boundingBox();
if (!narrowReader || narrowReader.x < 700 || narrowReader.width > 560) throw new Error('1280 宽资料阅读器不是抽屉');
await page.getByText(/来源：本地资料.*更新：.*状态：active/).waitFor();
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'library-1280.png'));
await page.getByRole('button', { name: '摘录', exact: true }).click();
if (await page.getByRole('combobox', { name: '来源资料' }).inputValue() !== resource.id) throw new Error('阅读器摘录动作未保留来源');
await page.getByRole('combobox', { name: '资料对象类型' }).selectOption('resource');
await page.getByRole('textbox', { name: '资料库搜索' }).fill('绝对不存在');
await page.getByRole('button', { name: '搜索' }).click();
await page.getByText('搜索无结果').waitFor();

const client = new Client({ name: 'task-009-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpNote = await client.callTool({ name: 'note.create', arguments: { body: 'MCP 独立笔记', sourceId: resource.id } });
const mcpEnvelope = JSON.parse(mcpNote.content[0].text);
if (!mcpEnvelope.ok || !(await dispatch('note.get', { id: mcpEnvelope.result.id })).ok) throw new Error('MCP 笔记写后读回失败');

const missingResource = await dispatch('resource.create', { caller: 'task-009', idempotencyKey: 'missing', title: '外部删除实验', body: '将被删除' });
unlinkSync(missingResource.result.filePath);
const missing = await dispatch('resource.get', { id: missingResource.result.id });
if (missing.ok || missing.error.code !== 'FILE_MISSING') throw new Error('外部来源不可用未明确显示');

await client.close();
await browser.close();
desktop.kill();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', resource: restoredResource.result, excerpt: restoredExcerpt.result, note: restoredNote.result,
  mcpNote: mcpEnvelope.result, failures: { versionConflict: conflict.error, externalUnavailable: missing.error },
  layouts: { wideReader, narrowReader }, rootPath
}, null, 2));
