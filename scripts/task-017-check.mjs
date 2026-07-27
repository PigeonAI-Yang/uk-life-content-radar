import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-017');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });
const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9252'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9252'); break; } catch { await delay(200); }
}
if (!browser) throw new Error('TASK-017 后台应用未启动');
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-017 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate(() => globalThis.terminal.lifecycle.reopenWindow());
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const empty = await page.evaluate(async () => Promise.all([
  globalThis.terminal.business.dispatch('account.search', { query: '', limit: 25 }),
  globalThis.terminal.business.dispatch('task.list', { query: '', limit: 25 }),
  globalThis.terminal.business.dispatch('package.list_candidates', { query: '', limit: 100 })
]));
if (empty.some((result) => !result.ok || result.result.items.length)) throw new Error('工作台首次空查询不为空');
await page.screenshot({ path: resolve(receiptDirectory, 'first-empty.png'), animations: 'disabled' });

const routes = ['工作台', '浏览与收集', '资料库', '内容', '素材库', '发布包', '账号', '任务', '设置'];
const routeEvidence = [];
for (const route of routes) {
  await page.getByRole('button', { name: route, exact: true }).click();
  await page.getByRole('heading', { name: route, exact: true }).waitFor();
  const dimensions = await page.locator('button').evaluateAll((buttons) => buttons.flatMap((button) => {
    const box = button.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      ? [{ name: button.textContent?.trim() || button.getAttribute('aria-label'), width: box.width, height: box.height }]
      : [];
  }));
  const undersized = dimensions.filter((item) => item.width < 32 || item.height < 32);
  if (undersized.length) throw new Error(`${route} 点击目标小于 32x32: ${JSON.stringify(undersized)}`);
  const screenshot = resolve(receiptDirectory, `route-${routes.indexOf(route) + 1}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  routeEvidence.push({ route, screenshot, clickTargets: dimensions.length });
}

await page.getByRole('button', { name: '工作台', exact: true }).click();
await page.locator('body').focus();
let keyboardReached = false;
for (let step = 0; step < 30; step += 1) {
  await page.keyboard.press('Tab');
  const active = await page.evaluate(() => ({ text: globalThis.document.activeElement?.textContent?.trim(), label: globalThis.document.activeElement?.getAttribute('aria-label') }));
  if (active.text === '资料库') {
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: '资料库', exact: true }).waitFor();
    keyboardReached = true;
    break;
  }
}
if (!keyboardReached) throw new Error('键盘无法到达资料库主链');
const focusStyle = await page.getByRole('button', { name: '资料库', exact: true }).evaluate((element) => {
  element.focus();
  const style = globalThis.getComputedStyle(element);
  return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
});
if (focusStyle.outlineStyle === 'none' || focusStyle.outlineWidth === '0px') throw new Error('焦点环不可见');

const widths = [1280, 1600, 1920, 2560];
const layouts = [];
for (const width of widths) {
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${width} 宽度出现 ${overflow}px 水平溢出`);
  const screenshot = resolve(receiptDirectory, `layout-${width}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  const metadata = await sharp(screenshot).metadata();
  layouts.push({ width, viewport: await page.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight })), image: { width: metadata.width, height: metadata.height }, overflow });
}

const session = await context.newCDPSession(page);
const scaling = [];
for (const scale of [1.25, 1.5]) {
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: scale, mobile: false });
  const devicePixelRatio = await page.evaluate(() => globalThis.devicePixelRatio);
  if (Math.abs(devicePixelRatio - scale) > 0.01) throw new Error(`${scale} 系统缩放模拟失败`);
  const screenshot = resolve(receiptDirectory, `scale-${String(scale).replace('.', '')}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  scaling.push({ scale, devicePixelRatio, screenshot });
}
await session.send('Emulation.clearDeviceMetricsOverride');
await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%'; });
await page.getByRole('button', { name: '设置', exact: true }).click();
for (const name of ['扫描存储', '保存导出目录', '完全退出']) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) throw new Error(`200% 文字下关键动作不可见: ${name}`);
}
await page.screenshot({ path: resolve(receiptDirectory, 'text-200.png'), animations: 'disabled' });
await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = ''; });

const contrast = await page.evaluate(() => {
  const parse = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const luminance = (rgb) => rgb.map((part) => {
    const value = part / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const body = globalThis.getComputedStyle(globalThis.document.body);
  const foreground = luminance(parse(body.color));
  const background = luminance(parse(body.backgroundColor));
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
});
if (contrast < 4.5) throw new Error(`正文对比度不足: ${contrast}`);

await page.getByRole('button', { name: '浏览与收集', exact: true }).click();
await page.getByRole('textbox', { name: '浏览器地址' }).waitFor();
await context.setOffline(true);
const tab = await page.evaluate(() => globalThis.terminal.business.dispatch('browser.tabs.list', {}));
const tabId = tab.ok ? tab.result.activeId : '';
await page.evaluate(async (id) => {
  try { await globalThis.terminal.browser.navigate(id, 'https://example.com'); } catch { /* expected offline navigation */ }
}, tabId);
await page.getByRole('button', { name: '工作台', exact: true }).click();
await page.getByRole('button', { name: '浏览与收集', exact: true }).click();
await page.getByText(/页面状态：offline/).waitFor();
await page.getByRole('button', { name: '收藏网页' }).click();
await page.getByText(/OFFLINE/).waitFor();
await page.screenshot({ path: resolve(receiptDirectory, 'browser-offline.png'), animations: 'disabled' });
await context.setOffline(false);

const matrix = JSON.parse(readFileSync(resolve(receiptDirectory, 'state-matrix.json'), 'utf8'));
for (const [route, evidence] of Object.entries(matrix)) {
  if (!routes.includes(route) || evidence.states.length < 4 || !existsSync(resolve(evidence.receipt)) ||
      evidence.screenshots.some((file) => !existsSync(resolve(file)))) throw new Error(`状态矩阵证据不完整: ${route}`);
}

spawnSync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { encoding: 'utf8' });
await browser.close().catch(() => undefined);
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', routes: routeEvidence, layouts, scaling, keyboard: { reached: keyboardReached, focusStyle },
  accessibility: { bodyContrast: contrast, textZoom: 2 }, stateMatrix: matrix, foregroundPolicy: 'hidden'
}, null, 2));
