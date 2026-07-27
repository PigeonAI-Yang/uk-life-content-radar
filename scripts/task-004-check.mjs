import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-004');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const profilePath = resolve(runDirectory, 'profile');
const rootPath = resolve(runDirectory, 'business-root');
const discoveryPath = resolve(profilePath, 'codex-handoff.json');
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, [
  '--background-test',
  `--user-data-dir=${profilePath}`,
  '--remote-debugging-port=9237'
], { stdio: 'ignore' });

let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
    break;
  } catch {
    await delay(250);
  }
}
if (!browser) throw new Error('TASK-004 桌面程序未启动');
const page = browser.contexts().flatMap((context) => context.pages())
  .find((candidate) => candidate.url().includes('/main_window/index.html'));
if (!page) throw new Error('TASK-004 业务窗口不存在');
await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
await page.evaluate((path) => globalThis.terminal.settings.initializeRoot(path), rootPath);

const transport = new StdioClientTransport({
  command: executablePath,
  args: [helperPath],
  env: {
    ELECTRON_RUN_AS_NODE: '1',
    CONTENT_TERMINAL_MCP_DISCOVERY_FILE: discoveryPath
  },
  stderr: 'pipe'
});
const client = new Client({ name: 'task-004-check', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
if (tools.tools.some((tool) => tool.name === 'approval.approve')) throw new Error('MCP 不得暴露最终批准工具');
if (!tools.tools.some((tool) => tool.name === 'account.create')) throw new Error('MCP 未发现账号命令');

const createdCall = await client.callTool({
  name: 'account.create',
  arguments: {
    caller: 'task-004-mcp',
    idempotencyKey: 'account-create',
    name: 'MCP 真实账号',
    positioning: '英国生活',
    audience: '在英华人',
    tone: '清楚'
  }
});
const createdEnvelope = JSON.parse(createdCall.content[0].text);
if (!createdEnvelope.ok) throw new Error(`MCP 创建失败: ${createdCall.content[0].text}`);
const created = createdEnvelope.result;

const readCall = await client.callTool({ name: 'account.get', arguments: { id: created.id } });
const readEnvelope = JSON.parse(readCall.content[0].text);
if (!readEnvelope.ok || readEnvelope.result.id !== created.id) throw new Error('MCP 写后读回不一致');

await page.keyboard.press('Alt+F4');
await delay(500);
const hiddenRead = await client.callTool({ name: 'account.get', arguments: { id: created.id } });
const hiddenEnvelope = JSON.parse(hiddenRead.content[0].text);
if (!hiddenEnvelope.ok) throw new Error('窗口关闭后后台 MCP 不可调用');

desktop.kill();
await Promise.race([
  new Promise((resolveExit) => desktop.once('exit', resolveExit)),
  delay(5000)
]);
const unavailableCall = await client.callTool({ name: 'account.get', arguments: { id: created.id } });
const unavailableEnvelope = JSON.parse(unavailableCall.content[0].text);
if (!unavailableCall.isError || unavailableEnvelope.code !== 'DESKTOP_UNAVAILABLE') {
  throw new Error('桌面退出后 MCP 未返回明确失败');
}

await client.close();
await browser.close();
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  executablePath,
  helperPath,
  discovery: JSON.parse(readFileSync(discoveryPath, 'utf8')),
  toolCount: tools.tools.length,
  approvalToolExposed: false,
  created,
  writeReadback: readEnvelope.result,
  hiddenWindowReadback: hiddenEnvelope.result,
  unavailableFailure: unavailableEnvelope,
  rootPath
}, null, 2));
