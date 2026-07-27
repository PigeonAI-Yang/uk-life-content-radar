import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-008');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ffb900' } }).png().toBuffer();
const server = createServer((request, response) => {
  if (request.url === '/page') {
    response.setHeader('Set-Cookie', 'task008=logged-in; Path=/');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>英国生活测试页</title><h1>英国生活资讯</h1><p id="selection">押金必须进入保护计划</p><img src="/protected.png"><a href="/download.bin">下载材料</a>`);
  } else if (request.url === '/protected.png') {
    if (!String(request.headers.cookie).includes('task008=logged-in')) { response.writeHead(401).end('login'); return; }
    response.setHeader('Content-Type', 'image/png'); response.end(image);
  } else if (request.url === '/auth-required') {
    response.writeHead(401).end('login');
  } else if (request.url === '/download.bin') {
    response.setHeader('Content-Type', 'application/octet-stream'); response.end('真实下载文件');
  } else {
    response.writeHead(404).end('missing');
  }
});
await new Promise((resolveListen) => server.listen(9328, '127.0.0.1', resolveListen));

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9242'], { stdio: 'ignore' });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9242'); break; } catch { await delay(250); }
}
if (!browser) throw new Error('TASK-008 桌面程序未启动');
const pages = () => browser.contexts().flatMap((context) => context.pages());
const page = pages().find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-008 主窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
await page.getByRole('button', { name: '浏览与收集', exact: true }).click();
await page.getByRole('textbox', { name: '浏览器地址' }).fill('http://127.0.0.1:9328/page');
await page.getByRole('textbox', { name: '浏览器地址' }).press('Enter');
await page.getByRole('button', { name: '英国生活测试页', exact: true }).waitFor();

await page.getByRole('combobox', { name: '收集落点' }).selectOption('library');
await page.getByRole('button', { name: '收藏网页' }).click();
const receiptNode = page.locator('[data-testid="collection-receipt"]');
const readReceipt = async () => JSON.parse(await receiptNode.getAttribute('data-result'));
let receipt = await readReceipt();
if (!receipt.ok || receipt.result.kind !== 'webpage' || receipt.result.destination !== 'library') throw new Error('网页收集失败');
const webpage = receipt.result;
const sourceCount = readdirSync(resolve(rootPath, 'sources')).length;
await page.getByRole('button', { name: '收藏网页' }).click();
await page.waitForFunction(() => {
  try { return JSON.parse(globalThis.document.querySelector('[data-testid="collection-receipt"]')?.getAttribute('data-result') ?? '{}').result?.status === 'duplicate'; } catch { return false; }
});
receipt = await readReceipt();
if (!receipt.ok || receipt.result.status !== 'duplicate' || receipt.result.code !== 'DUPLICATE_URL') throw new Error('重复网址未明确提示');
if (readdirSync(resolve(rootPath, 'sources')).length !== sourceCount) throw new Error('重复网址留下完成快照');

const webPage = pages().find((candidate) => candidate.url() === 'http://127.0.0.1:9328/page');
if (!webPage) throw new Error('WebContentsView 页面未作为真实网页目标出现');
await webPage.evaluate(() => {
  const node = globalThis.document.querySelector('#selection');
  const range = globalThis.document.createRange();
  range.selectNodeContents(node);
  const selection = globalThis.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
});
await page.getByRole('combobox', { name: '收集落点' }).selectOption('content');
await page.getByRole('button', { name: '摘录选中内容' }).click();
await page.waitForFunction(() => {
  try { return JSON.parse(globalThis.document.querySelector('[data-testid="collection-receipt"]')?.getAttribute('data-result') ?? '{}').result?.kind === 'selection'; } catch { return false; }
});
receipt = await readReceipt();
if (!receipt.ok || receipt.result.object.body !== '押金必须进入保护计划' || receipt.result.destination !== 'content') throw new Error('选中文本收集失败');
const selection = receipt.result;

await page.getByRole('combobox', { name: '收集落点' }).selectOption('assets');
await page.getByRole('textbox', { name: '图片或下载地址' }).fill('http://127.0.0.1:9328/protected.png');
await page.getByRole('button', { name: '保存图片' }).click();
await page.waitForFunction(() => {
  try { return JSON.parse(globalThis.document.querySelector('[data-testid="collection-receipt"]')?.getAttribute('data-result') ?? '{}').result?.kind === 'image'; } catch { return false; }
});
receipt = await readReceipt();
if (!receipt.ok || receipt.result.kind !== 'image' || receipt.result.object.fileStatus !== 'present') throw new Error(`登录态图片收集失败: ${JSON.stringify(receipt)}`);
const savedImage = receipt.result;

await page.getByRole('combobox', { name: '收集落点' }).selectOption('content');
await page.getByRole('textbox', { name: '图片或下载地址' }).fill('http://127.0.0.1:9328/download.bin');
await page.getByRole('button', { name: '接管下载文件' }).click();
await page.waitForFunction(() => {
  try { return JSON.parse(globalThis.document.querySelector('[data-testid="collection-receipt"]')?.getAttribute('data-result') ?? '{}').result?.kind === 'download'; } catch { return false; }
});
receipt = await readReceipt();
if (!receipt.ok || receipt.result.kind !== 'download' || receipt.result.destination !== 'content') throw new Error('下载文件收集失败');
const download = receipt.result;

const tabs = await page.evaluate(() => globalThis.terminal.business.dispatch('browser.tabs.list', {}));
const tabId = tabs.result.activeId;
const client = new Client({ name: 'task-008-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const mcpCall = async (name, argumentsValue) => {
  const result = await client.callTool({ name, arguments: argumentsValue });
  return { response: result, envelope: JSON.parse(result.content[0].text) };
};
const mcpImage = await mcpCall('collect.image', {
  caller: 'task-008-mcp', idempotencyKey: 'protected', tabId, resourceUrl: 'http://127.0.0.1:9328/protected.png', destination: 'assets'
});
if (!mcpImage.envelope.ok) throw new Error('MCP 未复用标签登录态');
const missingTab = await mcpCall('collect.webpage', { caller: 'task-008-mcp', idempotencyKey: 'missing-tab', tabId: 'missing', destination: 'library' });
if (missingTab.envelope.ok || missingTab.envelope.error.code !== 'TAB_NOT_FOUND') throw new Error('标签不存在错误不明确');
const failedDownload = await mcpCall('collect.download', {
  caller: 'task-008-mcp', idempotencyKey: 'failed-download', tabId, resourceUrl: 'http://127.0.0.1:9328/missing', destination: 'assets'
});
if (failedDownload.envelope.ok || failedDownload.envelope.error.code !== 'DOWNLOAD_FAILED') throw new Error('下载失败错误不明确');
const authFailure = await mcpCall('collect.image', {
  caller: 'task-008-mcp', idempotencyKey: 'auth', tabId, resourceUrl: 'http://127.0.0.1:9328/auth-required', destination: 'assets'
});
if (authFailure.envelope.ok || authFailure.envelope.error.code !== 'AUTH_REQUIRED') throw new Error('登录失效错误不明确');

const offlineTab = await page.evaluate(() => globalThis.terminal.browser.create('http://127.0.0.1:1/offline'));
await delay(500);
const unreadable = await mcpCall('collect.webpage', {
  caller: 'task-008-mcp', idempotencyKey: 'offline', tabId: offlineTab.id, destination: 'library'
});
if (unreadable.envelope.ok || !['OFFLINE', 'PAGE_UNREADABLE'].includes(unreadable.envelope.error.code)) throw new Error(`页面不可读错误不明确: ${JSON.stringify(unreadable.envelope)}`);
if (readdirSync(resolve(rootPath, 'sources')).length !== sourceCount + 1) throw new Error('失败收集留下完成快照');

await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, 'browser-collection.png'));
await client.close();
await browser.close();
desktop.kill();
await new Promise((resolveClose) => server.close(resolveClose));
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed', tabId, webpage, selection, savedImage, download,
  mcpLoginStateImage: mcpImage.envelope.result,
  failures: {
    duplicate: { code: 'DUPLICATE_URL' },
    missingTab: missingTab.envelope.error,
    failedDownload: failedDownload.envelope.error,
    authFailure: authFailure.envelope.error,
    unreadable: unreadable.envelope.error
  },
  rootPath
}, null, 2));
