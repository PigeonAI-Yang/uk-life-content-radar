import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { commandSchemas, type CommandName } from '../contracts/commands';
import { BusinessError } from '../contracts/errors';
import { requestHash } from './request-hash';
import { TaskService } from '../tasks/task-service';
import { CoreService } from './core-service';
import { PackageService } from './package-service';
import { BrowserService } from './browser-service';
import type { BrowserManager } from '../main/browser-manager';
import { LibraryService } from './library-service';
import { SearchService } from './search-service';
import { AssetService } from './asset-service';
import { BusinessManagementService } from './business-management-service';
import { CustomerService } from './customer-service';
import { BusinessSnapshotService } from './business-snapshot-service';

type Account = {
  id: string;
  name: string;
  positioning: string;
  audience: string;
  tone: string;
  forbiddenExpressions: string[];
  platformIdentities: Record<string, string>;
  defaultTemplates: Record<string, string>;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ReturnType<BusinessError['toJSON']> };

function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    name: String(row.name),
    positioning: String(row.positioning),
    audience: String(row.audience),
    tone: String(row.tone),
    forbiddenExpressions: JSON.parse(String(row.forbidden_expressions)),
    platformIdentities: JSON.parse(String(row.platform_identities)),
    defaultTemplates: JSON.parse(String(row.default_templates)),
    version: Number(row.version),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class CommandDispatcher {
  private readonly tasks: TaskService;
  private readonly core: CoreService;
  private readonly packages: PackageService;
  private readonly browser: BrowserService;
  private readonly library: LibraryService;
  private readonly search: SearchService;
  private readonly assets: AssetService;
  private readonly management: BusinessManagementService;
  private readonly customers: CustomerService;
  private readonly snapshot: BusinessSnapshotService;

  constructor(private readonly database: Database.Database, private readonly rootPath: string, browser: BrowserManager) {
    this.tasks = new TaskService(database, rootPath);
    this.core = new CoreService(database, rootPath);
    this.packages = new PackageService(database, rootPath);
    this.browser = new BrowserService(database, rootPath, browser, this.core);
    this.library = new LibraryService(database, rootPath, this.core);
    this.search = new SearchService(database);
    this.assets = new AssetService(database, rootPath);
    this.management = new BusinessManagementService(database, rootPath);
    this.customers = new CustomerService(database, rootPath);
    this.snapshot = new BusinessSnapshotService(database, rootPath);
  }

  async dispatch(name: string, input: unknown): Promise<DispatchResult> {
    try {
      if (!(name in commandSchemas)) {
        throw new BusinessError('INVALID_INPUT', `未知命令: ${name}`, '读取可用命令清单后重试');
      }
      const command = name as CommandName;
      const parsed = commandSchemas[command].parse(input);
      return { ok: true, result: await this.execute(command, parsed as Record<string, unknown>) };
    } catch (error) {
      if (error instanceof ZodError) {
        const businessError = new BusinessError('INVALID_INPUT', error.issues.map((issue) => issue.message).join('; '), '修正输入字段后重试');
        return { ok: false, error: businessError.toJSON() };
      }
      if (error instanceof BusinessError) return { ok: false, error: error.toJSON() };
      const businessError = new BusinessError('DATABASE_UNAVAILABLE', '本地数据库操作失败', '检查业务根目录和数据库后重试',
        error instanceof Error ? error.message : String(error));
      return { ok: false, error: businessError.toJSON() };
    }
  }

  private async execute(command: CommandName, input: Record<string, unknown>) {
    if (command === 'account.create') return this.createAccount(input);
    if (command === 'account.get') return this.getAccount(String(input.id));
    if (command === 'account.update') return this.updateAccount(input);
    if (command === 'account.search') return this.searchAccounts(String(input.query), Number(input.limit));
    if (command === 'product.create') {
      return this.runIdempotent(command, input, () => this.management.createProduct(input));
    }
    if (command === 'product.get') return this.management.getProduct(String(input.id));
    if (command === 'product.update') return this.management.updateProduct(input);
    if (command === 'product.list') {
      return this.management.listProducts(input.accountId ? String(input.accountId) : undefined);
    }
    if (command === 'strategy.propose') {
      return this.runIdempotent(command, input, () => this.management.proposeStrategy(input));
    }
    if (command === 'strategy.get') return this.management.getStrategy(String(input.id));
    if (command === 'strategy.list') {
      return this.management.listStrategies(
        String(input.accountId),
        input.status ? String(input.status) : undefined
      );
    }
    if (command === 'strategy.approve') {
      return this.management.approveStrategy(String(input.id), Number(input.expectedVersion));
    }
    if (command === 'lead.create') {
      return this.runIdempotent(command, input, () => this.customers.createLead(input));
    }
    if (command === 'lead.get') return this.customers.getLead(String(input.id));
    if (command === 'lead.list') {
      return this.customers.listLeads(String(input.accountId), input.stage ? String(input.stage) : undefined);
    }
    if (command === 'lead.update') return this.customers.updateLead(input);
    if (command === 'conversation.import') {
      return this.runIdempotent(command, input, () => this.customers.importConversation(input));
    }
    if (command === 'conversation.confirm') {
      return this.customers.confirmConversation(String(input.id), Number(input.expectedVersion));
    }
    if (command === 'conversation.list') {
      return this.customers.listConversations(input.leadId ? String(input.leadId) : undefined);
    }
    if (command === 'deal.record') {
      return this.runIdempotent(command, input, () => this.customers.recordDeal(input));
    }
    if (command === 'deal.list') return this.customers.listDeals(String(input.accountId));
    if (command === 'post_metrics.record') {
      return this.runIdempotent(command, input, () => this.customers.recordMetrics(input));
    }
    if (command === 'post_metrics.list') return this.customers.listMetrics(String(input.contentId));
    if (command === 'business.snapshot') return this.snapshot.snapshot(String(input.accountId));
    if (command === 'business.pending') return this.snapshot.pending(String(input.accountId));
    if (command === 'task.start') return this.tasks.start(input);
    if (command === 'task.get') return this.tasks.get(String(input.taskId));
    if (command === 'task.list') return this.tasks.list(String(input.query), Number(input.limit));
    if (command === 'task.cancel') return this.tasks.cancel(String(input.taskId));
    if (command === 'resource.create') return this.runIdempotent(command, input, () => {
      const resource = this.core.createResource(input);
      return this.library.getResource(resource.id);
    });
    if (command === 'resource.get') return this.library.getResource(String(input.id));
    if (command === 'resource.update') return this.library.updateResource(input);
    if (command === 'resource.search') return this.library.searchResources(String(input.query), Number(input.limit));
    if (command === 'resource.archive') return this.library.setResourceStatus(String(input.id), Number(input.expectedVersion), 'archived');
    if (command === 'resource.restore') return this.library.setResourceStatus(String(input.id), Number(input.expectedVersion), 'active');
    if (command === 'resource.link_content') return this.library.link('resource', String(input.id), String(input.contentId), false);
    if (command === 'resource.unlink_content') return this.library.link('resource', String(input.id), String(input.contentId), true);
    if (command === 'excerpt.create') return this.library.createExcerpt(input);
    if (command === 'excerpt.get') return this.library.getExcerpt(String(input.id));
    if (command === 'excerpt.update') return this.library.updateExcerpt(input);
    if (command === 'excerpt.search') return this.library.searchExcerpts(String(input.query), Number(input.limit));
    if (command === 'excerpt.archive') return this.library.setExcerptStatus(String(input.id), Number(input.expectedVersion), 'archived');
    if (command === 'excerpt.restore') return this.library.setExcerptStatus(String(input.id), Number(input.expectedVersion), 'active');
    if (command === 'excerpt.link_content') return this.library.link('excerpt', String(input.id), String(input.contentId), false);
    if (command === 'excerpt.unlink_content') return this.library.link('excerpt', String(input.id), String(input.contentId), true);
    if (command === 'note.create') return this.library.createNote(input);
    if (command === 'note.get') return this.library.getNote(String(input.id));
    if (command === 'note.update') return this.library.updateNote(input);
    if (command === 'note.search') return this.library.searchNotes(String(input.query), Number(input.limit));
    if (command === 'note.archive') return this.library.setNoteStatus(String(input.id), Number(input.expectedVersion), 'archived');
    if (command === 'note.restore') return this.library.setNoteStatus(String(input.id), Number(input.expectedVersion), 'active');
    if (command === 'note.link_content') return this.library.link('note', String(input.id), String(input.contentId), false);
    if (command === 'note.unlink_content') return this.library.link('note', String(input.id), String(input.contentId), true);
    if (command === 'search.query') return this.search.query(input);
    if (command === 'search.index_status') return this.search.indexStatus();
    if (command === 'settings.get') return this.getSettings();
    if (command === 'settings.update_export_directory') return this.updateSetting('exportDirectory', String(input.directory));
    if (command === 'settings.update_platform_template') return this.updatePlatformTemplate(String(input.platform), input.template as Record<string, unknown>);
    if (command === 'storage.scan') return this.scanStorage();
    if (command === 'saved_view.create') return this.runIdempotent(command, input, () => this.search.createView(input));
    if (command === 'saved_view.get') return this.search.getView(String(input.id));
    if (command === 'saved_view.list') return this.search.listViews(input.scope ? String(input.scope) : undefined);
    if (command === 'asset.import') return this.runIdempotent(command, input, async () => {
      const asset = await this.core.importAsset(input);
      return this.assets.get(asset.id);
    });
    if (command === 'asset.get') return this.assets.get(String(input.id));
    if (command === 'asset.search') return this.assets.search(String(input.query), Number(input.limit));
    if (command === 'asset.archive') return this.assets.setStatus(String(input.id), Number(input.expectedVersion), 'archived');
    if (command === 'asset.restore') return this.assets.setStatus(String(input.id), Number(input.expectedVersion), 'active');
    if (command === 'asset.import_external_version') return this.runIdempotent(command, input, () => this.assets.importExternal(input));
    if (command === 'asset.crop') return this.runIdempotent(command, input, () => this.assets.crop(input));
    if (command === 'asset.resize') return this.runIdempotent(command, input, () => this.assets.resize(input));
    if (command === 'asset.compress') return this.runIdempotent(command, input, () => this.assets.compress(input));
    if (command === 'asset.convert_platform_size') return this.runIdempotent(command, input, () => this.assets.convert(input));
    if (command === 'asset.overlay_text') return this.runIdempotent(command, input, () => this.assets.overlay(input));
    if (command === 'content.create') return this.runIdempotent(command, input, () => this.core.createContent(input));
    if (command === 'content.get') return this.core.getContent(String(input.id));
    if (command === 'content.save_version') return this.core.saveVersion(input);
    if (command === 'content.history') return this.core.history(String(input.contentId));
    if (command === 'content.create_from_version') return this.runIdempotent(command, input, () => this.core.createFromVersion(input));
    if (command === 'content.generate_platform_version') return this.runIdempotent(command, input, () => this.core.generatePlatformVersion(input));
    if (command === 'content.link_resource') return this.core.linkResource(String(input.contentId), String(input.resourceId));
    if (command === 'content.unlink_resource') return this.core.linkResource(String(input.contentId), String(input.resourceId), true);
    if (command === 'content.link_asset') return this.core.linkAsset(String(input.contentId), String(input.assetVersionId), Number(input.order));
    if (command === 'content.unlink_asset') return this.core.linkAsset(String(input.contentId), String(input.assetVersionId), 0, true);
    if (command === 'package.create_preview') return this.runIdempotent(command, input, () => this.packages.createPreview(input));
    if (command === 'package.list_candidates') return this.packages.listCandidates(String(input.query), Number(input.limit));
    if (command === 'package.request_approval') return this.packages.requestApproval(String(input.candidateId));
    if (command === 'package.get_approval') return this.packages.getApproval(String(input.candidateId));
    if (command === 'approval.approve') return this.packages.approve(String(input.candidateId));
    if (command === 'package.build') return this.runIdempotent(command, input, () =>
      Array.isArray(input.candidateIds) ? this.packages.buildBatch(input.candidateIds.map(String)) : this.packages.build(String(input.candidateId))
    );
    if (command === 'package.get') return this.packages.getPackage(String(input.id));
    if (command === 'package.open_directory') return { directoryPath: this.packages.getPackage(String(input.id)).directoryPath };
    if (command === 'package.copy_text') return this.packages.copyText(String(input.id));
    if (command === 'browser.tabs.list') return this.browser.listTabs();
    if (command === 'collect.webpage') return this.runIdempotent(command, input, () => this.browser.collectWebpage(input));
    if (command === 'collect.selection') return this.runIdempotent(command, input, () => this.browser.collectSelection(input));
    if (command === 'collect.image') return this.runIdempotent(command, input, () => this.browser.collectFile(input, 'image'));
    if (command === 'collect.download') return this.runIdempotent(command, input, () => this.browser.collectFile(input, 'download'));
    throw new BusinessError('COMMAND_NOT_IMPLEMENTED', `${command} 尚未在当前依赖任务实现`, '等待对应业务任务完成');
  }

  private getSettings() {
    const rows = this.database.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
    const values = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    return {
      rootPath: this.rootPath,
      databasePath: path.join(this.rootPath, '.content-terminal', 'index.sqlite'),
      databaseByteSize: fs.statSync(path.join(this.rootPath, '.content-terminal', 'index.sqlite')).size,
      temporaryPath: path.join(this.rootPath, '.content-terminal', 'tmp'),
      exportDirectory: values.exportDirectory ?? path.join(this.rootPath, 'packages'),
      platformTemplates: values.platformTemplates ?? {},
      storageAlert: values.storageAlert,
      index: this.search.indexStatus(),
      lastScan: this.readStorageScan()
    };
  }

  private updateSetting(key: string, value: unknown) {
    if (key === 'exportDirectory') {
      const directory = path.resolve(String(value));
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.W_OK);
        value = directory;
      } catch {
        throw new BusinessError('FILE_UNWRITABLE', '默认导出目录不可写', '选择可写目录');
      }
    }
    this.database.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
    return this.getSettings();
  }

  private updatePlatformTemplate(platform: string, template: Record<string, unknown>) {
    const settings = this.getSettings();
    return this.updateSetting('platformTemplates', { ...settings.platformTemplates as Record<string, unknown>, [platform]: template });
  }

  private async scanStorage() {
    let fileCount = 0;
    let byteSize = 0;
    const counts: Record<string, { files: number; bytes: number }> = {};
    const visit = async (directory: string) => {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
          const size = (await fs.promises.stat(absolute)).size;
          const category = path.relative(this.rootPath, absolute).split(path.sep)[0] || '.';
          counts[category] ??= { files: 0, bytes: 0 };
          counts[category].files += 1;
          counts[category].bytes += size;
          fileCount += 1;
          byteSize += size;
        }
      }
    };
    try {
      await fs.promises.access(this.rootPath, fs.constants.R_OK);
      for (const directory of ['sources', 'assets', 'packages']) {
        await visit(path.join(this.rootPath, directory));
      }
      const disk = fs.statfsSync(this.rootPath);
      const previous = this.readStorageScan();
      const scan = {
        id: randomUUID(), rootPath: this.rootPath, fileCount, byteSize,
        growthFiles: fileCount - Number(previous?.fileCount ?? fileCount),
        growthBytes: byteSize - Number(previous?.byteSize ?? byteSize),
        totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize,
        diskState: disk.bavail * disk.bsize < 1024 ** 3 ? 'low' : 'available',
        counts, scannedAt: new Date().toISOString()
      };
      this.database.prepare('INSERT INTO storage_scans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        scan.id, scan.fileCount, scan.byteSize, scan.growthFiles, scan.growthBytes,
        scan.totalBytes, scan.freeBytes, JSON.stringify(scan.counts), scan.scannedAt
      );
      return scan;
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      throw new BusinessError('FILE_UNREADABLE', '业务根目录读取或统计失败', '恢复目录访问后重试', error instanceof Error ? error.message : String(error));
    }
  }

  private readStorageScan() {
    const row = this.database.prepare('SELECT * FROM storage_scans ORDER BY scanned_at DESC, id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return row && {
      id: row.id, fileCount: row.file_count, byteSize: row.byte_size,
      growthFiles: row.growth_files, growthBytes: row.growth_bytes,
      totalBytes: row.total_bytes, freeBytes: row.free_bytes,
      counts: JSON.parse(String(row.counts_json)), scannedAt: row.scanned_at
    };
  }

  private async runIdempotent(command: CommandName, input: Record<string, unknown>, operation: () => unknown | Promise<unknown>) {
    const caller = String(input.caller);
    const key = String(input.idempotencyKey);
    const hash = requestHash(input);
    const existing = this.database.prepare(
      'SELECT request_hash, result_json FROM idempotency_records WHERE caller = ? AND command = ? AND idempotency_key = ?'
    ).get(caller, command, key) as { request_hash: string; result_json: string } | undefined;
    if (existing) {
      if (existing.request_hash !== hash) throw new BusinessError('IDEMPOTENCY_CONFLICT', '同一幂等键对应不同请求', '使用新幂等键或恢复原请求');
      return JSON.parse(existing.result_json) as unknown;
    }
    const result = await operation();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO idempotency_records
      (caller, command, idempotency_key, request_hash, status, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)
    `).run(caller, command, key, hash, JSON.stringify(result), now, now);
    return result;
  }

  private createAccount(input: Record<string, unknown>) {
    const caller = String(input.caller);
    const key = String(input.idempotencyKey);
    const hash = requestHash(input);
    return this.database.transaction(() => {
      const record = this.database.prepare(
        'SELECT request_hash, result_json FROM idempotency_records WHERE caller = ? AND command = ? AND idempotency_key = ?'
      ).get(caller, 'account.create', key) as { request_hash: string; result_json?: string } | undefined;
      if (record) {
        if (record.request_hash !== hash) {
          throw new BusinessError('IDEMPOTENCY_CONFLICT', '同一幂等键对应不同请求', '使用新幂等键或恢复原请求');
        }
        return JSON.parse(String(record.result_json)) as Account;
      }

      const now = new Date().toISOString();
      const account: Account = {
        id: randomUUID(),
        name: String(input.name),
        positioning: String(input.positioning),
        audience: String(input.audience),
        tone: String(input.tone),
        forbiddenExpressions: input.forbiddenExpressions as string[],
        platformIdentities: input.platformIdentities as Record<string, string>,
        defaultTemplates: input.defaultTemplates as Record<string, string>,
        version: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now
      };
      const file = this.writeAccountVersion(account.id, 1, account);
      this.database.prepare(`
        INSERT INTO accounts (
          id, name, positioning, audience, tone, forbidden_expressions,
          platform_identities, default_templates, version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
      `).run(account.id, account.name, account.positioning, account.audience, account.tone,
        JSON.stringify(account.forbiddenExpressions), JSON.stringify(account.platformIdentities), JSON.stringify(account.defaultTemplates), now, now);
      this.database.prepare(`
        INSERT INTO account_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), account.id, JSON.stringify(account), file.filePath, file.byteSize, file.sha256, file.fileMtime, now);
      const result = this.getAccount(account.id);
      this.database.prepare(`
        INSERT INTO idempotency_records (
          caller, command, idempotency_key, request_hash, status, result_json, created_at, updated_at
        ) VALUES (?, 'account.create', ?, ?, 'succeeded', ?, ?, ?)
      `).run(caller, key, hash, JSON.stringify(result), now, now);
      return result;
    })();
  }

  private getAccount(id: string) {
    const row = this.database.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '账号不存在', '检查账号标识', id);
    const account = mapAccount(row);
    const version = this.database.prepare('SELECT * FROM account_versions WHERE account_id=? AND version=?')
      .get(id, account.version) as Record<string, unknown> | undefined;
    const file = version ? this.readAccountFile(version) : undefined;
    const contents = this.database.prepare('SELECT id, title, status FROM content_projects WHERE account_id=? ORDER BY updated_at DESC').all(id);
    const packages = this.database.prepare('SELECT id, platform, status FROM packages WHERE account_id=? ORDER BY created_at DESC').all(id);
    const platforms = ['xiaohongshu', 'douyin', 'wechat'];
    return {
      ...account, configFile: file, usage: { contents, packages },
      platformStates: Object.fromEntries(platforms.map((platform) => [platform, {
        identity: Object.hasOwn(account.platformIdentities, platform) ? (account.platformIdentities[platform] ? 'ready' : 'invalid') : 'missing',
        template: Object.hasOwn(account.defaultTemplates, platform) ? (account.defaultTemplates[platform] ? 'ready' : 'invalid') : 'missing'
      }]))
    };
  }

  private updateAccount(input: Record<string, unknown>) {
    const current = this.getAccount(String(input.id));
    const expectedVersion = Number(input.expectedVersion);
    if (current.version !== expectedVersion) {
      throw new BusinessError('VERSION_CONFLICT', `账号当前版本为 ${current.version}`, '读回最新版本后重新提交', current.id);
    }
    const next = {
      name: input.name === undefined ? current.name : String(input.name),
      positioning: input.positioning === undefined ? current.positioning : String(input.positioning),
      audience: input.audience === undefined ? current.audience : String(input.audience),
      tone: input.tone === undefined ? current.tone : String(input.tone)
      ,forbiddenExpressions: input.forbiddenExpressions === undefined ? current.forbiddenExpressions : input.forbiddenExpressions as string[]
      ,platformIdentities: input.platformIdentities === undefined ? current.platformIdentities : input.platformIdentities as Record<string, string>
      ,defaultTemplates: input.defaultTemplates === undefined ? current.defaultTemplates : input.defaultTemplates as Record<string, string>
    };
    const now = new Date().toISOString();
    const file = this.writeAccountVersion(current.id, expectedVersion + 1, { ...current, ...next, version: expectedVersion + 1, updatedAt: now });
    const result = this.database.prepare(`
      UPDATE accounts SET name = ?, positioning = ?, audience = ?, tone = ?,
        forbidden_expressions=?, platform_identities=?, default_templates=?,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `).run(next.name, next.positioning, next.audience, next.tone, JSON.stringify(next.forbiddenExpressions),
      JSON.stringify(next.platformIdentities), JSON.stringify(next.defaultTemplates), now, current.id, expectedVersion);
    if (result.changes !== 1) {
      throw new BusinessError('VERSION_CONFLICT', '账号已被其他入口更新', '读回最新版本后重新提交', current.id);
    }
    this.database.prepare(`
      INSERT INTO account_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), current.id, expectedVersion + 1, JSON.stringify(next), file.filePath, file.byteSize, file.sha256, file.fileMtime, now);
    return this.getAccount(current.id);
  }

  private searchAccounts(query: string, limit: number) {
    const rows = this.database.prepare(
      'SELECT id FROM accounts WHERE name LIKE ? ORDER BY updated_at DESC, id ASC LIMIT ?'
    ).all(`%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.getAccount(row.id)), nextCursor: undefined };
  }

  private writeAccountVersion(accountId: string, version: number, value: unknown) {
    const target = path.join(this.rootPath, 'accounts', accountId, `${String(version).padStart(4, '0')}.json`);
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', `${randomUUID()}.tmp`);
    const data = Buffer.from(JSON.stringify(value, null, 2));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, target);
    const stat = fs.statSync(target);
    return {
      filePath: path.resolve(target), byteSize: stat.size,
      sha256: createHash('sha256').update(data).digest('hex'), fileMtime: stat.mtime.toISOString()
    };
  }

  private readAccountFile(row: Record<string, unknown>) {
    const filePath = String(row.file_path);
    if (!fs.existsSync(filePath)) return { filePath, byteSize: row.byte_size, sha256: row.sha256, fileMtime: row.file_mtime, fileStatus: 'missing' };
    const data = fs.readFileSync(filePath);
    const actual = createHash('sha256').update(data).digest('hex');
    return {
      filePath: path.resolve(filePath), byteSize: data.length, sha256: row.sha256,
      actualSha256: actual, fileMtime: fs.statSync(filePath).mtime.toISOString(),
      fileStatus: actual === row.sha256 && data.length === row.byte_size ? 'present' : 'modified'
    };
  }
}
