import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-008');
const runDirectory = resolve(receiptDirectory, 'acceptance-workspace');
const rootPath = resolve(runDirectory, 'business-root');
const profilePath = resolve(runDirectory, 'profile');
const inputDirectory = resolve(receiptDirectory, 'user-input');
const privateMaterialName = existsSync(inputDirectory)
  ? readdirSync(inputDirectory).find((name) => /^private-conversation\./i.test(name))
  : undefined;
const privateMaterialPath = privateMaterialName ? resolve(inputDirectory, privateMaterialName) : undefined;
const newSessionMarker = resolve(receiptDirectory, 'user-input', 'new-session-confirmed.txt');
const executablePath = resolve('out', '自媒体桌面终端-win32-x64', 'content-media-terminal.exe');
const helperPath = resolve('out', '自媒体桌面终端-win32-x64', 'resources', 'mcp-helper.cjs');
mkdirSync(runDirectory, { recursive: true });

async function start(port) {
  const desktop = spawn(executablePath, ['--background-test', `--user-data-dir=${profilePath}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await delay(200); }
  }
  if (!browser) throw new Error('验收应用未启动');
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('验收业务窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  return { desktop, browser, page };
}

async function stop(runtime) {
  await runtime.browser.close();
  runtime.desktop.kill();
  await delay(500);
}

const firstRun = !existsSync(resolve(profilePath, 'root.json'));
let runtime = await start(9268);
if (firstRun) await runtime.page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => runtime.page.evaluate(([command, parameters]) =>
  globalThis.terminal.business.dispatch(command, parameters), [name, input]);
const requireOk = (value, label) => {
  if (!value.ok) throw new Error(`${label}: ${JSON.stringify(value)}`);
  return value.result;
};

let account;
let product;
let content;
let candidates;
let lead;
if (firstRun) {
  account = requireOk(await dispatch('account.create', {
    caller: 'biz-008', idempotencyKey: 'account', name: '英国生活验收账号',
    positioning: '为在英华人提供及时、实用、可信的信息与服务',
    audience: '在英华人', tone: '自然、实用',
    platformIdentities: { xiaohongshu: '英国生活验收', douyin: '英国生活验收', wechat: '英国生活验收' },
    defaultTemplates: { xiaohongshu: 'xiaohongshu-v1', douyin: 'douyin-v1', wechat: 'wechat-v1' }
  }), '创建账号');
  product = requireOk(await dispatch('product.create', {
    caller: 'biz-008', idempotencyKey: 'product', accountId: account.id,
    name: '英国租房材料整理', targetCustomer: '需要准备英国租房材料的华人',
    problem: '材料散乱、要求不清楚', priceRange: '£129-£329',
    serviceScope: '整理、核对和形成提交清单', suitableFor: '使用真实材料的租客', unsuitableFor: '要求伪造材料'
  }), '创建产品');
  requireOk(await dispatch('strategy.propose', {
    caller: 'biz-008', idempotencyKey: 'strategy', accountId: account.id, productId: product.id,
    proposalType: 'conversion', proposed: { direction: '用官方新规解读吸引租房材料咨询' },
    rationale: '新规具有时效和广泛影响', evidence: ['GOV.UK 官方租客指南'],
    successMeasure: '发布后记录有效私信、加微信与成交'
  }), '创建策略提案');
  const scan = requireOk(await dispatch('intelligence.record_scan', {
    caller: 'biz-008', idempotencyKey: 'scan',
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    sources: [
      { name: 'GOV.UK', status: 'succeeded', itemCount: 1 },
      { name: '社区线索', status: 'failed', itemCount: 0, error: '验收用可证伪部分失败', lastSuccessAt: '2026-07-27T00:00:00.000Z' }
    ],
    candidates: [{
      title: '英格兰租客权利新规已生效', sourceUrl: 'https://www.gov.uk/guidance/renters-rights-act-overview-for-tenants',
      audience: '在英格兰私人租房的华人', impact: '固定期限、驱逐、租金和养宠等规则发生变化',
      timeliness: '2026年5月1日起生效，应尽快核对', verificationStatus: 'GOV.UK 已核验',
      angles: ['租客必须知道的变化', '准备租房材料时要注意什么'],
      discoveredAt: new Date().toISOString()
    }]
  }), '记录扫描');
  if (scan.status !== 'partial') throw new Error('部分来源失败被错误写成全部成功');
  const intelligence = requireOk(await dispatch('intelligence.list', { status: 'candidate', limit: 10 }), '读取候选').items[0];
  const promoted = requireOk(await dispatch('intelligence.promote_resource', {
    caller: 'biz-008', idempotencyKey: 'promote-resource', candidateId: intelligence.id
  }), '候选进入资料');
  content = requireOk(await dispatch('content.create', {
    caller: 'biz-008', idempotencyKey: 'content', accountId: account.id,
    title: '英格兰租房新规：在英租客现在要知道什么'
  }), '创建内容');
  const saved = requireOk(await dispatch('content.save_version', {
    contentId: content.id, expectedVersion: 1,
    body: '英格兰私人租房规则已在 2026 年 5 月 1 日发生变化。\\n\\n固定期限和 Section 21 等规则已经调整，租客还应留意租金、养宠和材料要求。准备签约或换房前，先查看 GOV.UK 最新指南，再按自己的租约核对。\\n\\n如果你正在准备租房材料、担心材料不完整，可以私信说一下你的情况。',
    outline: '变化是什么\\n对谁有影响\\n现在该做什么',
    verificationItems: ['GOV.UK Renters’ Rights Act overview for tenants']
  }), '保存正文');
  requireOk(await dispatch('content.link_resource', {
    contentId: content.id, resourceId: promoted.resource.id
  }), '关联官方资料');
  const versionId = saved.versions.find((version) => version.version === 2).id;
  const imageSource = resolve('artifacts', 'task-receipts', 'TASK-012', 'sharp-dev', 'original.png');
  const assets = [];
  for (const platform of ['xiaohongshu', 'douyin', 'wechat']) {
    const imagePath = resolve(runDirectory, `${platform}.png`);
    copyFileSync(imageSource, imagePath);
    assets.push(requireOk(await dispatch('asset.import', {
      caller: 'biz-008', idempotencyKey: `asset-${platform}`, filePath: imagePath
    }), `导入${platform}图片`));
  }
  candidates = [];
  for (const [index, platform] of ['xiaohongshu', 'douyin', 'wechat'].entries()) {
    const candidate = requireOk(await dispatch('package.create_preview', {
      caller: 'biz-008', idempotencyKey: `preview-${platform}`, accountId: account.id,
      platform, contentVersionId: versionId, assetVersionIds: [assets[index].versionId],
      templateVersion: `${platform}-v1`
    }), `创建${platform}预览`);
    requireOk(await dispatch('package.request_approval', { candidateId: candidate.id }), `请求${platform}批准`);
    candidates.push(candidate);
  }
  if (privateMaterialPath) {
    lead = requireOk(await dispatch('lead.create', {
      caller: 'biz-008', idempotencyKey: 'real-lead', accountId: account.id,
      productId: product.id, sourceContentId: content.id, platform: 'wechat',
      nickname: '用户提供的真实咨询', coreNeed: '待用户确认', intent: '待确认', nextAction: '核对原始对话'
    }), '记录真实客户');
    requireOk(await dispatch('conversation.import', {
      caller: 'biz-008', idempotencyKey: 'real-conversation', leadId: lead.id,
      channel: 'wechat', occurredAt: new Date().toISOString(), filePath: privateMaterialPath,
      summary: '真实对话待用户确认', needs: [], objections: [], suggestedReply: '', conclusion: ''
    }), '导入真实私信原件');
  }
  await runtime.page.getByRole('button', { name: '经营', exact: true }).click();
  await runtime.page.getByRole('heading', { name: '经营', exact: true }).waitFor();
  await runtime.page.evaluate((filePath) => globalThis.terminal.system.capturePage(filePath), resolve(receiptDirectory, '经营验收.png'));
} else {
  const accounts = requireOk(await dispatch('account.search', { query: '英国生活验收账号', limit: 10 }), '恢复账号');
  account = accounts.items[0];
}

let beforeRestart = requireOk(await dispatch('business.snapshot', { accountId: account.id }), '重启前快照');
if (privateMaterialPath && !beforeRestart.leads.length) {
  product = beforeRestart.products[0];
  content = beforeRestart.contentSupply[0];
  lead = requireOk(await dispatch('lead.create', {
    caller: 'biz-008', idempotencyKey: 'real-lead', accountId: account.id,
    productId: product.id, sourceContentId: content.id, platform: 'wechat',
    nickname: '用户提供的真实咨询', coreNeed: '待用户确认', intent: '待确认', nextAction: '核对原始对话'
  }), '记录真实客户');
  requireOk(await dispatch('conversation.import', {
    caller: 'biz-008', idempotencyKey: 'real-conversation', leadId: lead.id,
    channel: 'wechat', occurredAt: new Date().toISOString(), filePath: privateMaterialPath,
    summary: '真实对话待用户确认', needs: [], objections: [], suggestedReply: '', conclusion: ''
  }), '导入真实私信原件');
  beforeRestart = requireOk(await dispatch('business.snapshot', { accountId: account.id }), '导入后快照');
}
const packageCandidates = requireOk(await dispatch('package.list_candidates', { query: '', limit: 10 }), '读取发布候选').items;
const approvals = [];
for (const candidate of packageCandidates) {
  approvals.push(requireOk(await dispatch('package.get_approval', { candidateId: candidate.id }), '读取发布批准'));
}
let packages;
if (packageCandidates.length === 3 && approvals.every((approval) => approval.status === 'approved')) {
  packages = requireOk(await dispatch('package.build', {
    caller: 'biz-008', idempotencyKey: 'final-three-platform-build',
    candidateIds: packageCandidates.map((candidate) => candidate.id)
  }), '构建三平台发布包');
}
const metrics = beforeRestart.contentSupply[0]
  ? requireOk(await dispatch('post_metrics.list', { contentId: beforeRestart.contentSupply[0].id }), '读取帖子表现').items
  : [];
await stop(runtime);
runtime = await start(9269);
const client = new Client({ name: 'biz-008-new-session', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: executablePath, args: [helperPath],
  env: { ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: resolve(profilePath, 'codex-handoff.json') }
}));
const tools = (await client.listTools()).tools.map((tool) => tool.name);
const response = await client.callTool({ name: 'business.snapshot', arguments: { accountId: account.id } });
const afterRestart = JSON.parse(response.content[0].text);
await client.close();
await stop(runtime);

const blockers = [];
if (!privateMaterialPath) blockers.push(`缺少真实私信或微信原件：${resolve(inputDirectory, 'private-conversation.<原扩展名>')}`);
if (!beforeRestart.approvedStrategies.length) blockers.push('经营策略提案仍需用户在桌面界面人工批准');
if (!packages || packages.status !== 'completed') blockers.push('三个发布包仍需用户在桌面界面逐一人工批准并构建');
if (beforeRestart.pending.unconfirmedConversations.length) blockers.push('真实沟通提取结果仍需用户确认');
if (!metrics.length) blockers.push('真实平台表现尚需用户在经营页登记');
if (!beforeRestart.deals.length) blockers.push('加微信和成交/未成交结果尚需用户在经营页确认');
if (!existsSync(newSessionMarker)) blockers.push(`需在新的 Codex 对话中实际调用已安装 Skill 并说“开始工作”，确认后记录：${newSessionMarker}`);
const result = {
  task: 'BIZ-008', status: blockers.length ? 'partial' : 'completed',
  officialSource: 'https://www.gov.uk/guidance/renters-rights-act-overview-for-tenants',
  rootPath, profilePath, firstRun, accountId: account.id,
  beforeRestart, afterRestart: afterRestart.result,
  publishing: { packageCandidates, approvals, packages },
  metrics,
  mcp: { toolCount: tools.length, snapshotAvailable: tools.includes('business.snapshot'),
    strategyApprovalExposed: tools.includes('strategy.approve'), finalApprovalExposed: tools.includes('approval.approve') },
  blockers
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(resolve(receiptDirectory, 'human-acceptance.txt'),
  `业务根目录：${rootPath}\r\n应用数据目录：${profilePath}\r\n\r\n${blockers.map((item, index) => `${index + 1}. ${item}`).join('\r\n')}\r\n`);
process.stdout.write(`${JSON.stringify({ status: result.status, rootPath, blockers }, null, 2)}\n`);
if (blockers.length) process.exitCode = 2;
