import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'TASK-018');
const runDirectory = resolve(receiptDirectory, `run-${Date.now()}`);
const localAppData = resolve(runDirectory, 'clean-user', 'LocalAppData');
const appData = resolve(runDirectory, 'clean-user', 'AppData');
const profilePath = resolve(runDirectory, 'clean-user', 'profile');
const rootPath = resolve(runDirectory, 'business-root');
mkdirSync(localAppData, { recursive: true });
mkdirSync(appData, { recursive: true });
mkdirSync(profilePath, { recursive: true });
const installerPath = resolve('out', 'make', 'squirrel.windows', 'x64', '自媒体桌面终端-0.1.0 Setup.exe');
if (!existsSync(installerPath)) throw new Error('Squirrel 安装器不存在');
const installerBytes = readFileSync(installerPath);
const installerSha256 = createHash('sha256').update(installerBytes).digest('hex');
const cleanEnv = { ...process.env, LOCALAPPDATA: localAppData, APPDATA: appData };
const actualInstallRoot = resolve(process.env.LOCALAPPDATA ?? '', 'content_media_terminal');
if (existsSync(actualInstallRoot)) throw new Error(`安装目录非干净状态: ${actualInstallRoot}`);
const installed = spawnSync(installerPath, ['--silent'], { env: cleanEnv, encoding: 'utf8', timeout: 180_000 });
if (installed.status !== 0) throw new Error(`安装失败: ${installed.stderr || installed.stdout}`);
await delay(2000);
const find = (directory, name) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = find(absolute, name);
      if (nested) return nested;
    } else if (entry.name === name) return absolute;
  }
};
const installedExecutable = find(actualInstallRoot, 'content-media-terminal.exe');
const updateExecutable = find(actualInstallRoot, 'Update.exe');
if (!installedExecutable || !updateExecutable || !installedExecutable.startsWith(actualInstallRoot)) throw new Error('安装二进制不存在或不在 Squirrel 用户目录');
const installedSha256 = createHash('sha256').update(readFileSync(installedExecutable)).digest('hex');
const helperPath = resolve(installedExecutable, '..', 'resources', 'mcp-helper.cjs');
if (!existsSync(helperPath)) throw new Error('安装态 MCP helper 缺失');

async function launch(executable, profile, port) {
  const child = spawn(executable, ['--background-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { env: cleanEnv, stdio: 'ignore' });
  let browser;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await delay(200); }
  }
  if (!browser) throw new Error('安装应用后台启动失败');
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('/main_window/index.html'));
  if (!page) throw new Error('安装应用主窗口不存在');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  return { child, browser, page };
}

const app = await launch(installedExecutable, profilePath, 9253);
const version = await app.page.evaluate(() => globalThis.terminal.version);
if (version !== '0.1.0') throw new Error(`安装版本错误: ${version}`);
const rootSettings = await app.page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), rootPath);
const dispatch = (name, input) => app.page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
const uiAccount = await dispatch('account.create', {
  caller: 'task-018-ui', idempotencyKey: 'account', name: '安装态账号', positioning: '英国生活',
  audience: '在英华人', tone: '可靠', forbiddenExpressions: [], platformIdentities: {}, defaultTemplates: {}
});
if (!uiAccount.ok || !existsSync(uiAccount.result.configFile.filePath)) throw new Error('安装态界面对象或文件未写回');
const discoveryPath = resolve(profilePath, 'codex-handoff.json');
if (!existsSync(discoveryPath)) throw new Error('安装态 MCP 注册发现文件不存在');
const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8'));

const client = new Client({ name: 'task-018-installed', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: installedExecutable, args: [helperPath],
  env: { ...cleanEnv, ELECTRON_RUN_AS_NODE: '1', CONTENT_TERMINAL_MCP_DISCOVERY_FILE: discoveryPath }
}));
await app.page.evaluate(() => globalThis.terminal.lifecycle.closeWindow());
const closedMcp = JSON.parse((await client.callTool({ name: 'account.create', arguments: {
  caller: 'task-018-mcp', idempotencyKey: 'closed-window', name: '关闭窗口后账号', positioning: '后台调用',
  audience: '在英华人', tone: '可靠', forbiddenExpressions: [], platformIdentities: {}, defaultTemplates: {}
} })).content[0].text);
if (!closedMcp.ok) throw new Error('关闭窗口后 MCP 调用失败');
await app.page.evaluate(() => globalThis.terminal.lifecycle.reopenWindow());
const reopened = await dispatch('account.get', { id: closedMcp.result.id });
if (!reopened.ok || reopened.result.name !== '关闭窗口后账号') throw new Error('重开窗口未读回 MCP 对象');
await app.page.screenshot({ path: resolve(receiptDirectory, 'installed-reopen.png'), animations: 'disabled' });

