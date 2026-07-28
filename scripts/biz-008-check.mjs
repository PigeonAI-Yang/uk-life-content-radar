import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-008');
const runDirectory = resolve(receiptDirectory, `intelligence-run-${Date.now()}`);
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
const port = 9300 + Math.floor(Math.random() * 200);
mkdirSync(profilePath, { recursive: true });

const desktop = spawn(executablePath, [
  '--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`
], { stdio: 'ignore' });
let browser;
let client;
try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await delay(250); }
  }
  if (!browser) throw new Error('打包应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
  const dispatch = (name, input) => page.evaluate(([command, parameters]) =>
    globalThis.terminal.business.dispatch(command, parameters), [name, input]);
  const ok = async (name, input) => {
    const response = await dispatch(name, input);
    if (!response.ok) throw new Error(`${name}: ${JSON.stringify(response.error)}`);
    return response.result;
  };

  const account = await ok('account.create', {
    caller: 'biz-008', idempotencyKey: 'account', name: '英国生活情报号',
    positioning: '及时提供可信实用的英国生活信息', audience: '在英华人', tone: '自然实用'
  });
  const now = new Date().toISOString();
  const lastSuccess = new Date(Date.now() - 86_400_000).toISOString();
  const scan = await ok('intelligence.record_scan', {
    caller: 'biz-008', idempotencyKey: 'real-scan', startedAt: now, endedAt: now,
    sources: [
      { name: 'GOV.UK', status: 'succeeded', itemCount: 1 },
      { name: '可证伪失败来源', status: 'failed', itemCount: 0, error: '验收主动设置的来源失败', lastSuccessAt: lastSuccess }
    ],
    candidates: [{
      title: '英格兰私人租房规则已于 2026 年 5 月 1 日改变',
      sourceUrl: 'https://www.gov.uk/guidance/renters-rights-act-overview-for-tenants',
      audience: '在英格兰私人租房或准备租房的华人',
      impact: '租约、驱逐、租金和养宠等规则发生变化，签约与续租前需要核对最新权利和义务',
      timeliness: '现行规则，近期租房与续租人群应立即核对',
      verificationStatus: 'GOV.UK 官方页面已核验',
      angles: ['租客现在必须知道的变化', '签约前需要重新核对什么'],
      discoveredAt: now
    }]
  });
  if (scan.status !== 'partial') throw new Error('部分来源失败未保持 partial');
  const scanStatus = await ok('intelligence.scan_status', {});
  if (scanStatus.latest?.sources?.filter((source) => source.status === 'failed').length !== 1) {
    throw new Error('最近扫描未读回失败来源');
  }
  const candidate = (await ok('intelligence.list', { limit: 10 })).items[0];
  const promotedResource = await ok('intelligence.promote_resource', {
    caller: 'biz-008', idempotencyKey: 'resource', candidateId: candidate.id
  });
  const promotedContent = await ok('intelligence.promote_content', {
    caller: 'biz-008', idempotencyKey: 'content', candidateId: candidate.id, accountId: account.id
  });
  const resource = await ok('resource.get', { id: promotedResource.resource.id });
  const content = await ok('content.get', { id: promotedContent.content.id });
  const finalCandidate = await ok('intelligence.get', { id: candidate.id });
  if (finalCandidate.status !== 'resource_and_content') throw new Error('情报未同时关联资料与内容');

  await page.getByRole('button', { name: '情报', exact: true }).click();
  await page.getByRole('heading', { name: '情报', exact: true, level: 1 }).waitFor();
  const screenshot = resolve(receiptDirectory, '情报完整链.png');
  await page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), screenshot);

  client = new Client({ name: 'biz-008-new-session', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: executablePath, args: [helperPath],
    env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
  }));
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const mcpScan = JSON.parse((await client.callTool({
    name: 'intelligence.scan_status', arguments: {}
  })).content[0].text);
  const mcpCandidate = JSON.parse((await client.callTool({
    name: 'intelligence.get', arguments: { id: candidate.id }
  })).content[0].text);
  if (mcpCandidate.result.status !== 'resource_and_content') throw new Error('MCP 情报关系与界面业务内核不一致');

  const imported = await page.evaluate(() => globalThis.terminal.agent.importCockpit());
  const connection = await page.evaluate(() => globalThis.terminal.agent.testCustomApi());
  if (!imported.apiKeyConfigured || !connection.connected) throw new Error('Pi 自定义 API 未连接');
  const agentTask = await ok('task.start', {
    caller: 'biz-008', idempotencyKey: 'agent-read-intelligence', type: 'agent.execute',
    parameters: {
      accountId: account.id, triggerEvent: 'intelligence_ready', objectId: candidate.id,
      goal: '通过 MCP 读取最新情报扫描和候选，确认该情报已经沉淀为资料与内容，然后给出一条下一步创作建议。不要创建发布包、客户或成交记录。'
    }
  });
  let finishedTask;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    finishedTask = await ok('task.get', { taskId: agentTask.id });
    if (['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(finishedTask.status)) break;
    await delay(500);
  }
  if (finishedTask?.status !== 'succeeded') throw new Error(`Pi 情报接力失败: ${JSON.stringify(finishedTask)}`);
  const resultFile = finishedTask.result.files.find((file) => file.filePath.endsWith('result.json'));
  const agentResult = JSON.parse(readFileSync(resultFile.filePath, 'utf8'));
  if (agentResult.toolCalls < 1) throw new Error('Pi 未真实调用 MCP');

  const result = {
    task: 'BIZ-008', status: 'completed', officialSource: candidate.sourceUrl,
    rootPath, profilePath, scan: scanStatus.latest, candidate: finalCandidate,
    resource, content, screenshot,
    mcp: { toolCount: tools.length, scan: mcpScan.result, candidate: mcpCandidate.result },
    pi: { provider: imported.source, model: imported.config.model, task: finishedTask, toolCalls: agentResult.toolCalls },
    checks: {
      realSource: true, partialFailure: true, lastSuccessReadback: true,
      resourceAndContent: true, uiMcpSqliteFiles: existsSync(resource.filePath) && existsSync(screenshot),
      newMcpSession: true, piMcpHandoff: true
    },
    optionalDownstream: { publishingRequired: false, customerRequired: false, dealRequired: false }
  };
  writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({ status: result.status, checks: result.checks }, null, 2)}\n`);
} finally {
  await client?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  desktop.kill();
}
