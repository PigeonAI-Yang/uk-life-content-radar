import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-002');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9234'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9234');
    break;
  } catch {
    await delay(250);
  }
}
if (!browser) throw new Error('TASK-002 应用调试端口未就绪');
const page = browser.contexts().flatMap((context) => context.pages())
  .find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-002 业务窗口不存在');
await page.getByRole('heading', { name: '工作台' }).waitFor();
await page.evaluate((path) => globalThis.terminal.settings.initializeRoot(path), rootPath);

await page.getByRole('button', { name: '账号', exact: true }).click();
await page.getByRole('textbox', { name: '账号名称' }).fill('界面验证账号');
await page.getByRole('button', { name: '创建账号' }).click();
await page.getByText(/账号：界面验证账号/).waitFor();
await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'account-created.png'));

const exportPath = resolve(rootPath, 'exports');
const results = await page.evaluate(async (testExportPath) => {
  const dispatch = (name, input) => globalThis.terminal.business.dispatch(name, input);
  const request = {
    caller: 'task-002',
    idempotencyKey: 'same-create',
    name: '幂等账号',
    positioning: '本地内容',
    audience: '在英华人',
    tone: '清晰'
  };
  const identical = await Promise.all([
    dispatch('account.create', request),
    dispatch('account.create', request)
  ]);
  const conflict = await dispatch('account.create', { ...request, name: '不同参数' });
  const account = identical[0].ok ? identical[0].result : undefined;
  if (!account) throw new Error('幂等账号创建失败');
  const updates = await Promise.all([
    dispatch('account.update', { id: account.id, expectedVersion: 1, tone: '版本甲' }),
    dispatch('account.update', { id: account.id, expectedVersion: 1, tone: '版本乙' })
  ]);
  const readback = await dispatch('account.get', { id: account.id });
  const invalid = await dispatch('account.create', {
    caller: 'task-002',
    idempotencyKey: 'invalid',
    name: '',
    positioning: '',
    audience: '',
    tone: ''
  });
  const future = await dispatch('settings.update_export_directory', { directory: testExportPath });
  return { identical, conflict, updates, readback, invalid, future };
}, exportPath);

const [first, second] = results.identical;
if (!first.ok || !second.ok || first.result.id !== second.result.id) throw new Error('同键同参未返回同一对象');
if (results.conflict.ok || results.conflict.error.code !== 'IDEMPOTENCY_CONFLICT') throw new Error('同键异参未返回幂等冲突');
if (results.updates.filter((item) => item.ok).length !== 1) throw new Error('并发版本更新成功数不是 1');
if (!results.updates.some((item) => !item.ok && item.error.code === 'VERSION_CONFLICT')) throw new Error('并发版本冲突未返回');
if (!results.readback.ok || results.readback.result.version !== 2) throw new Error('写后读回版本错误');
if (results.invalid.ok || results.invalid.error.code !== 'INVALID_INPUT') throw new Error('无效输入未被拒绝');
if (!results.future.ok || results.future.result.exportDirectory !== exportPath) throw new Error('已交付设置命令未写后读回');

await browser.close();
child.kill();
await delay(300);

const databasePath = resolve(rootPath, '.content-terminal', 'index.sqlite');
if (!existsSync(databasePath)) throw new Error('统一命令未使用真实数据库');
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  databasePath,
  databaseBytes: statSync(databasePath).size,
  objectId: first.result.id,
  idempotency: 'same-object',
  idempotencyConflict: results.conflict.error.code,
  versionSuccesses: results.updates.filter((item) => item.ok).length,
  versionConflict: results.updates.find((item) => !item.ok)?.error.code,
  readback: results.readback.result,
  invalidInput: results.invalid.error.code,
  exportDirectory: results.future.result.exportDirectory
}, null, 2));
