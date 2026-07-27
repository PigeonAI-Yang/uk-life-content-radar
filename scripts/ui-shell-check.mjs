import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = globalThis.process.env.UI_EXECUTABLE_PATH
  ? resolve(globalThis.process.env.UI_EXECUTABLE_PATH)
  : resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const receiptDirectory = resolve('artifacts', 'task-receipts', globalThis.process.env.UI_RECEIPT_ID ?? 'TASK-000');
const endpoint = 'http://127.0.0.1:9223';
if (!existsSync(executablePath)) throw new Error(`打包应用不存在: ${executablePath}`);
mkdirSync(receiptDirectory, { recursive: true });

const child = spawn(executablePath, ['--background-test', '--remote-debugging-port=9223'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(endpoint);
      break;
    } catch {
      await delay(500);
    }
  }
  if (!browser) throw new Error('打包应用调试端口未就绪');
  const errors = [];
  let page;
  for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
    page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes('/main_window/index.html'));
    if (!page) await delay(250);
  }
  if (!page) {
    const urls = browser.contexts().flatMap((context) => context.pages().map((candidate) => candidate.url()));
    throw new Error(`打包应用业务窗口不存在: ${urls.join(', ')}`);
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await delay(500);
  if (!await page.getByText('自媒体桌面终端', { exact: true }).count()) {
    const diagnostics = await page.evaluate(() => ({
      body: globalThis.document.body.innerText,
      scripts: [...globalThis.document.scripts].map((script) => script.src)
    }));
    throw new Error(`打包应用渲染失败: ${JSON.stringify({ ...diagnostics, errors })}`);
  }
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const activeNavigation = await page.getByRole('button', { name: '工作台', exact: true }).evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return { background: style.backgroundColor, boxShadow: style.boxShadow, borderLeft: style.borderLeftWidth };
  });
  if (activeNavigation.background !== 'rgb(233, 233, 233)' || activeNavigation.boxShadow !== 'none') {
    throw new Error(`当前导航不是规范灰阶选中态: ${JSON.stringify(activeNavigation)}`);
  }
  const searchBounds = await page.getByRole('textbox', { name: '全局搜索' }).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, width: box.width };
  });
  if (searchBounds.top < 0 || searchBounds.bottom > 48 || searchBounds.width < 320) {
    throw new Error(`全局搜索被顶栏裁切: ${JSON.stringify(searchBounds)}`);
  }
  if (await page.getByRole('button', { name: '新建', exact: true }).count()) throw new Error('页面壳存在无行为的通用新建按钮');
  const visibility = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type 'using System; using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'; [W]::IsWindowVisible((Get-Process -Id ${child.pid}).MainWindowHandle)`
  ], { encoding: 'utf8' }).trim();
  if (visibility !== 'False') throw new Error(`自动验收窗口仍可见: ${visibility}`);
  if (globalThis.process.env.UI_RECEIPT_ID === 'UIR-002') {
    await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'workbench.png'));
  }
  for (const route of ['浏览与收集', '资料库', '内容', '素材库', '发布包', '经营', '账号', '任务', '设置']) {
    await page.getByRole('button', { name: route }).click();
    await page.getByRole('heading', { name: route, exact: true }).waitFor();
    if (globalThis.process.env.UI_RECEIPT_ID === 'UIR-002' && ['资料库', '内容'].includes(route)) {
      await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, `${route}.png`));
    }
    if (globalThis.process.env.UI_RECEIPT_ID === 'UIR-003' && ['浏览与收集', '素材库', '发布包', '账号', '任务', '设置'].includes(route)) {
      await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, `${route}.png`));
    }
    if (['BIZ-002', 'BIZ-003'].includes(globalThis.process.env.UI_RECEIPT_ID ?? '') && route === '经营') {
      await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, '经营.png'));
    }
  }
  if (globalThis.process.env.UI_RECEIPT_ID === 'UIR-004') {
    await page.keyboard.press('Control+K');
    const focusedSearch = await page.getByRole('textbox', { name: '全局搜索' }).evaluate((element) => element === globalThis.document.activeElement);
    if (!focusedSearch) throw new Error('Ctrl+K 未将焦点送到全局搜索');
    await page.getByRole('button', { name: '工作台' }).click();
    for (const [width, height] of [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth);
      if (overflow) throw new Error(`${width}x${height} 出现横向溢出`);
      await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, `workbench-${width}.png`));
    }
    await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%'; });
    const criticalActions = await page.getByRole('button', { name: /刷新状态|创建账号、资料、内容与素材/ }).count();
    if (!criticalActions) throw new Error('200% 文本下关键工作台操作不可达');
    await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = ''; });
  }
  await page.locator('nav').evaluate((element) => { element.style.transition = 'none'; });
  await page.getByRole('button', { name: '折叠导航' }).click();
  const collapsed = await page.locator('nav').evaluate((element) => ({
    className: element.className,
    width: Math.round(element.getBoundingClientRect().width),
    overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth
  }));
  if (collapsed.width !== 56 || collapsed.overflow) throw new Error(`收起导航布局失败: ${JSON.stringify(collapsed)}`);
  await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'ui-shell.png'));
} finally {
  await browser?.close();
  child.kill();
}
