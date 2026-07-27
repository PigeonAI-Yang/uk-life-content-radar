import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';
import { CoreService } from './core-service';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export class LibraryService {
  constructor(
    private readonly database: Database.Database,
    private readonly rootPath: string,
    private readonly core: CoreService
  ) {}

  getResource(id: string) {
    const resource = this.core.getResource(id);
    const row = this.database.prepare('SELECT canonical_url, topic, region, target_audience, tags, created_at, updated_at FROM sources WHERE id = ?').get(id) as Record<string, unknown>;
    const usage = this.database.prepare('SELECT content_id FROM content_source_refs WHERE source_id = ? ORDER BY content_id').all(id);
    const snapshots = this.database.prepare('SELECT kind, url, title, context, created_at FROM source_snapshots WHERE source_id = ? ORDER BY created_at DESC').all(id);
    return {
      ...resource, canonicalUrl: row.canonical_url, topic: row.topic, region: row.region,
      targetAudience: row.target_audience, tags: JSON.parse(String(row.tags)),
      createdAt: row.created_at, updatedAt: row.updated_at, usage, snapshots
    };
  }

  updateResource(input: Record<string, unknown>) {
    const current = this.getResource(String(input.id));
    this.assertVersion(current.version, input.expectedVersion, current.id, '资料');
    const nextVersion = Number(current.version) + 1;
    const title = input.title === undefined ? String(current.title) : String(input.title);
    const body = input.body === undefined ? String(current.body) : String(input.body);
    const topic = input.topic === undefined ? String(current.topic) : String(input.topic);
    const region = input.region === undefined ? String(current.region) : String(input.region);
    const targetAudience = input.targetAudience === undefined ? String(current.targetAudience) : String(input.targetAudience);
    const tags = input.tags === undefined ? current.tags : input.tags;
    const target = path.join(this.rootPath, 'sources', `${current.id}-v${nextVersion}.md`);
    const info = this.writeVersion(target, body);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE sources SET title=?, body=?, topic=?, region=?, target_audience=?, tags=?,
          version=?, file_path=?, byte_size=?, sha256=?, file_mtime=?, updated_at=?
        WHERE id=? AND version=?
      `).run(title, body, topic, region, targetAudience, JSON.stringify(tags), nextVersion, info.filePath, info.byteSize, info.sha256, info.fileMtime, now, current.id, current.version);
      this.database.prepare('INSERT INTO source_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(), current.id, nextVersion, title, body, info.filePath, info.byteSize, info.sha256, info.fileMtime, now
      );
    })();
    return this.getResource(current.id);
  }

  searchResources(query: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT id FROM sources WHERE (title LIKE ? OR body LIKE ?) AND status <> 'archived'
      ORDER BY updated_at DESC, id LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.getResource(row.id)), nextCursor: undefined };
  }

  setResourceStatus(id: string, expectedVersion: number, status: 'active' | 'archived') {
    const current = this.getResource(id);
    this.assertVersion(current.version, expectedVersion, id, '资料');
    this.database.prepare('UPDATE sources SET status=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(
      status, new Date().toISOString(), id, expectedVersion
    );
    return this.getResource(id);
  }

  createExcerpt(input: Record<string, unknown>) {
    this.core.getResource(String(input.sourceId));
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO excerpts (id, source_id, text, context, version, status, created_at, updated_at, topic, region, target_audience, tags)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.sourceId, input.text, input.context, 'active', now, now,
      input.topic, input.region, input.targetAudience, JSON.stringify(input.tags)
    );
    return this.getExcerpt(id);
  }

  getExcerpt(id: string) {
    const row = this.database.prepare('SELECT * FROM excerpts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '摘录不存在', '检查摘录标识', id);
    const source = this.database.prepare('SELECT title, canonical_url FROM sources WHERE id = ?').get(row.source_id);
    const usage = this.database.prepare('SELECT content_id FROM content_excerpt_refs WHERE excerpt_id = ? ORDER BY content_id').all(id);
    return {
      id, sourceId: row.source_id, text: row.text, context: row.context, version: Number(row.version), status: row.status,
      topic: row.topic, region: row.region, targetAudience: row.target_audience, tags: JSON.parse(String(row.tags)),
      source, usage, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  updateExcerpt(input: Record<string, unknown>) {
    const current = this.getExcerpt(String(input.id));
    this.assertVersion(current.version, input.expectedVersion, current.id, '摘录');
    this.database.prepare(`
      UPDATE excerpts SET text=?, context=?, topic=?, region=?, target_audience=?, tags=?,
        version=version+1, updated_at=? WHERE id=? AND version=?
    `).run(
      input.text, input.context, input.topic ?? current.topic, input.region ?? current.region,
      input.targetAudience ?? current.targetAudience, JSON.stringify(input.tags ?? current.tags),
      new Date().toISOString(), current.id, current.version
    );
    return this.getExcerpt(current.id);
  }

  searchExcerpts(query: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT id FROM excerpts WHERE (text LIKE ? OR context LIKE ?) AND status <> 'archived'
      ORDER BY updated_at DESC, id LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.getExcerpt(row.id)), nextCursor: undefined };
  }

  setExcerptStatus(id: string, expectedVersion: number, status: 'active' | 'archived') {
    const current = this.getExcerpt(id);
    this.assertVersion(current.version, expectedVersion, id, '摘录');
    this.database.prepare('UPDATE excerpts SET status=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(status, new Date().toISOString(), id, expectedVersion);
    return this.getExcerpt(id);
  }

  createNote(input: Record<string, unknown>) {
    if (input.sourceId) this.core.getResource(String(input.sourceId));
    if (input.contentId) this.requireContent(String(input.contentId));
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO notes (id, body, source_id, content_id, version, status, created_at, updated_at, topic, region, target_audience, tags)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.body, input.sourceId ?? null, input.contentId ?? null, 'active', now, now,
      input.topic, input.region, input.targetAudience, JSON.stringify(input.tags)
    );
    if (input.contentId) this.database.prepare('INSERT OR IGNORE INTO content_note_refs VALUES (?, ?)').run(input.contentId, id);
    return this.getNote(id);
  }

  getNote(id: string) {
    const row = this.database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '笔记不存在', '检查笔记标识', id);
    const usage = this.database.prepare('SELECT content_id FROM content_note_refs WHERE note_id = ? ORDER BY content_id').all(id);
    return {
      id, body: row.body, sourceId: row.source_id, contentId: row.content_id, version: Number(row.version), status: row.status,
      topic: row.topic, region: row.region, targetAudience: row.target_audience, tags: JSON.parse(String(row.tags)),
      usage, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  updateNote(input: Record<string, unknown>) {
    const current = this.getNote(String(input.id));
    this.assertVersion(current.version, input.expectedVersion, current.id, '笔记');
    this.database.prepare(`
      UPDATE notes SET body=?, topic=?, region=?, target_audience=?, tags=?, version=version+1, updated_at=?
      WHERE id=? AND version=?
    `).run(
      input.body, input.topic ?? current.topic, input.region ?? current.region,
      input.targetAudience ?? current.targetAudience, JSON.stringify(input.tags ?? current.tags),
      new Date().toISOString(), current.id, current.version
    );
    return this.getNote(current.id);
  }

  searchNotes(query: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT id FROM notes WHERE body LIKE ? AND status <> 'archived' ORDER BY updated_at DESC, id LIMIT ?
    `).all(`%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.getNote(row.id)), nextCursor: undefined };
  }

  setNoteStatus(id: string, expectedVersion: number, status: 'active' | 'archived') {
    const current = this.getNote(id);
    this.assertVersion(current.version, expectedVersion, id, '笔记');
    this.database.prepare('UPDATE notes SET status=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(status, new Date().toISOString(), id, expectedVersion);
    return this.getNote(id);
  }

  link(kind: 'resource' | 'excerpt' | 'note', id: string, contentId: string, remove: boolean) {
    this.requireContent(contentId);
    if (kind === 'resource') return this.core.linkResource(contentId, id, remove);
    if (kind === 'excerpt') this.getExcerpt(id); else this.getNote(id);
    const table = kind === 'excerpt' ? 'content_excerpt_refs' : 'content_note_refs';
    const column = kind === 'excerpt' ? 'excerpt_id' : 'note_id';
    this.database.prepare(remove
      ? `DELETE FROM ${table} WHERE content_id=? AND ${column}=?`
      : `INSERT OR IGNORE INTO ${table} VALUES (?, ?)`
    ).run(contentId, id);
    return kind === 'excerpt' ? this.getExcerpt(id) : this.getNote(id);
  }

  private requireContent(id: string) {
    if (!this.database.prepare('SELECT id FROM content_projects WHERE id = ?').get(id)) throw new BusinessError('NOT_FOUND', '内容不存在', '检查内容标识', id);
  }

  private assertVersion(current: unknown, expected: unknown, id: string, label: string) {
    if (Number(current) !== Number(expected)) throw new BusinessError('VERSION_CONFLICT', `${label}版本已变化`, '读回最新版本后重试', id);
  }

  private writeVersion(target: string, body: string) {
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', `${randomUUID()}.tmp`);
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    fs.writeFileSync(temporary, body, { flag: 'wx' });
    fs.renameSync(temporary, target);
    const bytes = fs.readFileSync(target);
    const stat = fs.statSync(target);
    return { filePath: target, byteSize: bytes.length, sha256: digest(bytes), fileMtime: stat.mtime.toISOString() };
  }
}
