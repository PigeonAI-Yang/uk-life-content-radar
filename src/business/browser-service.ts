import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';
import type { BrowserManager } from '../main/browser-manager';
import { CoreService } from './core-service';

export class BrowserService {
  constructor(
    private readonly database: Database.Database,
    private readonly rootPath: string,
    private readonly browser: BrowserManager,
    private readonly core: CoreService
  ) {}

  listTabs() {
    const tabs = this.browser.list();
    const upsert = this.database.prepare(`
      INSERT INTO browser_tabs VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, status=excluded.status,
        error=excluded.error, updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    tabs.items.forEach((tab) => upsert.run(tab.id, tab.url, tab.title, tab.status, tab.error ?? null, now));
    return {
      items: tabs.items.map((tab) => ({
        id: tab.id, url: tab.url, title: tab.title, status: tab.status, error: tab.error
      })),
      activeId: tabs.activeId
    };
  }

  async collectWebpage(input: Record<string, unknown>) {
    const tab = await this.browser.snapshot(String(input.tabId));
    const duplicate = this.database.prepare('SELECT id, title FROM sources WHERE canonical_url = ?').get(tab.url) as { id: string; title: string } | undefined;
    if (duplicate) return { status: 'duplicate', code: 'DUPLICATE_URL', existing: duplicate, destination: input.destination };
    const resource = this.core.createResource({
      title: tab.title || tab.url,
      body: tab.text,
      caller: input.caller,
      idempotencyKey: input.idempotencyKey
    });
    this.database.prepare('UPDATE sources SET canonical_url = ? WHERE id = ?').run(tab.url, resource.id);
    this.snapshot(resource.id, tab.id, 'webpage', tab.url, tab.title, tab.html, resource);
    return { status: 'collected', kind: 'webpage', destination: input.destination, object: resource };
  }

  async collectSelection(input: Record<string, unknown>) {
    const tab = await this.browser.snapshot(String(input.tabId));
    if (!tab.selection.trim()) throw new BusinessError('INVALID_INPUT', '当前标签没有选中文本', '先在网页中选择文本', tab.id);
    const resource = this.core.createResource({
      title: `${tab.title || tab.url} · 摘录`,
      body: tab.selection,
      caller: input.caller,
      idempotencyKey: input.idempotencyKey
    });
    this.snapshot(resource.id, tab.id, 'selection', tab.url, tab.title, tab.text, resource);
    return { status: 'collected', kind: 'selection', destination: input.destination, object: resource, context: tab.text };
  }

  async collectFile(input: Record<string, unknown>, kind: 'image' | 'download') {
    const fetched = await this.browser.fetch(String(input.tabId), String(input.resourceUrl));
    const extension = path.extname(new URL(fetched.url).pathname) || (kind === 'image' ? '.img' : '.bin');
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', `${randomUUID()}${extension}`);
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    fs.writeFileSync(temporary, fetched.data);
    try {
      const asset = await this.core.importAsset({ filePath: temporary, caller: input.caller, idempotencyKey: input.idempotencyKey });
      return { status: 'collected', kind, destination: input.destination, object: asset, sourceUrl: fetched.url, contentType: fetched.contentType };
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary);
    }
  }

  private snapshot(
    sourceId: string,
    tabId: string,
    kind: string,
    url: string,
    title: string,
    context: string,
    resource: { filePath: string; byteSize: number; sha256: string }
  ) {
    this.database.prepare(`
      INSERT INTO source_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(randomUUID(), sourceId, tabId, kind, url, title, context, resource.filePath, resource.byteSize, resource.sha256, new Date().toISOString());
  }
}
