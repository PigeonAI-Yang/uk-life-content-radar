import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-001');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const successRoot = resolve(runDirectory, 'business-root');
const successProfile = resolve(runDirectory, 'success-profile');
const deniedRoot = resolve(runDirectory, 'denied-root');
const deniedProfile = resolve(runDirectory, 'denied-profile');
mkdirSync(successProfile, { recursive: true });
mkdirSync(deniedRoot, { recursive: true });
mkdirSync(deniedProfile, { recursive: true });

async function launch(profile) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配验收端口');
  const port = address.port;
  server.close();
  await once(server, 'close');
  const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) {
    child.kill();
    throw new Error(`应用调试端口未就绪: ${port}`);
  }
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('设置验收窗口不存在');
  await page.getByRole('heading', { name: '工作台' }).waitFor();
  return { browser, child, page };
}

async function close(instance) {
  await instance.browser.close();
  instance.child.kill();
  if (instance.child.exitCode === null) await once(instance.child, 'exit');
}

const user = process.env.USERNAME;
if (!user) throw new Error('无法确定当前 Windows 用户');
const deny = spawnSync('icacls.exe', [deniedRoot, '/inheritance:r', '/deny', `${user}:(OI)(CI)W`], { encoding: 'utf8' });
if (deny.status !== 0) throw new Error(`无法创建不可写实验目录: ${deny.stderr || deny.stdout}`);

let deniedError = '';
let deniedInstance;
try {
  deniedInstance = await launch(deniedProfile);
  deniedError = await deniedInstance.page.evaluate(async (rootPath) => {
    try {
      await globalThis.terminal.settings.initializeRoot(rootPath);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, deniedRoot);
  if (!deniedError) throw new Error('不可写根目录初始化意外成功');
  if (existsSync(resolve(deniedRoot, '.content-terminal', 'index.sqlite'))) {
    throw new Error('不可写实验留下了数据库');
  }
} finally {
  if (deniedInstance) await close(deniedInstance);
  spawnSync('icacls.exe', [deniedRoot, '/remove:d', user, '/grant', `${user}:(OI)(CI)F`], { encoding: 'utf8' });
}

const first = await launch(successProfile);
await first.page.getByRole('button', { name: '设置' }).click();
await first.page.getByRole('textbox', { name: '业务根目录' }).fill(successRoot);
await first.page.getByRole('button', { name: '初始化' }).click();
await first.page.getByText('全文检索').waitFor();
await first.page.getByText('可用', { exact: true }).waitFor();
await first.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'initialized.png'));
const secondInitializationError = await first.page.evaluate(async (rootPath) => {
  try {
    await globalThis.terminal.settings.initializeRoot(rootPath);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}, resolve(runDirectory, 'other-root'));
if (!secondInitializationError.includes('ROOT_ALREADY_INITIALIZED')) {
  throw new Error(`二次初始化未返回预期错误: ${secondInitializationError}`);
}
await close(first);

const second = await launch(successProfile);
await second.page.getByRole('button', { name: '设置' }).click();
await second.page.getByText(resolve(successRoot, '.content-terminal', 'index.sqlite'), { exact: true }).waitFor();
await second.page.getByText('可用', { exact: true }).waitFor();
await second.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'restart-readback.png'));
await close(second);

const requiredPaths = [
  'sources',
  'assets/original',
  'assets/derived',
  'packages',
  '.content-terminal/tmp',
  '.content-terminal/index.sqlite'
];
const files = requiredPaths.map((relativePath) => {
  const absolutePath = resolve(successRoot, relativePath);
  const stat = statSync(absolutePath);
  return { relativePath, absolutePath, bytes: stat.size, directory: stat.isDirectory() };
});
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  rootPath: successRoot,
  migrationVersion: 1,
  fts5: true,
  deniedError,
  secondInitializationError,
  files
}, null, 2));
