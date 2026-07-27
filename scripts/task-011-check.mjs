import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-011');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9245'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9245'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('TASK-011 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-011 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const account = await dispatch('account.create', { caller: 'task-011', idempotencyKey: 'account', name: '编辑账号' });
const resource = await dispatch('resource.create', {
  caller: 'task-011', idempotencyKey: 'resource', title: '英国租房原文', body: '押金应存入政府认可计划。'
});
const excerpt = await dispatch('excerpt.create', { sourceId: resource.result.id, text: '政府认可计划', context: '原文第二段上下文' });
const note = await dispatch('note.create', { body: '发布前核对政府页面', sourceId: resource.result.id });
const imagePath = resolve(runDirectory, 'image.png');
writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const asset = await dispatch('asset.import', { caller: 'task-011', idempotencyKey: 'asset', filePath: imagePath });

await page.getByRole('button', { name: '内容', exact: true }).click();
await page.getByRole('combobox', { name: '内容账号' }).selectOption(account.result.id);
await page.getByRole('textbox', { name: '内容标题' }).fill('伦敦租房指南');
await page.getByRole('button', { name: '新建内容' }).click();
await page.getByRole('textbox', { name: '内容正文' }).fill('公共草稿第一版');
await page.getByRole('textbox', { name: '内容大纲' }).fill('一、押金');
await page.getByRole('textbox', { name: '待核验事项' }).fill('核对押金上限');
await page.getByText('有未保存修改').waitFor();
await page.getByRole('button', { name: '保存新版本' }).click();
await page.getByText(/旧批准已失效/).waitFor();
let content = (await dispatch('content.get', { id: await page.getByRole('combobox', { name: '内容项目' }).inputValue() })).result;
const common = content.versions.filter((version) => !version.platform).at(-1);
if (!existsSync(common.filePath) || common.fileStatus !== 'present' || common.outline !== '一、押金') throw new Error('公共草稿文件或大纲未读回');

const links = await Promise.all([
  dispatch('resource.link_content', { id: resource.result.id, contentId: content.id }),
  dispatch('excerpt.link_content', { id: excerpt.result.id, contentId: content.id }),
  dispatch('note.link_content', { id: note.result.id, contentId: content.id }),
  dispatch('content.link_asset', { contentId: content.id, assetVersionId: asset.result.versionId, order: 0 })
]);
if (links.some((result) => !result.ok)) throw new Error(`资源槽关联失败: ${JSON.stringify(links)}`);
await page.getByRole('button', { name: '载入' }).click();
await page.getByText('资料 1｜素材 1｜摘录 1｜笔记 1').waitFor();
const outlineBox = await page.getByLabel('内容大纲栏').boundingBox();
const editorBox = await page.getByRole('textbox', { name: '内容正文' }).boundingBox();
if (!outlineBox || outlineBox.width < 200 || outlineBox.width > 260 || !editorBox || editorBox.width < 600) throw new Error('大纲栏或正文主区宽度不符合视觉契约');
await page.getByRole('button', { name: '收起大纲' }).click();
const collapsedOutline = await page.getByLabel('内容大纲栏').boundingBox();
if (!collapsedOutline || collapsedOutline.width > 60) throw new Error('大纲栏不可折叠');
await page.getByRole('button', { name: '展开大纲' }).click();
await page.getByRole('tab', { name: '素材', exact: true }).click();
await page.getByRole('combobox', { name: '素材对象' }).selectOption(asset.result.versionId);
await page.getByRole('button', { name: '移除素材' }).click();
if ((await dispatch('content.get', { id: content.id })).result.assets.length !== 0) throw new Error('界面移除素材未写后读回');
await page.getByRole('button', { name: '加入素材' }).click();
if ((await dispatch('content.get', { id: content.id })).result.assets.length !== 1) throw new Error('界面加入素材未写后读回');
await page.getByRole('tab', { name: '引用', exact: true }).click();
await page.getByRole('combobox', { name: '引用类型' }).selectOption('excerpt');
await page.getByRole('combobox', { name: '引用对象' }).selectOption(excerpt.result.id);
await page.getByRole('button', { name: '回看原文' }).click();
await page.getByLabel('引用原文上下文').getByText(/原文第二段上下文/).waitFor();
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'content-editor.png'));
await page.getByRole('tab', { name: '待核验' }).click();
await page.getByLabel('内容资源槽').getByText('核对押金上限').waitFor();
await page.getByRole('tab', { name: '平台预览' }).click();
await page.getByLabel('内容资源槽').getByText('公共草稿第一版').waitFor();

