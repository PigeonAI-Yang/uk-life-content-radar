import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-014');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });
const imageSource = resolve('artifacts', 'task-receipts', 'TASK-012', 'sharp-dev', 'original.png');
const imagePaths = ['小红书.png', '抖音.png', '微信.png'].map((name) => resolve(runDirectory, name));
imagePaths.forEach((file) => copyFileSync(imageSource, file));

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9249'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9249'); break; } catch { await delay(200); }
}
if (!browser) throw new Error('TASK-014 后台应用未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-014 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const account = (await dispatch('account.create', {
  caller: 'task-014', idempotencyKey: 'account', name: '三平台账号', positioning: '英国生活',
  audience: '在英华人', tone: '实用', platformIdentities: { xiaohongshu: '英国生活', douyin: '英国生活', wechat: '英国生活' },
  defaultTemplates: { xiaohongshu: 'xiaohongshu-v1', douyin: 'douyin-v1', wechat: 'wechat-v1' }
})).result;
const resource = (await dispatch('resource.create', {
  caller: 'task-014', idempotencyKey: 'source', title: '英国官方租房指南', body: '官方材料核验'
})).result;
const assets = [];
for (const [index, filePath] of imagePaths.entries()) {
  assets.push((await dispatch('asset.import', { caller: 'task-014', idempotencyKey: `asset-${index}`, filePath })).result);
}
const content = (await dispatch('content.create', { caller: 'task-014', idempotencyKey: 'content', accountId: account.id, title: '英国租房材料清单' })).result;
const saved = (await dispatch('content.save_version', {
  contentId: content.id, expectedVersion: 1, body: '签约前核对身份证明、收入材料和押金保护。\n保留全部原始文件。', outline: '', verificationItems: ['官方来源']
})).result;
await dispatch('content.link_resource', { contentId: content.id, resourceId: resource.id });
const versionId = saved.versions.find((version) => version.version === 2).id;

const client = new Client({ name: 'task-014-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
if (toolNames.includes('approval.approve')) throw new Error('MCP 不得暴露最终批准工具');

const candidates = [];
for (const [index, platform] of ['xiaohongshu', 'douyin', 'wechat'].entries()) {
  const input = {
    caller: index === 1 ? 'task-014-mcp' : 'task-014', idempotencyKey: `preview-${platform}`, accountId: account.id, platform,
    contentVersionId: versionId, assetVersionIds: [assets[index].versionId], templateVersion: `${platform}-v1`
  };
  if (index === 1) {
    const response = await client.callTool({ name: 'package.create_preview', arguments: input });
    const envelope = JSON.parse(response.content[0].text);
    if (!envelope.ok) throw new Error(`MCP 预览失败: ${JSON.stringify(envelope)}`);
    candidates.push(envelope.result);
  } else {
    candidates.push((await dispatch('package.create_preview', input)).result);
  }
}
if (new Set(candidates.map((item) => item.currentFingerprint)).size !== 3) throw new Error('平台未绑定到批准指纹');

await page.getByRole('button', { name: '发布包', exact: true }).click();
await page.locator('select[aria-label="发布平台"]').selectOption('wechat');
await page.locator('select[aria-label="发布账号"]').selectOption(account.id);
await page.locator('select[aria-label="正文版本"]').selectOption(versionId);
await page.locator('select[aria-label="发布图片"]').selectOption(assets[2].versionId);
await page.getByRole('button', { name: '生成预览' }).click();
await page.getByRole('heading', { name: '英国租房材料清单' }).waitFor();
await page.getByText(/英国官方租房指南/).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'wechat-preview.png') });

const unapproved = await dispatch('package.build', {
  caller: 'task-014', idempotencyKey: 'unapproved-build', candidateId: candidates[0].id
});
if (unapproved.ok || unapproved.error.code !== 'NOT_APPROVED') throw new Error('未批准发布包未被阻止');

for (const candidate of candidates) {
  await dispatch('package.request_approval', { candidateId: candidate.id });
  await dispatch('approval.approve', { candidateId: candidate.id });
}
const full = await dispatch('package.build', {
  caller: 'task-014', idempotencyKey: 'full-build', candidateIds: candidates.map((candidate) => candidate.id)
});
if (!full.ok || full.result.status !== 'completed') throw new Error(`三平台构建失败: ${JSON.stringify(full)}`);
const packs = full.result.results.map((result) => result.package);
const manifests = packs.map((pack) => JSON.parse(readFileSync(pack.manifestPath, 'utf8')));
if (manifests.map((item) => item.platform).join(',') !== 'xiaohongshu,douyin,wechat') throw new Error('三平台发布包互相污染');
if (!manifests.every((item) => item.sources.length === 1 && item.review.status === 'approved')) throw new Error('来源或审核记录未写入清单');
const wechatPack = packs[2];
const wechatHtml = wechatPack.files.find((file) => file.relative_path === '公众号正文.html');
if (!wechatHtml || !existsSync(wechatHtml.absolute_path) || !readFileSync(wechatHtml.absolute_path, 'utf8').includes('图片/01.png')) throw new Error('微信公众号最低复制格式失败');

const originalImage = readFileSync(assets[0].filePath);
writeFileSync(assets[0].filePath, Buffer.concat([originalImage, Buffer.from('external-change')]));
const staleApproval = await dispatch('package.get_approval', { candidateId: candidates[0].id });
if (!staleApproval.ok || staleApproval.result.status !== 'stale') throw new Error('图片变化后旧批准未失效');
writeFileSync(assets[0].filePath, originalImage);

rmSync(assets[1].filePath);
const partial = await dispatch('package.build', {
  caller: 'task-014', idempotencyKey: 'partial-build', candidateIds: candidates.map((candidate) => candidate.id)
});
if (!partial.ok || partial.result.status !== 'partial' || partial.result.results.filter((item) => item.ok).length !== 2 ||
    partial.result.results[1].error.code !== 'FILE_MISSING') throw new Error(`部分成功状态错误: ${JSON.stringify(partial)}`);

await client.close();
desktop.kill();
await browser.close().catch(() => undefined);
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', rootPath, account, candidates, packages: packs, manifests,
  failures: { unapproved: unapproved.error, staleApproval: staleApproval.result, missingFile: partial.result.results[1], batchStatus: partial.result.status },
  mcp: { previewCandidateId: candidates[1].id, approvalToolExposed: false }
}, null, 2));
