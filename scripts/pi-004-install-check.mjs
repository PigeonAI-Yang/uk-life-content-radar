import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const receiptDirectory = resolve(project, 'artifacts', 'task-receipts', 'PI-004');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const setupPath = resolve(project, 'out', 'make', 'squirrel.windows', 'x64', '自媒体桌面终端-0.1.0 Setup.exe');
const installDirectory = resolve(process.env.LOCALAPPDATA, 'content_media_terminal');
const executablePath = resolve(installDirectory, 'app-0.1.0', 'content-media-terminal.exe');
const updatePath = resolve(installDirectory, 'Update.exe');
mkdirSync(profilePath, { recursive: true });

function install() {
  const result = spawnSync(setupPath, ['--silent'], { stdio: 'ignore' });
  if (result.status !== 0 || !existsSync(executablePath)) throw new Error('静默安装失败');
}

async function openInstalled(port) {
  const desktop = spawn(executablePath, [
    '--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`
  ], { stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) throw new Error('已安装应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('已安装应用没有业务窗口');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  return { desktop, browser, page };
}

async function closeInstalled(handle) {
  await handle.browser.close();
  handle.desktop.kill();
  await Promise.race([new Promise((done) => handle.desktop.once('exit', done)), delay(5000)]);
}

install();
let handle = await openInstalled(9701);
await handle.page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const created = await handle.page.evaluate(() => globalThis.terminal.business.dispatch('account.create', {
  caller: 'pi-004-install', idempotencyKey: 'account', name: '安装保留验收账号',
  positioning: '英国生活', audience: '在英华人', tone: '自然'
}));
if (!created.ok) throw new Error(`安装应用写入失败: ${JSON.stringify(created)}`);
await closeInstalled(handle);

handle = await openInstalled(9702);
const readback = await handle.page.evaluate(() => globalThis.terminal.business.dispatch('account.search', {
  query: '安装保留验收账号', limit: 5
}));
if (!readback.ok || readback.result.items.length !== 1) throw new Error('重开后账号读回失败');
await closeInstalled(handle);

const uninstall = spawnSync(updatePath, ['--uninstall', '-s'], { stdio: 'ignore' });
if (uninstall.status !== 0) throw new Error('静默卸载失败');
await delay(2000);
if (!existsSync(rootPath) || !existsSync(resolve(rootPath, '.content-terminal', 'index.sqlite'))) {
  throw new Error('卸载后业务数据未保留');
}
install();

const result = {
  task: 'PI-004',
  status: 'completed',
  installer: setupPath,
  installedExecutable: executablePath,
  businessRoot: rootPath,
  accountId: created.result.id,
  checks: { install: true, reopenReadback: true, uninstallPreservesBusinessData: true, reinstall: true },
  note: '真实模型与 MCP 接力由 custom-api-result.json 证明'
};
writeFileSync(resolve(receiptDirectory, 'install-result.json'), JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