await page.getByRole('tab', { name: '小红书' }).click();
await page.getByRole('button', { name: '生成平台版本' }).click();
content = (await dispatch('content.get', { id: content.id })).result;
const generated = content.versions.filter((version) => version.platform === 'xiaohongshu').at(-1);
await page.getByRole('textbox', { name: '内容正文' }).fill('尚未保存的平台修改');
if (await page.getByRole('button', { name: '生成平台版本' }).isEnabled()) throw new Error('有未保存修改时仍可重新生成平台版本');
await page.getByRole('tab', { name: '公共草稿' }).click();
const manual = await dispatch('content.save_version', {
  contentId: content.id, expectedVersion: content.version, platform: 'xiaohongshu',
  body: '人工修改的小红书正文', outline: '人工大纲', verificationItems: []
});
const regenerated = await dispatch('content.generate_platform_version', {
  caller: 'task-011', idempotencyKey: 'regenerate', contentId: content.id, platform: 'xiaohongshu'
});
const latestPlatform = regenerated.result.versions.filter((version) => version.platform === 'xiaohongshu').at(-1);
if (latestPlatform.body !== '人工修改的小红书正文' || latestPlatform.editState !== 'manual') throw new Error('重新生成覆盖了人工平台稿');

const historyCopy = await dispatch('content.create_from_version', {
  caller: 'task-011', idempotencyKey: 'history-copy', versionId: common.id, accountId: account.result.id
});
if (!historyCopy.ok || historyCopy.result.versions.at(-1).body !== common.body || !existsSync(historyCopy.result.versions.at(-1).filePath)) {
  throw new Error('从历史创建新内容失败');
}

await dispatch('excerpt.unlink_content', { id: excerpt.result.id, contentId: content.id });
if (!(await dispatch('excerpt.get', { id: excerpt.result.id })).ok) throw new Error('删除引用误删底层摘录');

const candidate = await dispatch('package.create_preview', {
  caller: 'task-011', idempotencyKey: 'candidate', accountId: account.result.id, platform: 'xiaohongshu',
  contentVersionId: manual.result.versions.filter((version) => version.platform === 'xiaohongshu').at(-1).id,
  assetVersionIds: [asset.result.versionId], templateVersion: 'v1'
});
await dispatch('package.request_approval', { candidateId: candidate.result.id });
await dispatch('approval.approve', { candidateId: candidate.result.id });

const client = new Client({ name: 'task-011-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const beforeConflict = (await dispatch('content.get', { id: content.id })).result;
const mcpSave = await client.callTool({ name: 'content.save_version', arguments: {
  contentId: content.id, expectedVersion: beforeConflict.version, body: 'MCP 保存的新公共稿', outline: '', verificationItems: []
}});
const mcpEnvelope = JSON.parse(mcpSave.content[0].text);
if (!mcpEnvelope.ok) throw new Error('MCP 内容保存失败');
const conflict = await dispatch('content.save_version', {
  contentId: content.id, expectedVersion: beforeConflict.version, body: '界面过期保存', outline: '', verificationItems: []
});
if (conflict.ok || conflict.error.code !== 'VERSION_CONFLICT') throw new Error('双入口并发保存没有明确版本冲突');
const approval = await dispatch('package.get_approval', { candidateId: candidate.result.id });
if (approval.result.status !== 'stale') throw new Error('内容变化后旧批准未失效');

const newest = mcpEnvelope.result.versions.filter((version) => !version.platform).at(-1);
appendFileSync(newest.filePath, '外部修改');
const modified = await dispatch('content.get', { id: content.id });
const modifiedVersion = modified.result.versions.find((version) => version.id === newest.id);
if (modifiedVersion.fileStatus !== 'modified') throw new Error('外部修改内容版本未显示');

await client.close();
await browser.close();
desktop.kill();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', contentId: content.id, commonVersion: common, generatedVersion: generated,
  manualVersion: latestPlatform, historyCopyId: historyCopy.result.id, resourceSlot: { resource: 1, asset: 1, excerpt: 1, note: 1 },
  failures: { versionConflict: conflict.error, externalModification: modifiedVersion.fileStatus },
  approvalAfterChange: approval.result, mcpVersion: newest, rootPath
}, null, 2));
