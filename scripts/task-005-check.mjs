import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-005');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const sourceFixture = resolve(runDirectory, '英国资料.txt');
const imageFixture = resolve(runDirectory, '原图.png');
mkdirSync(profilePath, { recursive: true });
writeFileSync(sourceFixture, '英国租房需要核对合同、押金保护和账单。');
await sharp({ create: { width: 80, height: 60, channels: 3, background: '#d13438' } }).png().toFile(imageFixture);

const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9238'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
    break;
  } catch {
    await delay(250);
  }
}
if (!browser) throw new Error('TASK-005 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-005 业务窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
await page.getByRole('textbox', { name: '本地资料路径' }).fill(sourceFixture);
await page.getByRole('textbox', { name: '原始图片路径' }).fill(imageFixture);
const dispatch = (name, input) => page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
await page.getByRole('button', { name: '创建账号、资料、内容与素材' }).click();
await page.getByText('快速开始已完成，可从内容、资料库和素材库继续编辑。').waitFor();
const accounts = await dispatch('account.search', { query: '英国生活账号', limit: 10 });
if (!accounts.ok || !accounts.result.items[0]) throw new Error('界面创建账号未读回');
const account = await dispatch('account.get', { id: accounts.result.items[0].id });
if (!account.ok || !account.result.usage.contents[0]) throw new Error('界面创建内容关系未读回');
const readback = await dispatch('content.get', { id: account.result.usage.contents[0].id });
if (!readback.ok) throw new Error('界面创建内容未读回');
const content = readback.result;
if (!content.versions.some((version) => version.platform === 'xiaohongshu')) throw new Error('没有小红书平台版本');
if (content.resources.length !== 1 || content.assets.length !== 1) throw new Error('内容关系不完整');

const resourceId = content.resources[0].source_id;
const assetVersionId = content.assets[0].asset_version_id;
const assetId = content.assets[0].asset_id;
const resource = await dispatch('resource.get', { id: resourceId });
const asset = await dispatch('asset.get', { id: assetId });
if (!resource.ok || !asset.ok || !existsSync(resource.result.filePath) || !existsSync(asset.result.filePath)) throw new Error('文件型对象读回失败');
if (!resource.result.sha256 || !asset.result.sha256 || resource.result.fileStatus !== 'present' || asset.result.fileStatus !== 'present') {
  throw new Error('文件摘要或状态不完整');
}

await dispatch('content.unlink_resource', { contentId: content.id, resourceId });
await dispatch('content.unlink_asset', { contentId: content.id, assetVersionId });
const afterUnlink = await dispatch('content.get', { id: content.id });
if (!afterUnlink.ok || afterUnlink.result.resources.length || afterUnlink.result.assets.length) throw new Error('移除关系失败');
if (!(await dispatch('resource.get', { id: resourceId })).ok || !(await dispatch('asset.get', { id: assetId })).ok) {
  throw new Error('移除关系错误删除了底层对象');
}

const idempotentInput = { caller: 'task-005', idempotencyKey: 'same-asset', filePath: imageFixture };
const firstImport = await dispatch('asset.import', idempotentInput);
const repeatedImport = await dispatch('asset.import', idempotentInput);
if (!firstImport.ok || !repeatedImport.ok || firstImport.result.id !== repeatedImport.result.id) throw new Error('素材导入幂等读回失败');

const deniedDirectory = resolve(rootPath, 'assets', 'original');
const user = process.env.USERNAME;
if (!user) throw new Error('无法确定 Windows 用户');
const deny = spawnSync('icacls.exe', [deniedDirectory, '/inheritance:r', '/deny', `${user}:(OI)(CI)W`], { encoding: 'utf8' });
if (deny.status !== 0) throw new Error(`无法设置不可写目录: ${deny.stderr || deny.stdout}`);
let denied;
try {
  denied = await dispatch('asset.import', { caller: 'task-005', idempotencyKey: 'denied', filePath: imageFixture });
  if (denied.ok || denied.error.code !== 'FILE_UNWRITABLE') throw new Error('不可写导入未明确失败');
} finally {
  spawnSync('icacls.exe', [deniedDirectory, '/remove:d', user, '/grant', `${user}:(OI)(CI)F`], { encoding: 'utf8' });
}
if (readdirSync(deniedDirectory).length !== 2) throw new Error('不可写导入留下完成文件');

await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'minimum-loop.png'));
await browser.close();
child.kill();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  accountId: content.accountId,
  contentId: content.id,
  contentVersion: content.version,
  platform: 'xiaohongshu',
  resource: resource.result,
  asset: asset.result,
  relationsAfterUnlink: afterUnlink.result,
  idempotentAssetId: firstImport.result.id,
  deniedImport: denied.error,
  rootPath
}, null, 2));
