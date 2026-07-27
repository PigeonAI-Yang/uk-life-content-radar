import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve('验收环境');
const rootPath = resolve(directory, '业务数据');
const profilePath = resolve(directory, '应用配置');
const sourcePath = resolve(directory, '英国租房资料.txt');
const imagePath = resolve(directory, '租房清单.png');
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
mkdirSync(rootPath, { recursive: true });
mkdirSync(profilePath, { recursive: true });
writeFileSync(sourcePath, '英国租房签约前应核对合同、押金保护、身份和收入材料。');
await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#0f6cbd' } }).png().toFile(imagePath);

const child = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9260'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9260'); break; } catch { await delay(200); }
}
if (!browser) throw new Error('验收应用后台启动失败');
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('验收应用窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
await page.getByRole('textbox', { name: '本地资料路径' }).fill(sourcePath);
await page.getByRole('textbox', { name: '原始图片路径' }).fill(imagePath);
await page.getByRole('button', { name: '创建账号、资料、内容与素材' }).click();
const output = page.locator('pre');
await output.waitFor();
const created = JSON.parse(await output.innerText());
await page.evaluate(() => globalThis.terminal.lifecycle.quit()).catch(() => undefined);
await browser.close().catch(() => undefined);
child.kill();
writeFileSync(resolve('artifacts', 'task-receipts', 'TASK-019', 'prepared-environment.json'), JSON.stringify({
  rootPath,
  profilePath,
  accountId: created.accountId,
  contentId: created.id,
  resources: created.resources.length,
  assets: created.assets.length
}, null, 2));
