import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-006');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const imageOne = resolve(runDirectory, '封面.png');
const imageTwo = resolve(runDirectory, '正文图.png');
mkdirSync(profilePath, { recursive: true });
await sharp({ create: { width: 120, height: 160, channels: 3, background: '#0078d4' } }).png().toFile(imageOne);
await sharp({ create: { width: 120, height: 160, channels: 3, background: '#107c10' } }).png().toFile(imageTwo);

const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9239'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9239');
    break;
  } catch {
    await delay(250);
  }
}
if (!browser) throw new Error('TASK-006 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-006 业务窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);

const account = await dispatch('account.create', { caller: 'task-006', idempotencyKey: 'account', name: '小红书账号', positioning: '英国生活', audience: '在英华人', tone: '实用' });
const assetOne = await dispatch('asset.import', { caller: 'task-006', idempotencyKey: 'asset-1', filePath: imageOne });
const assetTwo = await dispatch('asset.import', { caller: 'task-006', idempotencyKey: 'asset-2', filePath: imageTwo });
const content = await dispatch('content.create', { caller: 'task-006', idempotencyKey: 'content', accountId: account.result.id, title: '英国租房避坑' });
const saved = await dispatch('content.save_version', { contentId: content.result.id, expectedVersion: 1, body: '签合同前，先核对押金保护、账单责任和退租条款。' });
const firstVersionId = saved.result.versions.find((version) => version.version === 2).id;
const previewInput = {
  caller: 'task-006', idempotencyKey: 'preview-1', accountId: account.result.id, platform: 'xiaohongshu',
  contentVersionId: firstVersionId, assetVersionIds: [assetOne.result.versionId, assetTwo.result.versionId], templateVersion: 'xiaohongshu-v1'
};
const preview = await dispatch('package.create_preview', previewInput);
const unapproved = await dispatch('package.build', { caller: 'task-006', idempotencyKey: 'unapproved', candidateId: preview.result.id });
if (unapproved.ok || unapproved.error.code !== 'NOT_APPROVED') throw new Error('未批准发布包未被拒绝');
await dispatch('package.request_approval', { candidateId: preview.result.id });
await dispatch('approval.approve', { candidateId: preview.result.id });

const changed = await dispatch('content.save_version', { contentId: content.result.id, expectedVersion: 2, body: '正文已经变化。' });
const staleBody = await dispatch('package.get_approval', { candidateId: preview.result.id });
if (!staleBody.ok || staleBody.result.status !== 'stale') throw new Error('正文变化后批准未失效');

const latestVersionId = changed.result.versions.find((version) => version.version === 3).id;
const imageCandidate = await dispatch('package.create_preview', {
  ...previewInput, idempotencyKey: 'preview-image', contentVersionId: latestVersionId
});
await dispatch('package.request_approval', { candidateId: imageCandidate.result.id });
await dispatch('approval.approve', { candidateId: imageCandidate.result.id });
const originalImage = readFileSync(assetOne.result.filePath);
writeFileSync(assetOne.result.filePath, Buffer.concat([originalImage, Buffer.from('changed')]));
const staleImage = await dispatch('package.get_approval', { candidateId: imageCandidate.result.id });
if (!staleImage.ok || staleImage.result.status !== 'stale') throw new Error('图片变化后批准未失效');
writeFileSync(assetOne.result.filePath, originalImage);

const orderedCandidate = await dispatch('package.create_preview', {
  ...previewInput, idempotencyKey: 'preview-order', contentVersionId: latestVersionId,
  assetVersionIds: [assetTwo.result.versionId, assetOne.result.versionId]
});
const orderedBuild = await dispatch('package.build', { caller: 'task-006', idempotencyKey: 'order-build', candidateId: orderedCandidate.result.id });
if (orderedBuild.ok || orderedBuild.error.code !== 'NOT_APPROVED') throw new Error('图片顺序变化沿用了旧批准');

await page.getByRole('button', { name: '发布包', exact: true }).click();
await page.locator('select[aria-label="发布账号"]').selectOption(account.result.id);
await page.locator('select[aria-label="正文版本"]').selectOption(latestVersionId);
await page.locator('select[aria-label="发布图片"]').selectOption([assetOne.result.versionId, assetTwo.result.versionId]);
await page.getByRole('button', { name: '生成预览' }).click();
await page.getByRole('heading', { name: '英国租房避坑' }).waitFor();
await page.getByRole('button', { name: '请求批准' }).click();
await page.getByRole('button', { name: '人工批准' }).click();
await page.getByText('人工批准已绑定当前指纹').waitFor();
await page.getByRole('button', { name: '生成发布包' }).click();
await page.getByRole('button', { name: '打开目录' }).waitFor();
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'approved-package.png'));

const candidates = await dispatch('package.list_candidates', { query: '', limit: 25 });
const uiCandidate = candidates.result.items[0];
const uiPackage = await dispatch('package.build', { caller: 'task-006-readback', idempotencyKey: 'ui-package', candidateId: uiCandidate.id });
if (!uiPackage.ok || !existsSync(uiPackage.result.manifestPath)) throw new Error('发布包读回失败');
const manifest = JSON.parse(readFileSync(uiPackage.result.manifestPath, 'utf8'));
if (manifest.orderedImages.length !== 2 || uiPackage.result.files.length !== 4) throw new Error('发布包文件或图片顺序不完整');

await browser.close();
child.kill();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  candidateId: uiCandidate.id,
  package: uiPackage.result,
  manifest,
  failures: { unapproved: unapproved.error, staleBody: staleBody.result, staleImage: staleImage.result, reordered: orderedBuild.error },
  rootPath
}, null, 2));
