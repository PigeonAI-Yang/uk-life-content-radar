import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-005');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, '--remote-debugging-port=9255'], { stdio: 'ignore' });
let browser;
let client;
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9255'); break; } catch { await delay(250); }
  }
  if (!browser) throw new Error('桌面程序未启动');
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const account = await dispatch('account.create', {
    caller: 'biz-005-ui', idempotencyKey: 'account', name: '英国生活号',
    positioning: '服务在英华人', audience: '在英华人', tone: '实用'
  });

  client = new Client({ name: 'biz-005-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: executablePath, args: [helperPath],
    env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
  }));
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  if (!names.includes('business.snapshot') || names.includes('strategy.approve') || names.includes('approval.approve')) {
    throw new Error(`MCP 工具边界错误: ${JSON.stringify(names)}`);
  }
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse(response.content[0].text);
  };
  const product = await call('product.create', {
    caller: 'biz-005-mcp', idempotencyKey: 'product', accountId: account.result.id,
    name: '租房材料整理', targetCustomer: '在英租客', problem: '材料散乱',
    priceRange: '£129', serviceScope: '整理检查', suitableFor: '真实材料', unsuitableFor: '伪造'
  });
  const idempotencyConflict = await call('product.create', {
    caller: 'biz-005-mcp', idempotencyKey: 'product', accountId: account.result.id,
    name: '不同产品', targetCustomer: '在英租客', problem: '材料散乱',
    priceRange: '£129', serviceScope: '整理检查', suitableFor: '真实材料', unsuitableFor: '伪造'
  });
  const versionConflict = await call('product.update', {
    id: product.result.id, expectedVersion: 2, name: '错误覆盖'
  });
  const lead = await call('lead.create', {
    caller: 'biz-005-mcp', idempotencyKey: 'lead', accountId: account.result.id,
    productId: product.result.id, platform: 'xiaohongshu', nickname: '小英',
    coreNeed: '准备租房材料', intent: '高', nextAction: '加微信'
  });
  const conversation = await call('conversation.import', {
    caller: 'biz-005-mcp', idempotencyKey: 'conversation', leadId: lead.result.id,
    channel: 'xiaohongshu', occurredAt: new Date().toISOString(), text: '请问可以帮我整理材料吗',
    summary: '客户咨询材料整理', needs: [], objections: [], suggestedReply: '', conclusion: ''
  });
  appendFileSync(conversation.result.originalFile.filePath, '\n外部修改');
  const snapshot = await call('business.snapshot', { accountId: account.result.id });
  if (!snapshot.ok || snapshot.result.products.length !== 1 ||
      !snapshot.result.dataGaps.includes('存在待确认沟通记录') ||
      !snapshot.result.dataGaps.includes('存在缺失或被修改的沟通原件')) {
    throw new Error(`经营快照不完整: ${JSON.stringify(snapshot)}`);
  }
  if (idempotencyConflict.ok || idempotencyConflict.error.code !== 'IDEMPOTENCY_CONFLICT') {
    throw new Error('幂等冲突没有明确失败');
  }
  if (versionConflict.ok || versionConflict.error.code !== 'VERSION_CONFLICT') {
    throw new Error('版本冲突没有明确失败');
  }
  await browser.close();
  browser = undefined;
  desktop.kill();
  await delay(500);
  const desktopUnavailable = await call('business.snapshot', { accountId: account.result.id });
  if (!desktopUnavailable.isError && desktopUnavailable.code !== 'DESKTOP_UNAVAILABLE') {
    throw new Error(`桌面不可用没有明确失败: ${JSON.stringify(desktopUnavailable)}`);
  }
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
    task: 'BIZ-005', status: 'completed', toolCount: names.length,
    exposed: ['business.snapshot', 'business.pending'], hidden: ['strategy.approve', 'approval.approve'],
    snapshot: snapshot.result, failures: { idempotencyConflict, versionConflict, desktopUnavailable },
    rootPath
  }, null, 2));
} finally {
  await client?.close();
  await browser?.close();
  desktop.kill();
}
