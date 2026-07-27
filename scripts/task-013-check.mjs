import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-013');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const imagePath = resolve(runDirectory, 'shared.png');
mkdirSync(profilePath, { recursive: true });
copyFileSync(resolve('artifacts', 'task-receipts', 'TASK-012', 'sharp-dev', 'original.png'), imagePath);

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9248'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9248'); break; } catch { await delay(200); }
}
if (!browser) throw new Error('TASK-013 后台应用未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-013 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

await page.getByRole('button', { name: '账号', exact: true }).click();
await page.getByText('首次使用：暂无账号').waitFor();
await page.getByRole('textbox', { name: '账号名称' }).fill('伦敦生活号');
await page.getByRole('textbox', { name: '账号定位' }).fill('英国生活服务');
await page.getByRole('textbox', { name: '目标受众' }).fill('在英华人');
await page.getByRole('textbox', { name: '内容语气' }).fill('清晰可靠');
await page.getByRole('textbox', { name: '禁用表达' }).fill('绝对保证\n百分百');
await page.getByRole('textbox', { name: '小红书平台身份' }).fill('伦敦生活号');
await page.getByRole('textbox', { name: '小红书默认模板' }).fill('xiaohongshu-v1');
await page.getByRole('button', { name: '创建账号' }).click();
await page.getByText(/账号：伦敦生活号/).waitFor();
await page.getByRole('complementary', { name: '账号列表' }).getByRole('button', { name: '伦敦生活号' }).waitFor();
const account1 = (await dispatch('account.search', { query: '伦敦生活号', limit: 10 })).result.items[0];
if (!existsSync(account1.configFile.filePath) || account1.configFile.fileStatus !== 'present') throw new Error('界面账号配置文件未读回');

const client = new Client({ name: 'task-013-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpCreate = await client.callTool({ name: 'account.create', arguments: {
  caller: 'task-013-mcp', idempotencyKey: 'account-2', name: '曼城留学号', positioning: '留学生活',
  audience: '留学生', tone: '亲切', forbiddenExpressions: ['包过'],
  platformIdentities: { xiaohongshu: '曼城留学号' }, defaultTemplates: { xiaohongshu: '' }
}});
const account2Envelope = JSON.parse(mcpCreate.content[0].text);
if (!account2Envelope.ok) throw new Error(`MCP 账号创建失败: ${JSON.stringify(account2Envelope)}`);
const account2 = account2Envelope.result;
if (account2.platformStates.xiaohongshu.template !== 'invalid' || account2.platformStates.douyin.identity !== 'missing') {
  throw new Error('平台身份缺失或模板失效状态不明确');
}

const resource = await dispatch('resource.create', {
  caller: 'task-013', idempotencyKey: 'shared-resource', title: '共享英国资料', body: '同一底层资料'
});
const asset = await dispatch('asset.import', { caller: 'task-013', idempotencyKey: 'shared-asset', filePath: imagePath });
const contents = [];
for (const [index, account] of [account1, account2].entries()) {
  const content = await dispatch('content.create', {
    caller: 'task-013', idempotencyKey: `content-${index}`, accountId: account.id, title: `账号内容 ${index + 1}`
  });
  const saved = await dispatch('content.save_version', {
    contentId: content.result.id, expectedVersion: 1, body: `账号 ${index + 1} 正文`, outline: '', verificationItems: []
  });
  await dispatch('content.link_resource', { contentId: content.result.id, resourceId: resource.result.id });
  await dispatch('content.link_asset', { contentId: content.result.id, assetVersionId: asset.result.versionId, order: 0 });
  const version = saved.result.versions.filter((item) => !item.platform).at(-1);
  const candidate = await dispatch('package.create_preview', {
    caller: 'task-013', idempotencyKey: `candidate-${index}`, accountId: account.id, platform: 'xiaohongshu',
    contentVersionId: version.id, assetVersionIds: [asset.result.versionId], templateVersion: 'xiaohongshu-v1'
  });
  if (!candidate.ok || candidate.result.accountId !== account.id) throw new Error('发布候选账号归属错误');
  contents.push({ content: content.result, candidate: candidate.result });
}
if (contents[0].content.accountId !== account1.id || contents[1].content.accountId !== account2.id) throw new Error('内容账号归属错误');

const sharedResource1 = await dispatch('resource.get', { id: resource.result.id });
const sharedAsset1 = await dispatch('asset.get', { id: asset.result.id });
if (sharedResource1.result.usage.length !== 2 || sharedAsset1.result.usage.length !== 2) throw new Error('跨账号引用关系未读回');
if (readdirSync(resolve(rootPath, 'sources')).length !== 1 ||
    readdirSync(resolve(rootPath, 'assets', 'original')).filter((name) => name.endsWith('.png')).length !== 1) {
  throw new Error('跨账号引用复制了底层资料或素材');
}

const current1 = await dispatch('account.get', { id: account1.id });
const updated1 = await dispatch('account.update', {
  id: account1.id, expectedVersion: current1.result.version, tone: '更简洁',
  forbiddenExpressions: ['绝对保证'], platformIdentities: current1.result.platformIdentities,
  defaultTemplates: current1.result.defaultTemplates
});
const conflict = await dispatch('account.update', { id: account1.id, expectedVersion: current1.result.version, tone: '过期修改' });
if (!updated1.ok || conflict.ok || conflict.error.code !== 'VERSION_CONFLICT') throw new Error('账号版本冲突不明确');
appendFileSync(updated1.result.configFile.filePath, 'external-change');
const modified = await dispatch('account.get', { id: account1.id });
if (modified.result.configFile.fileStatus !== 'modified') throw new Error('账号配置文件外部修改未显示');

await page.getByRole('textbox', { name: '内容语气' }).fill('尚未保存的语气');
await page.getByText('有未保存修改').waitFor();
await page.getByRole('complementary', { name: '账号列表' }).getByRole('button', { name: '伦敦生活号' }).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'accounts.png') });

await client.close();
desktop.kill();
await browser.close().catch(() => undefined);
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', accounts: [modified.result, account2], contents, sharedResource: sharedResource1.result,
  sharedAsset: sharedAsset1.result, diskCounts: { sources: 1, originalAssets: 1 },
  failures: { versionConflict: conflict.error, invalidTemplate: account2.platformStates.xiaohongshu, externalModification: modified.result.configFile.fileStatus },
  rootPath
}, null, 2));
