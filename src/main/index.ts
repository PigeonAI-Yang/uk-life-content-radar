import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { AppDatabase, type RootSettings } from '../storage/database';
import { CommandDispatcher, type DispatchResult } from '../business/dispatcher';
import { BusinessError } from '../contracts/errors';
import { startPipeServer } from './pipe-server';
import { BrowserManager } from './browser-manager';
import { runSharpProbe } from './sharp-probe';
import { PiAgentExecutor } from '../agent/pi-agent-executor';
import { CustomApiConfigStore, EncryptedApiKeyStore, importCodexSubscription, scanAgentAuth } from '../agent/auth-service';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (started) app.quit();

let mainWindow: BrowserWindow | undefined;
let quitting = false;
const backgroundTest = app.commandLine.hasSwitch('background-test');

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    x: backgroundTest ? -32000 : undefined,
    y: backgroundTest ? -32000 : undefined,
    opacity: backgroundTest ? 0 : 1,
    show: !process.env.CONTENT_TERMINAL_SMOKE_FILE && !backgroundTest,
    skipTaskbar: backgroundTest,
    focusable: !backgroundTest,
    backgroundColor: '#F7F8FA',
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY }
  });

  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow = window;
};

void app.whenReady().then(() => {
  const probeDirectory = app.commandLine.getSwitchValue('sharp-probe');
  if (probeDirectory) {
    void runSharpProbe(probeDirectory).then((result) => {
      fs.writeFileSync(path.join(probeDirectory, 'result.json'), JSON.stringify(result, null, 2));
      app.quit();
    }).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
    return;
  }
  createWindow();
  const browser = new BrowserManager(mainWindow!);
  const database = new AppDatabase();
  const configPath = path.join(app.getPath('userData'), 'root.json');
  let dispatcher: CommandDispatcher | undefined;
  const pipeState: { current?: ReturnType<typeof startPipeServer> } = {};
  const agentDir = path.join(app.getPath('userData'), 'pi-agent');
  const apiKeyStore = new EncryptedApiKeyStore(path.join(app.getPath('userData'), 'agent-api-key.json'), safeStorage);
  const customApiStore = new CustomApiConfigStore(path.join(app.getPath('userData'), 'agent-api.json'));
  const authStatus = () => scanAgentAuth({
    piAuthPath: path.join(agentDir, 'auth.json'),
    codexAuthPath: path.join(os.homedir(), '.codex', 'auth.json'),
    apiKeyConfigured: apiKeyStore.isConfigured()
  });
  const configureAgent = () => {
    if (!dispatcher || !pipeState.current) return;
    dispatcher.setAgentExecutor(new PiAgentExecutor({
      cwd: app.getAppPath(),
      agentDir,
      executablePath: process.execPath,
      helperPath: app.isPackaged
        ? path.join(process.resourcesPath, 'mcp-helper.cjs')
        : path.resolve('build', 'mcp-helper.cjs'),
      discoveryPath: pipeState.current.discoveryPath,
      skillPath: app.isPackaged
        ? path.join(process.resourcesPath, 'content-business-partner', 'SKILL.md')
        : path.resolve('skills', 'content-business-partner', 'SKILL.md'),
      radarSkillPath: app.isPackaged
        ? path.join(process.resourcesPath, 'SKILL.md')
        : path.resolve('SKILL.md'),
      sourceMapPath: app.isPackaged
        ? path.join(process.resourcesPath, 'source-map.md')
        : path.resolve('references', 'source-map.md'),
      customApiProvider: () => {
        const config = customApiStore.read();
        return config && apiKeyStore.isConfigured() ? { ...config, apiKey: apiKeyStore.load() } : undefined;
      }
    }));
  };
  ipcMain.handle('agent:scan-auth', () => authStatus());
  ipcMain.handle('agent:save-api-key', (_event, apiKey: string) => {
    apiKeyStore.save(apiKey);
    return authStatus();
  });
  ipcMain.handle('agent:get-custom-api', () => ({
    config: customApiStore.read(),
    apiKeyConfigured: apiKeyStore.isConfigured()
  }));
  ipcMain.handle('agent:save-custom-api', (_event, input: { baseUrl: string; model: string; apiKey?: string }) => {
    if (input.apiKey?.trim()) apiKeyStore.save(input.apiKey);
    if (!apiKeyStore.isConfigured()) {
      throw new BusinessError('AGENT_AUTH_REQUIRED', '自定义 API 尚未配置密钥', '输入 API Key');
    }
    return { config: customApiStore.save(input), apiKeyConfigured: true };
  });
  ipcMain.handle('agent:import-cockpit', () => {
    const directory = path.join(os.homedir(), '.antigravity_cockpit', 'codex_local_access_sidecar');
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')) as {
      host?: unknown; port?: unknown; 'api-keys'?: unknown;
    };
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as {
      modelIds?: unknown;
    };
    const keys = Array.isArray(config['api-keys']) ? config['api-keys'].map(String).filter(Boolean) : [];
    const models = Array.isArray(manifest.modelIds) ? manifest.modelIds.map(String).filter(Boolean) : [];
    const host = String(config.host ?? '127.0.0.1');
    const port = Number(config.port);
    if (!keys[0] || !Number.isInteger(port) || !models.length) {
      throw new BusinessError('AGENT_AUTH_REQUIRED', 'CockpitTools API 配置不可用', '在 CockpitTools 中启用 API 服务和账号');
    }
    apiKeyStore.save(keys[0]);
    const saved = customApiStore.save({
      baseUrl: `http://${host}:${port}/v1`,
      model: models.includes('gpt-5.6-sol') ? 'gpt-5.6-sol' : models[0]
    });
    return { config: saved, apiKeyConfigured: true, models };
  });
  const customApiRequest = async (pathName: string, init?: RequestInit) => {
    const config = customApiStore.read();
    if (!config || !apiKeyStore.isConfigured()) {
      throw new BusinessError('AGENT_AUTH_REQUIRED', '自定义 API 尚未配置完成', '填写接口地址、API Key 和模型');
    }
    const response = await fetch(`${config.baseUrl}${pathName}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKeyStore.load()}`,
        'Content-Type': 'application/json',
        ...init?.headers
      },
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw new BusinessError('AGENT_MODEL_UNAVAILABLE', `自定义 API 返回 ${response.status}`, '检查 CockpitTools 服务、密钥和模型');
    }
    return response.json() as Promise<Record<string, unknown>>;
  };
  ipcMain.handle('agent:discover-models', async () => {
    const response = await customApiRequest('/models');
    return {
      models: Array.isArray(response.data)
        ? response.data.map((item) => String((item as { id?: unknown }).id ?? '')).filter(Boolean)
        : []
    };
  });
  ipcMain.handle('agent:test-custom-api', async () => {
    const config = customApiStore.read();
    if (!config) throw new BusinessError('AGENT_MODEL_UNAVAILABLE', '尚未选择模型', '先保存自定义 API');
    const response = await customApiRequest('/responses', {
      method: 'POST',
      body: JSON.stringify({ model: config.model, input: '只回复 OK', max_output_tokens: 16, stream: false })
    });
    return { connected: Boolean(response.id), status: response.status, model: response.model ?? config.model };
  });
  ipcMain.handle('agent:import-codex', async () => {
    await importCodexSubscription(
      path.join(os.homedir(), '.codex', 'auth.json'),
      path.join(agentDir, 'auth.json')
    );
    return authStatus();
  });
  ipcMain.handle('agent:login', async (_event, method: 'browser' | 'device_code') => {
    const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json') });
    await runtime.login('openai-codex', 'oauth', {
      prompt: async (prompt) => {
        if (prompt.type === 'select') return method;
        return new Promise<string>((_resolve, reject) => {
          prompt.signal?.addEventListener('abort', () => reject(new Error('登录输入已取消')), { once: true });
        });
      },
      notify: (event) => {
        mainWindow?.webContents.send('agent:auth-event', event);
        if (event.type === 'auth_url') void shell.openExternal(event.url);
        if (event.type === 'device_code') void shell.openExternal(event.verificationUri);
      }
    });
    return authStatus();
  });
  if (fs.existsSync(configPath)) {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RootSettings;
    dispatcher = new CommandDispatcher(database.getConnection(saved.databasePath), saved.rootPath, browser);
  }
  ipcMain.handle('settings:choose-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle('settings:initialize-root', (_event, rootPath: string) => {
    const settings = database.initialize(rootPath, configPath);
    dispatcher = new CommandDispatcher(database.getConnection(settings.databasePath), settings.rootPath, browser);
    configureAgent();
    return settings;
  });
  ipcMain.handle('settings:get', (): RootSettings | undefined => {
    if (!fs.existsSync(configPath)) return undefined;
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RootSettings;
    return database.read(saved.databasePath);
  });
  ipcMain.handle('business:dispatch', async (_event, name: string, input: unknown): Promise<DispatchResult> => {
    if (!dispatcher) {
      const error = new BusinessError('FILE_UNWRITABLE', '业务根目录尚未初始化', '先在设置中初始化业务根目录');
      return { ok: false, error: error.toJSON() };
    }
    return dispatcher.dispatch(name, input);
  });
  ipcMain.handle('browser:create', (_event, url?: string) => browser.create(url));
  ipcMain.handle('browser:activate', (_event, id: string) => browser.activate(id));
  ipcMain.handle('browser:navigate', (_event, id: string, url: string) => browser.navigate(id, url));
  ipcMain.handle('browser:back', (_event, id: string) => browser.back(id));
  ipcMain.handle('browser:forward', (_event, id: string) => browser.forward(id));
  ipcMain.handle('browser:reload', (_event, id: string) => browser.reload(id));
  ipcMain.handle('browser:find', (_event, id: string, text: string) => browser.find(id, text));
  ipcMain.handle('browser:visible', (_event, visible: boolean) => browser.setVisible(visible));
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:close-window', () => mainWindow?.close());
  ipcMain.handle('app:reopen-window', () => backgroundTest ? mainWindow?.showInactive() : mainWindow?.show());
  ipcMain.handle('system:open-path', (_event, filePath: string) => shell.openPath(filePath));
  ipcMain.handle('system:open-external', (_event, value: string) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开 HTTP 或 HTTPS 原文');
    return shell.openExternal(url.href);
  });
  ipcMain.handle('system:copy-text', (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle('system:image-data', (_event, filePath: string) => {
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  });
  ipcMain.handle('system:capture-page', async (_event, filePath: string) => {
    const image = await mainWindow!.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
  });
  pipeState.current = startPipeServer(app.getPath('userData'), (name, input) => {
    if (!dispatcher) {
      const error = new BusinessError('FILE_UNWRITABLE', '业务根目录尚未初始化', '先在设置中初始化业务根目录');
      return { ok: false, error: error.toJSON() };
    }
    return dispatcher.dispatch(name, input);
  });
  configureAgent();
  app.once('before-quit', () => {
    quitting = true;
    pipeState.current?.server.close();
    database.close();
  });
  const receipt = process.env.CONTENT_TERMINAL_SMOKE_FILE;
  if (receipt) {
    fs.writeFileSync(path.resolve(receipt), JSON.stringify({ ready: true, version: app.getVersion() }));
    app.quit();
  }
});

app.on('activate', () => {
  if (backgroundTest) return;
  if (mainWindow) mainWindow.show();
  else createWindow();
});
