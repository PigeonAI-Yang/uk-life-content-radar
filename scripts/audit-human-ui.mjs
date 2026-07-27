import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve('artifacts', 'task-receipts', 'TASK-019', 'ui-audit');
const executable = resolve('验收环境', '应用', 'content-media-terminal.exe');
const profile = resolve('验收环境', '应用配置');
mkdirSync(directory, { recursive: true });
const desktop = spawn(executable, ['--background-test', `--user-data-dir=${profile}`, '--remote-debugging-port=9262'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9262'); break; } catch { await delay(200); }
}
if (!browser) throw new Error('验收界面未启动');
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('验收主窗口不存在');
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));
await page.setViewportSize({ width: 1600, height: 900 });
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();

const routes = ['工作台', '浏览与收集', '资料库', '内容', '素材库', '发布包', '账号', '任务', '设置'];
const observations = [];
for (const route of routes) {
  await page.getByRole('button', { name: route, exact: true }).click();
  await page.getByRole('heading', { name: route, exact: true }).waitFor();
  await delay(300);
  const screenshot = resolve(directory, `${String(observations.length + 1).padStart(2, '0')}-${route}.png`);
  await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), screenshot);
  observations.push(await page.evaluate(({ route, screenshot }) => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    return {
      route,
      screenshot,
      headings: [...globalThis.document.querySelectorAll('main h1, main h2, main h3')].filter(visible).map((item) => item.textContent?.trim()),
      buttons: [...globalThis.document.querySelectorAll('main button')].filter(visible).map((item) => item.textContent?.trim() || item.getAttribute('aria-label')),
      inputs: [...globalThis.document.querySelectorAll('main input, main textarea, main [contenteditable="true"]')].filter(visible).map((item) => item.getAttribute('aria-label') || item.getAttribute('placeholder') || item.getAttribute('role')),
      text: globalThis.document.querySelector('main')?.innerText.slice(0, 3000),
      overflow: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth
    };
  }, { route, screenshot }));
}

await page.getByRole('button', { name: '工作台', exact: true }).click();
const beforeNew = await page.locator('main').innerText();
await page.getByRole('button', { name: '新建', exact: true }).click();
await delay(200);
const afterNew = await page.locator('main').innerText();
const header = await page.evaluate(() => [...globalThis.document.querySelectorAll('header > *')].map((element) => {
  const box = element.getBoundingClientRect();
  return { tag: element.tagName, label: element.getAttribute('aria-label'), text: element.textContent?.trim(), x: box.x, y: box.y, width: box.width, height: box.height, clipped: box.bottom > 48 || box.top < 0 };
}));
await page.evaluate(() => globalThis.terminal.lifecycle.quit()).catch(() => undefined);
await browser.close().catch(() => undefined);
desktop.kill();
writeFileSync(resolve(directory, 'observation.json'), JSON.stringify({
  viewport: { width: 1600, height: 900 },
  routes: observations,
  header,
  newButtonChangedView: beforeNew !== afterNew,
  consoleErrors
}, null, 2));
