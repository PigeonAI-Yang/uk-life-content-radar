import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-012');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const sourcePath = resolve(runDirectory, 'source.png');
mkdirSync(profilePath, { recursive: true });
copyFileSync(resolve(receiptDirectory, 'sharp-dev', 'original.png'), sourcePath);

async function launch(port) {
  const process = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await delay(200); }
  }
  if (!browser) throw new Error('TASK-012 后台应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('TASK-012 主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  return { process, browser, page };
}

let runtime = await launch(9246);
await runtime.page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => runtime.page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

await runtime.page.getByRole('button', { name: '素材库', exact: true }).click();
await runtime.page.getByRole('textbox', { name: '导入图片路径' }).fill(sourcePath);
await runtime.page.getByRole('button', { name: '导入图片' }).click();
await runtime.page.getByRole('button', { name: '搜索素材' }).click();
await runtime.page.getByRole('button', { name: /source\.png/ }).click();
await runtime.page.getByRole('button', { name: /source\.png/ }).locator('img').waitFor();
for (const action of ['裁剪', '缩放', '压缩', '平台尺寸', '叠加文字']) {
  await runtime.page.getByRole('button', { name: action, exact: true }).waitFor();
}
await runtime.page.getByRole('button', { name: '列表视图' }).click();
await runtime.page.locator('.asset-list').waitFor();
await runtime.page.getByRole('button', { name: '网格视图' }).click();
await runtime.page.locator('.asset-grid').waitFor();
if (await runtime.page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.document.documentElement.clientWidth)) {
  throw new Error('素材库出现横向溢出');
}
await Promise.race([
  runtime.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'asset-library.png')),
  delay(10_000).then(() => { throw new Error('后台页面捕获超过 10 秒'); })
]);
let asset = (await dispatch('asset.search', { query: 'source.png', limit: 10 })).result.items[0];
if (!asset.width || !asset.height) throw new Error('原始素材尺寸未写后读回');
const original = asset.versions[0];
const originalBytes = readFileSync(original.filePath);
const originalDigest = createHash('sha256').update(originalBytes).digest('hex');

const call = async (name, input) => {
  const result = await dispatch(name, { caller: 'task-012', idempotencyKey: `${name}-${randomUUID()}`, assetId: asset.id, versionId: asset.versionId, ...input });
  if (!result.ok) throw new Error(`${name} 失败: ${JSON.stringify(result)}`);
  asset = result.result;
  return result.result.versions.at(-1);
};
const crop = await call('asset.crop', { left: 10, top: 10, width: 200, height: 150 });
const resize = await call('asset.resize', { width: 160, height: 120 });

const client = new Client({ name: 'task-012-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpCompressed = await client.callTool({ name: 'asset.compress', arguments: {
  caller: 'task-012-mcp', idempotencyKey: 'compress', assetId: asset.id, versionId: asset.versionId, quality: 55
}});
const mcpEnvelope = JSON.parse(mcpCompressed.content[0].text);
if (!mcpEnvelope.ok) throw new Error(`MCP 压缩失败: ${JSON.stringify(mcpEnvelope)}`);
asset = mcpEnvelope.result;
const compressed = asset.versions.at(-1);
const platform = await call('asset.convert_platform_size', { templateVersion: 'xiaohongshu-v1' });
const overlay = await call('asset.overlay_text', { text: '英国生活', font: 'Microsoft YaHei', size: 72, color: '#ffd700', x: 80, y: 180 });
if (crop.width !== 200 || resize.width !== 160 || platform.width !== 1080 || platform.height !== 1440 || overlay.sha256 === platform.sha256) {
  throw new Error('五项图片处理尺寸或中文叠字摘要不正确');
}
if (createHash('sha256').update(readFileSync(original.filePath)).digest('hex') !== originalDigest) throw new Error('图片处理覆盖了原图');

const account = await dispatch('account.create', { caller: 'task-012', idempotencyKey: 'account', name: '素材账号' });
const content = await dispatch('content.create', { caller: 'task-012', idempotencyKey: 'content', accountId: account.result.id, title: '素材使用记录' });
await dispatch('content.link_asset', { contentId: content.result.id, assetVersionId: asset.versionId, order: 0 });
asset = (await dispatch('asset.get', { id: asset.id })).result;
if (asset.usage.length !== 1) throw new Error('素材使用记录未读回');

