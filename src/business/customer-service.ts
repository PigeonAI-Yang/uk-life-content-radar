import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';

type Row = Record<string, unknown>;

export class CustomerService {
  constructor(private readonly database: Database.Database, private readonly rootPath: string) {}

  createLead(input: Record<string, unknown>) {
    this.require('accounts', String(input.accountId), '账号');
    if (input.productId) this.require('products', String(input.productId), '产品');
    if (input.sourceContentId) this.require('content_projects', String(input.sourceContentId), '来源内容');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO leads VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'new_message', ?, ?, 0, ?, ?, 1, 'active', ?, ?
      )
    `).run(id, input.accountId, input.productId ?? null, input.sourceContentId ?? null,
      input.platform, input.nickname, now, input.coreNeed, input.intent, input.nextAction,
      input.nextFollowUpAt ?? null, now, now);
    return this.getLead(id);
  }

  getLead(id: string) {
    const row = this.database.prepare('SELECT * FROM leads WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '客户线索不存在', '检查客户标识', id);
    const sourceContent = row.source_content_id
      ? this.database.prepare('SELECT id, title FROM content_projects WHERE id=?').get(row.source_content_id)
      : null;
    const product = row.product_id
      ? this.database.prepare('SELECT id, name FROM products WHERE id=?').get(row.product_id)
      : null;
    return {
      id: String(row.id), accountId: String(row.account_id),
      productId: row.product_id ? String(row.product_id) : null,
      sourceContentId: row.source_content_id ? String(row.source_content_id) : null,
      platform: String(row.platform), nickname: String(row.nickname),
      firstContactAt: String(row.first_contact_at), stage: String(row.stage),
      coreNeed: String(row.core_need), intent: String(row.intent),
      wechatAdded: Boolean(row.wechat_added), nextAction: String(row.next_action),
      nextFollowUpAt: row.next_follow_up_at ? String(row.next_follow_up_at) : null,
      version: Number(row.version), status: String(row.status),
      sourceContent, product,
      conversations: this.listConversations(String(row.id)).items,
      deals: this.database.prepare('SELECT * FROM deals WHERE lead_id=? ORDER BY decided_at DESC').all(row.id)
    };
  }

  listLeads(accountId: string, stage?: string) {
    this.require('accounts', accountId, '账号');
    const rows = stage
      ? this.database.prepare('SELECT id FROM leads WHERE account_id=? AND stage=? ORDER BY updated_at DESC').all(accountId, stage)
      : this.database.prepare('SELECT id FROM leads WHERE account_id=? ORDER BY updated_at DESC').all(accountId);
    return { items: (rows as { id: string }[]).map((row) => this.getLead(row.id)) };
  }

  updateLead(input: Record<string, unknown>) {
    const current = this.getLead(String(input.id));
    if (current.version !== Number(input.expectedVersion)) {
      throw new BusinessError('VERSION_CONFLICT', `客户当前版本为 ${current.version}`, '读回后重试', current.id);
    }
    const next = {
      stage: input.stage ?? current.stage,
      coreNeed: input.coreNeed ?? current.coreNeed,
      intent: input.intent ?? current.intent,
      wechatAdded: input.wechatAdded ?? current.wechatAdded,
      nextAction: input.nextAction ?? current.nextAction,
      nextFollowUpAt: input.nextFollowUpAt === undefined ? current.nextFollowUpAt : input.nextFollowUpAt
    };
    const result = this.database.prepare(`
      UPDATE leads SET stage=?, core_need=?, intent=?, wechat_added=?, next_action=?,
        next_follow_up_at=?, version=version+1, updated_at=?
      WHERE id=? AND version=?
    `).run(next.stage, next.coreNeed, next.intent, next.wechatAdded ? 1 : 0, next.nextAction,
      next.nextFollowUpAt, new Date().toISOString(), current.id, current.version);
    if (result.changes !== 1) throw new BusinessError('VERSION_CONFLICT', '客户已被更新', '读回后重试', current.id);
    return this.getLead(current.id);
  }

  importConversation(input: Record<string, unknown>) {
    if (input.leadId) this.getLead(String(input.leadId));
    const id = randomUUID();
    const now = new Date().toISOString();
    const file = input.filePath
      ? this.copyOriginal(String(input.filePath), id)
      : this.writeText(String(input.text), id);
    this.database.prepare(`
      INSERT INTO conversation_records VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'active', ?, ?
      )
    `).run(id, input.leadId ?? null, input.channel, input.occurredAt, input.summary,
      JSON.stringify(input.needs), JSON.stringify(input.objections), input.suggestedReply,
      input.conclusion, input.nextFollowUpAt ?? null, file.filePath, file.byteSize,
      file.sha256, file.fileMtime, now, now);
    return this.getConversation(id);
  }

  confirmConversation(id: string, expectedVersion: number) {
    const current = this.getConversation(id);
    if (current.version !== expectedVersion) {
      throw new BusinessError('VERSION_CONFLICT', `沟通记录当前版本为 ${current.version}`, '读回后重试', id);
    }
    const result = this.database.prepare(`
      UPDATE conversation_records SET confirmation_status='confirmed', updated_at=?
      WHERE id=? AND confirmation_status='pending'
    `).run(new Date().toISOString(), id);
    if (result.changes !== 1) throw new BusinessError('INVALID_INPUT', '该记录已确认', '读取当前状态', id);
    return this.getConversation(id);
  }

  listConversations(leadId?: string) {
    const rows = leadId
      ? this.database.prepare('SELECT id FROM conversation_records WHERE lead_id=? ORDER BY occurred_at DESC').all(leadId)
      : this.database.prepare('SELECT id FROM conversation_records ORDER BY occurred_at DESC').all();
    return { items: (rows as { id: string }[]).map((row) => this.getConversation(row.id)) };
  }

  recordDeal(input: Record<string, unknown>) {
    const lead = this.getLead(String(input.leadId));
    this.require('products', String(input.productId), '产品');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.leadId, input.productId, input.outcome, input.amountMinor ?? null,
        input.currency, input.decidedAt, input.reason, input.contentInsight, now, now);
      this.updateLead({ id: lead.id, expectedVersion: lead.version, stage: input.outcome });
    })();
    return this.database.prepare('SELECT * FROM deals WHERE id=?').get(id);
  }

  listDeals(accountId: string) {
    this.require('accounts', accountId, '账号');
    return { items: this.database.prepare(`
      SELECT d.*, l.source_content_id, l.nickname FROM deals d
      JOIN leads l ON l.id=d.lead_id WHERE l.account_id=? ORDER BY d.decided_at DESC
    `).all(accountId) };
  }

  recordMetrics(input: Record<string, unknown>) {
    this.require('content_projects', String(input.contentId), '内容');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO post_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.contentId, input.platform, input.observedAt, input.sourceType,
      input.impressions ?? null, input.views ?? null, input.likes ?? null, input.saves ?? null,
      input.comments ?? null, input.messages ?? null, input.evidenceFilePath ?? null, now);
    return this.database.prepare('SELECT * FROM post_metrics WHERE id=?').get(id);
  }

  listMetrics(contentId: string) {
    this.require('content_projects', contentId, '内容');
    return { items: this.database.prepare(
      'SELECT * FROM post_metrics WHERE content_id=? ORDER BY observed_at DESC'
    ).all(contentId) };
  }

  private getConversation(id: string) {
    const row = this.database.prepare('SELECT *, 1 AS version FROM conversation_records WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '沟通记录不存在', '检查记录标识', id);
    return {
      id: String(row.id), leadId: row.lead_id ? String(row.lead_id) : null,
      channel: String(row.channel), occurredAt: String(row.occurred_at), summary: String(row.summary),
      needs: JSON.parse(String(row.needs_json)), objections: JSON.parse(String(row.objections_json)),
      suggestedReply: String(row.suggested_reply), conclusion: String(row.conclusion),
      confirmationStatus: String(row.confirmation_status), version: 1,
      originalFile: this.readFile(row)
    };
  }

  private copyOriginal(source: string, id: string) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new BusinessError('FILE_MISSING', '沟通原件不存在', '检查导入文件', source);
    }
    const target = path.join(this.rootPath, 'conversations', id, path.basename(source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return this.fileInfo(target);
  }

  private writeText(text: string, id: string) {
    const target = path.join(this.rootPath, 'conversations', id, 'original.txt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, { flag: 'wx' });
    return this.fileInfo(target);
  }

  private fileInfo(filePath: string) {
    const data = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    return { filePath: path.resolve(filePath), byteSize: data.length,
      sha256: createHash('sha256').update(data).digest('hex'), fileMtime: stat.mtime.toISOString() };
  }

  private readFile(row: Row) {
    const saved = String(row.sha256);
    const filePath = String(row.file_path);
    if (!fs.existsSync(filePath)) return { filePath, fileStatus: 'missing' };
    const info = this.fileInfo(filePath);
    const data = fs.readFileSync(filePath);
    return { ...info, savedSha256: saved, contentSummary: data.toString('utf8').slice(0, 240),
      fileStatus: info.sha256 === saved ? 'present' : 'modified' };
  }

  private require(table: string, id: string, label: string) {
    if (!this.database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) {
      throw new BusinessError('NOT_FOUND', `${label}不存在`, `检查${label}标识`, id);
    }
  }
}
