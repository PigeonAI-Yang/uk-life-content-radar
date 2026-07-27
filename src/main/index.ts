import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { AppDatabase, type RootSettings } from '../storage/database';
import { CommandDispatcher, type DispatchResult } from '../business/dispatcher';
import { BusinessError } from '../contracts/errors';
import { startPipeServer } from './pipe-server';
import { BrowserManager } from './browser-manager';
import { runSharpProbe } from './sharp-probe';

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
  const pipe = startPipeServer(app.getPath('userData'), (name, input) => {
    if (!dispatcher) {
      const error = new BusinessError('FILE_UNWRITABLE', '业务根目录尚未初始化', '先在设置中初始化业务根目录');
      return { ok: false, error: error.toJSON() };
    }
    return dispatcher.dispatch(name, input);
  });
  app.once('before-quit', () => {
    quitting = true;
    pipe.server.close();
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