await app.page.evaluate(() => globalThis.terminal.lifecycle.quit()).catch(() => undefined);
await delay(1000);
const afterQuitCall = await client.callTool({ name: 'account.search', arguments: { query: '', limit: 10 } });
const afterQuit = JSON.parse(afterQuitCall.content[0].text);
if (!afterQuitCall.isError || afterQuit.code !== 'DESKTOP_UNAVAILABLE') throw new Error('完全退出后 MCP 未明确拒绝');
await client.close();
await app.browser.close().catch(() => undefined);

const scaleReceipt = JSON.parse(readFileSync(resolve('artifacts', 'task-receipts', 'TASK-016', 'result.json'), 'utf8'));
const scaleRoot = resolve(scaleReceipt.databasePath, '..', '..');
const performanceProfile = resolve(runDirectory, 'clean-user', 'performance-profile');
mkdirSync(performanceProfile, { recursive: true });
const perf = await launch(installedExecutable, performanceProfile, 9254);
await perf.page.evaluate((root) => globalThis.terminal.settings.initializeRoot(root), scaleRoot);
const perfDispatch = (name, input) => perf.page.evaluate(([command, parameters]) => globalThis.terminal.business.dispatch(command, parameters), [name, input]);
const searchInput = (query, mode) => ({
  query, mode, types: ['resource', 'excerpt', 'note', 'content', 'asset', 'package', 'account'],
  tags: [], includeArchived: true, limit: 25
});
const keyword = [];
const semantic = [];
for (let run = 0; run < 3; run += 1) {
  let started = performance.now();
  const keywordResult = await perfDispatch('search.query', searchInput('唯一标签哨兵', 'keyword'));
  keyword.push(performance.now() - started);
  started = performance.now();
  const semanticResult = await perfDispatch('search.query', searchInput('租房保证金退回办法', 'semantic'));
  semantic.push(performance.now() - started);
  if (!keywordResult.ok || keywordResult.result.items[0]?.id !== 'scale-source-098765' ||
      !semanticResult.ok || semanticResult.result.items[0]?.id !== 'scale-source-054321') throw new Error('安装态规模搜索哨兵失败');
}
const median = (values) => [...values].sort((a, b) => a - b)[1];
await perf.page.getByRole('textbox', { name: '全局搜索' }).fill('唯一标签哨兵');
const renderStarted = performance.now();
await perf.page.getByRole('textbox', { name: '全局搜索' }).press('Enter');
await perf.page.getByText('规模资料 98765', { exact: true }).waitFor();
const renderMs = performance.now() - renderStarted;
const memory = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${perf.child.pid}).WorkingSet64`], { encoding: 'utf8' });
const peakWorkingSetBytes = Number(memory.stdout.trim());
if (median(keyword) >= 2000 || median(semantic) >= 5000) throw new Error('安装态搜索性能阈值失败');
await perf.page.evaluate(() => globalThis.terminal.lifecycle.reopenWindow());
await perf.page.screenshot({ path: resolve(receiptDirectory, 'installed-scale-search.png'), animations: 'disabled' });
await perf.page.evaluate(() => globalThis.terminal.lifecycle.quit()).catch(() => undefined);
await delay(1000);
await perf.browser.close().catch(() => undefined);

const rootFilesBefore = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else rootFilesBefore.push({ path: absolute.slice(rootPath.length), bytes: statSync(absolute).size, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex') });
  }
};
walk(rootPath);
const uninstall = spawnSync(updateExecutable, ['--uninstall', '-s'], { env: cleanEnv, encoding: 'utf8', timeout: 180_000 });
if (uninstall.status !== 0) throw new Error(`卸载失败: ${uninstall.stderr || uninstall.stdout}`);
await delay(3000);
if (!existsSync(rootPath) || rootFilesBefore.some((file) => !existsSync(join(rootPath, file.path)))) throw new Error('卸载删除了业务数据');
if (existsSync(installedExecutable)) throw new Error('卸载后应用二进制仍存在');
rmSync(actualInstallRoot, { recursive: true, force: true });
if (existsSync(actualInstallRoot)) throw new Error('卸载后安装目录残留');

writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify({
  status: 'completed',
  installer: { path: installerPath, bytes: installerBytes.length, sha256: installerSha256 },
  installation: { cleanProfile: profilePath, squirrelUserDirectory: actualInstallRoot, executable: installedExecutable, executableSha256: installedSha256, version, processId: app.child.pid },
  rootSettings, discovery: { path: discoveryPath, ...discovery }, mcp: { closedWindowObject: closedMcp.result, reopened: reopened.result, afterQuit },
  performance: { scaleRoot, keywordMs: keyword, semanticMs: semantic, keywordMedianMs: median(keyword), semanticMedianMs: median(semantic), renderMs, peakWorkingSetBytes },
  uninstall: { updateExecutable, applicationExecutableRemoved: !existsSync(installedExecutable), installRootRemoved: !existsSync(actualInstallRoot), rootFilesRetained: rootFilesBefore.length, businessRootExists: existsSync(rootPath) },
  foregroundPolicy: 'hidden'
}, null, 2));
