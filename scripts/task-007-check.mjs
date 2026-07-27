import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-007');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const sourcePath = resolve(runDirectory, '资料.txt');
const imagePath = resolve(runDirectory, '图片.png');
mkdirSync(profilePath, { recursive: true });
writeFileSync(sourcePath, '英国生活双入口资料');
await sharp({ create: { width: 100, height: 120, channels: 3, background: '#5c2d91' } }).png().toFile(imagePath);

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9240'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9240'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('TASK-007 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-007 业务窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
await page.getByRole('textbox', { name: '本地资料路径' }).fill(sourcePath);
await page.getByRole('textbox', { name: '原始图片路径' }).fill(imagePath);
await page.getByRole('button', { name: '创建账号、资料、内容与素材' }).click();
await page.getByText('快速开始已完成，可从内容、资料库和素材库继续编辑。').waitFor();
const uiAccounts = await dispatch('account.search', { query: '英国生活账号', limit: 10 });
const uiAccount = uiAccounts.ok && uiAccounts.result.items[0]
  ? await dispatch('account.get', { id: uiAccounts.result.items[0].id }) : undefined;
if (!uiAccount?.ok || !uiAccount.result.usage.contents[0]) throw new Error('界面最小闭环未读回');
const uiReadback = await dispatch('content.get', { id: uiAccount.result.usage.contents[0].id });
if (!uiReadback.ok) throw new Error('界面内容未读回');
const uiContent = uiReadback.result;
const uiVersion = uiContent.versions.find((version) => version.version === 2);
await page.getByRole('button', { name: '发布包', exact: true }).click();
await page.locator('select[aria-label="发布账号"]').selectOption(uiContent.accountId);
await page.locator('select[aria-label="正文版本"]').selectOption(uiVersion.id);
await page.locator('select[aria-label="发布图片"]').selectOption(uiContent.assets[0].asset_version_id);
await page.getByRole('button', { name: '生成预览' }).click();
await page.getByRole('button', { name: '请求批准' }).click();
await page.getByRole('button', { name: '人工批准' }).click();
await page.getByRole('button', { name: '生成发布包' }).click();
await page.getByRole('button', { name: '打开目录' }).waitFor();
const uiManifestPath = resolve(rootPath, 'packages', readdirSync(resolve(rootPath, 'packages'))[0], 'manifest.json');
const uiManifest = JSON.parse(readFileSync(uiManifestPath, 'utf8'));

const client = new Client({ name: 'task-007-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const call = async (name, argumentsValue) => {
  const response = await client.callTool({ name, arguments: argumentsValue });
  const envelope = JSON.parse(response.content[0].text);
  if (!envelope.ok) throw new Error(`${name}: ${response.content[0].text}`);
  return envelope.result;
};
const mcpAccount = await call('account.create', { caller: 'task-007-mcp', idempotencyKey: 'account', name: 'MCP 账号', positioning: '英国生活', audience: '在英华人', tone: '实用' });
const mcpResource = await call('resource.create', { caller: 'task-007-mcp', idempotencyKey: 'resource', title: 'MCP 资料', body: '', filePath: sourcePath });
const mcpAsset = await call('asset.import', { caller: 'task-007-mcp', idempotencyKey: 'asset', filePath: imagePath });
const mcpContent = await call('content.create', { caller: 'task-007-mcp', idempotencyKey: 'content', accountId: mcpAccount.id, title: 'MCP 内容' });
const mcpSaved = await call('content.save_version', { contentId: mcpContent.id, expectedVersion: 1, body: 'MCP 公共草稿' });
const mcpVersion = mcpSaved.versions.find((version) => version.version === 2);
await call('content.generate_platform_version', { caller: 'task-007-mcp', idempotencyKey: 'platform', contentId: mcpContent.id, platform: 'xiaohongshu' });
await call('content.link_resource', { contentId: mcpContent.id, resourceId: mcpResource.id });
await call('content.link_asset', { contentId: mcpContent.id, assetVersionId: mcpAsset.versionId, order: 0 });
const mcpCandidate = await call('package.create_preview', {
  caller: 'task-007-mcp', idempotencyKey: 'preview', accountId: mcpAccount.id, platform: 'xiaohongshu',
  contentVersionId: mcpVersion.id, assetVersionIds: [mcpAsset.versionId], templateVersion: 'xiaohongshu-v1'
});
await call('package.request_approval', { candidateId: mcpCandidate.id });

await page.getByRole('button', { name: '刷新候选' }).click();
await page.locator('select[aria-label="待批准候选"]').selectOption(mcpCandidate.id);
await page.getByRole('button', { name: '加载候选' }).click();
await page.getByRole('heading', { name: 'MCP 内容' }).waitFor();
await page.getByRole('button', { name: '人工批准' }).click();
await page.getByText('人工批准已绑定当前指纹').waitFor();
const mcpPackage = await call('package.build', { caller: 'task-007-mcp', idempotencyKey: 'build', candidateId: mcpCandidate.id });
const mcpReadback = await call('package.get', { id: mcpPackage.id });
const mcpManifest = JSON.parse(readFileSync(mcpReadback.manifestPath, 'utf8'));
if (JSON.stringify(Object.keys(uiManifest).sort()) !== JSON.stringify(Object.keys(mcpManifest).sort())) throw new Error('双入口清单结构不一致');
if (mcpReadback.files.length !== 3 || mcpReadback.status !== 'completed') throw new Error('MCP 发布包读回不完整');

await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'dual-entry.png'));
await client.close();
await browser.close();
desktop.kill();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', ui: { contentId: uiContent.id, manifest: uiManifest },
  mcp: { account: mcpAccount, resource: mcpResource, asset: mcpAsset, content: mcpSaved, candidate: mcpCandidate, package: mcpReadback, manifest: mcpManifest },
  comparedManifestKeys: Object.keys(uiManifest).sort(), rootPath, profilePath
}, null, 2));
