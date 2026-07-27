import { WebContentsView, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { BusinessError } from '../contracts/errors';

export type BrowserSnapshot = {
  id: string;
  url: string;
  title: string;
  html: string;
  text: string;
  selection: string;
  status: 'ready' | 'loading' | 'offline' | 'unreadable';
  error?: string;
};

type BrowserTab = BrowserSnapshot & { view: WebContentsView };

export class BrowserManager {
  private readonly tabs = new Map<string, BrowserTab>();
  private activeId?: string;
  private visible = false;

  constructor(private readonly window: BrowserWindow) {
    window.on('resize', () => this.layout());
  }

  create(url = 'about:blank') {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:content-terminal-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const tab: BrowserTab = { id, view, url, title: '新标签页', html: '', text: '', selection: '', status: 'loading' };
    this.tabs.set(id, tab);
    this.window.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      this.create(target);
      return { action: 'deny' };
    });
    view.webContents.on('did-start-loading', () => { tab.status = 'loading'; });
    view.webContents.on('did-finish-load', () => { void this.refresh(tab); });
    view.webContents.on('did-fail-load', (_event, code, description) => {
      tab.status = code === -106 ? 'offline' : 'unreadable';
      tab.error = description;
    });
    this.activate(id);
    void view.webContents.loadURL(url).catch((error) => {
      tab.status = 'unreadable';
      tab.error = error instanceof Error ? error.message : String(error);
    });
    return this.publicTab(tab);
  }

  list() {
    return { items: [...this.tabs.values()].map((tab) => this.publicTab(tab)), activeId: this.activeId };
  }

  activate(id: string) {
    const tab = this.require(id);
    this.activeId = id;
    for (const current of this.tabs.values()) current.view.setVisible(this.visible && current.id === id);
    this.layout();
    return this.publicTab(tab);
  }

  async navigate(id: string, url: string) {
    const tab = this.require(id);
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    tab.url = target;
    tab.status = 'loading';
    await tab.view.webContents.loadURL(target);
    await this.refresh(tab);
    return this.publicTab(tab);
  }

  back(id: string) {
    const tab = this.require(id);
    if (tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  }

  forward(id: string) {
    const tab = this.require(id);
    if (tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  }

  reload(id: string) {
    this.require(id).view.webContents.reload();
  }

  find(id: string, text: string) {
    const tab = this.require(id);
    if (!text) {
      tab.view.webContents.stopFindInPage('clearSelection');
      return { matches: 0 };
    }
    tab.view.webContents.findInPage(text);
    return { searching: text };
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    for (const tab of this.tabs.values()) tab.view.setVisible(visible && tab.id === this.activeId);
    this.layout();
  }

  async snapshot(id: string) {
    const tab = this.require(id);
    await this.refresh(tab);
    if (tab.status === 'offline') throw new BusinessError('OFFLINE', tab.error ?? '页面离线', '检查网络后重试', id);
    if (tab.status !== 'ready' || !tab.url || tab.url === 'about:blank') {
      throw new BusinessError('PAGE_UNREADABLE', tab.error ?? '页面不可读取', '加载可读取网页后重试', id);
    }
    return this.publicTab(tab);
  }

  async fetch(id: string, resourceUrl: string) {
    const tab = this.require(id);
    const url = new URL(resourceUrl, tab.url).href;
    let response: Response;
    try {
      response = await tab.view.webContents.session.fetch(url, { credentials: 'include' });
    } catch (error) {
      throw new BusinessError('DOWNLOAD_FAILED', error instanceof Error ? error.message : String(error), '检查网络和下载地址', id);
    }
    if (response.status === 401 || response.status === 403) throw new BusinessError('AUTH_REQUIRED', '登录状态已失效', '在对应标签重新登录', id);
    if (!response.ok) throw new BusinessError('DOWNLOAD_FAILED', `下载返回 ${response.status}`, '检查下载地址后重试', id);
    return { url, contentType: response.headers.get('content-type') ?? '', data: Buffer.from(await response.arrayBuffer()) };
  }

  private require(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) throw new BusinessError('TAB_NOT_FOUND', '浏览器标签不存在', '刷新标签列表后重试', id);
    return tab;
  }

  private async refresh(tab: BrowserTab) {
    try {
      const failedStatus = tab.status === 'offline' || tab.status === 'unreadable' ? tab.status : undefined;
      const page = await tab.view.webContents.executeJavaScript(`({
        title: document.title,
        html: document.documentElement?.outerHTML ?? '',
        text: document.body?.innerText ?? '',
        selection: globalThis.getSelection?.()?.toString() ?? ''
      })`) as { title: string; html: string; text: string; selection: string };
      if (failedStatus && !page.text.trim()) return;
      Object.assign(tab, page, { url: tab.view.webContents.getURL(), status: 'ready' as const, error: undefined });
    } catch (error) {
      tab.status = 'unreadable';
      tab.error = error instanceof Error ? error.message : String(error);
    }
  }

  private publicTab(tab: BrowserTab): BrowserSnapshot {
    return { id: tab.id, url: tab.url, title: tab.title, html: tab.html, text: tab.text, selection: tab.selection, status: tab.status, error: tab.error };
  }

  private layout() {
    const [width, height] = this.window.getContentSize();
    const bounds = { x: 194, y: 250, width: Math.max(320, width - 212), height: Math.max(240, height - 268) };
    for (const tab of this.tabs.values()) tab.view.setBounds(bounds);
  }
}