const archived = await dispatch('asset.archive', { id: asset.id, expectedVersion: asset.version });
const hidden = await dispatch('asset.search', { query: 'source.png', limit: 10 });
if (hidden.result.items.length) throw new Error('归档素材仍出现在默认检索');
const restored = await dispatch('asset.restore', { id: asset.id, expectedVersion: archived.result.version });
asset = restored.result;

const invalidCrop = await dispatch('asset.crop', {
  caller: 'task-012', idempotencyKey: 'invalid-crop', assetId: asset.id, versionId: asset.versionId,
  left: 0, top: 0, width: 99999, height: 99999
});
if (invalidCrop.ok || invalidCrop.error.code !== 'FILE_UNWRITABLE') throw new Error('处理失败状态不明确');
asset = (await dispatch('asset.get', { id: asset.id })).result;
if (!asset.operations.some((operation) => operation.status === 'failed')) throw new Error('处理失败未持久化');

const diskFull = await dispatch('asset.resize', {
  caller: 'task-012', idempotencyKey: 'disk-full', assetId: asset.id, versionId: asset.versionId,
  width: 2147483647, height: 2147483647
});
if (diskFull.ok || diskFull.error.code !== 'DISK_FULL') throw new Error('磁盘不足失败实验不明确');
const settingsAfterDiskFull = await dispatch('settings.get', {});
if (!settingsAfterDiskFull.ok || settingsAfterDiskFull.result.storageAlert?.code !== 'DISK_FULL') throw new Error('设置未读回磁盘不足影响');

appendFileSync(asset.versions.at(-1).filePath, 'external-change');
const modified = await dispatch('asset.get', { id: asset.id });
if (modified.result.versions.at(-1).fileStatus !== 'modified') throw new Error('外部修改未显示');
const processModified = await dispatch('asset.resize', {
  caller: 'task-012', idempotencyKey: 'modified-process', assetId: asset.id, versionId: asset.versionId, width: 100, height: 100
});
if (processModified.ok || processModified.error.code !== 'FILE_MODIFIED') throw new Error('外部修改未阻止处理');
const externalPath = resolve(runDirectory, 'external-version.png');
copyFileSync(sourcePath, externalPath);
const external = await dispatch('asset.import_external_version', {
  caller: 'task-012', idempotencyKey: 'external', assetId: asset.id, versionId: asset.versionId, filePath: externalPath
});
if (!external.ok || !existsSync(external.result.versions.at(-1).filePath)) throw new Error('外部修改版本导入失败');
asset = external.result;

const missingVersion = asset.versions.find((version) => version.operation === 'resize');
unlinkSync(missingVersion.filePath);
const missing = await dispatch('asset.get', { id: asset.id });
if (missing.result.versions.find((version) => version.id === missingVersion.id).fileStatus !== 'missing') throw new Error('文件丢失未显示');
const processMissing = await dispatch('asset.resize', {
  caller: 'task-012', idempotencyKey: 'missing-process', assetId: asset.id, versionId: missingVersion.id, width: 80, height: 80
});
if (processMissing.ok || processMissing.error.code !== 'FILE_MISSING') throw new Error('文件丢失处理失败不明确');

await runtime.page.evaluate(([assetId, versionId]) => {
  void globalThis.terminal.business.dispatch('asset.resize', {
    caller: 'task-012', idempotencyKey: 'interrupt', assetId, versionId, width: 12000, height: 12000
  });
}, [asset.id, asset.versionId]);
await delay(150);
runtime.process.kill();
await delay(1000);
await runtime.browser.close().catch(() => undefined);
runtime = await launch(9247);
const interrupted = await runtime.page.evaluate((id) => globalThis.terminal.business.dispatch('asset.get', { id }), asset.id);
if (!interrupted.ok || !interrupted.result.operations.some((operation) => operation.status === 'interrupted')) {
  throw new Error('图片处理中断未在重启后读回');
}

await client.close();
runtime.process.kill();
await runtime.browser.close().catch(() => undefined);
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', assetId: asset.id, original: { ...original, verifiedSha256: originalDigest },
  outputs: { crop, resize, compressed, platform, overlay }, versions: interrupted.result.versions,
  failures: { invalidCrop: invalidCrop.error, diskFull: diskFull.error, modified: processModified.error, missing: processMissing.error },
  interruptedOperation: interrupted.result.operations.find((operation) => operation.status === 'interrupted'),
  usage: interrupted.result.usage, sharpDevelopment: resolve(receiptDirectory, 'sharp-dev', 'result.json'),
  sharpPackaged: resolve(receiptDirectory, 'sharp-packed', 'result.json'), rootPath
}, null, 2));
