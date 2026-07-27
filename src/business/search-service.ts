import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { BusinessError } from '../contracts/errors';
import { embed, semanticModel, similarity } from './semantic-model';

type SearchInput = Record<string, unknown>;
type Cursor = { updatedAt: string; id: string; score?: number };
type SemanticRow = {
  type: string; id: string; title: string; source: string; topic: string; region: string;
  targetAudience: string; tags: string | string[]; status: string; updatedAt: string;
  accountId: string; platform: string; embedding: Buffer; score: number;
};

function decodeCursor(value: unknown): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) as Cursor;
    if (!parsed.updatedAt || !parsed.id) throw new Error();
    return parsed;
  } catch {
    throw new BusinessError('INVALID_INPUT', '搜索游标无效', '重新发起搜索');
  }
}

export class SearchService {
  constructor(private readonly database: Database.Database) {}

  query(input: SearchInput) {
    const where: string[] = [];
    const parameters: unknown[] = [];
    const query = String(input.query ?? '').trim();
    if (query && input.mode !== 'semantic') {
      where.push('search_fts MATCH ?');
      parameters.push(`"${query.replaceAll('"', '""')}"*`);
    }
    const types = input.types as string[];
    where.push(`object_type IN (${types.map(() => '?').join(',')})`);
    parameters.push(...types);
    for (const [field, key] of [['topic', 'topic'], ['region', 'region'], ['target_audience', 'targetAudience'], ['source', 'source'], ['status', 'status']] as const) {
      if (input[key]) {
        where.push(`${field} = ?`);
        parameters.push(input[key]);
      }
    }
    if (!input.includeArchived && !input.status) where.push("status <> 'archived'");
    if (input.dateFrom) { where.push('updated_at >= ?'); parameters.push(input.dateFrom); }
    if (input.dateTo) { where.push('updated_at <= ?'); parameters.push(input.dateTo); }
    for (const tag of input.tags as string[]) {
      where.push("EXISTS (SELECT 1 FROM json_each(search_fts.tags) WHERE value = ?)");
      parameters.push(tag);
    }
    if (input.accountId) {
      where.push(`(account_id = ? OR EXISTS (
        SELECT 1 FROM content_projects p
        LEFT JOIN content_source_refs r ON r.content_id=p.id
        LEFT JOIN content_excerpt_refs e ON e.content_id=p.id
        LEFT JOIN content_note_refs n ON n.content_id=p.id
        LEFT JOIN content_asset_refs a ON a.content_id=p.id
        WHERE p.account_id=? AND (
          (object_type='resource' AND r.source_id=object_id) OR
          (object_type='excerpt' AND e.excerpt_id=object_id) OR
          (object_type='note' AND n.note_id=object_id) OR
          (object_type='asset' AND a.asset_version_id IN (SELECT id FROM asset_versions WHERE asset_id=object_id))
        )
      ))`);
      parameters.push(input.accountId, input.accountId);
    }
    if (input.platform) {
      where.push(`(platform LIKE ? OR EXISTS (
        SELECT 1 FROM content_projects p JOIN content_versions v ON v.content_id=p.id
        LEFT JOIN content_source_refs r ON r.content_id=p.id
        LEFT JOIN content_excerpt_refs e ON e.content_id=p.id
        LEFT JOIN content_note_refs n ON n.content_id=p.id
        LEFT JOIN content_asset_refs a ON a.content_id=p.id
        WHERE v.platform=? AND (
          (object_type='resource' AND r.source_id=object_id) OR
          (object_type='excerpt' AND e.excerpt_id=object_id) OR
          (object_type='note' AND n.note_id=object_id) OR
          (object_type='asset' AND a.asset_version_id IN (SELECT id FROM asset_versions WHERE asset_id=object_id))
        )
      ))`);
      parameters.push(`%${input.platform}%`, input.platform);
    }
    const cursor = decodeCursor(input.cursor);
    if (input.mode === 'semantic') return this.semanticQuery(query, where, parameters, Number(input.limit), cursor, types);
    if (cursor) {
      where.push('(updated_at < ? OR (updated_at = ? AND object_id > ?))');
      parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const limit = Number(input.limit);
    const rows = this.database.prepare(`
      SELECT object_type AS type, object_id AS id, title, source, topic, region,
        target_audience AS targetAudience, tags, status, updated_at AS updatedAt, account_id AS accountId, platform
      FROM search_fts
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, object_id ASC
      LIMIT ?
    `).all(...parameters, limit + 1) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const items: Array<Record<string, unknown>> = rows.slice(0, limit).map((row) => ({ ...row, tags: JSON.parse(String(row.tags)) }));
    const last = items.at(-1);
    return {
      items,
      groups: Object.fromEntries(types.map((type) => [type, items.filter((item) => item.type === type).length])),
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString('base64url')
        : null
    };
  }

  indexStatus() {
    try {
      this.ensureSemanticIndex();
      const indexed = Number((this.database.prepare('SELECT count(*) AS count FROM search_fts').get() as { count: number }).count);
      const semanticIndexed = Number((this.database.prepare('SELECT count(*) AS count FROM semantic_vectors WHERE model_id=?').get(semanticModel.id) as { count: number }).count);
      return { engine: 'SQLite FTS5', available: true, indexed, objects: indexed, synchronized: semanticIndexed === indexed, semantic: { ...semanticModel, indexed: semanticIndexed } };
    } catch (error) {
      return { engine: 'SQLite FTS5', available: false, indexed: 0, objects: 0, synchronized: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private ensureSemanticIndex() {
    const rows = this.database.prepare(`
      SELECT f.object_type AS type, f.object_id AS id, f.title || ' ' || f.body || ' ' || f.tags AS text, f.updated_at AS updatedAt
      FROM search_fts f LEFT JOIN semantic_vectors v
        ON v.object_type=f.object_type AND v.object_id=f.object_id AND v.model_id=?
      WHERE v.object_id IS NULL
    `).all(semanticModel.id) as { type: string; id: string; text: string; updatedAt: string }[];
    const insert = this.database.prepare('INSERT OR REPLACE INTO semantic_vectors VALUES (?, ?, ?, ?, ?, ?)');
    this.database.transaction(() => rows.forEach((row) => insert.run(
      row.type, row.id, semanticModel.id, createHash('sha256').update(row.text).digest('hex'), embed(row.text), row.updatedAt
    )))();
  }

  private semanticQuery(query: string, where: string[], parameters: unknown[], limit: number, cursor: Cursor | undefined, types: string[]) {
    if (!query) throw new BusinessError('INVALID_INPUT', '语义搜索需要查询文字', '输入想查找的含义');
    this.ensureSemanticIndex();
    const target = embed(query);
    const rows = this.database.prepare(`
      SELECT f.object_type AS type, f.object_id AS id, f.title, f.source, f.topic, f.region,
        f.target_audience AS targetAudience, f.tags, f.status, f.updated_at AS updatedAt,
        f.account_id AS accountId, f.platform, v.embedding
      FROM (SELECT * FROM search_fts WHERE ${where.join(' AND ')}) f JOIN semantic_vectors v
        ON v.object_type=f.object_type AND v.object_id=f.object_id AND v.model_id=?
    `).all(...parameters, semanticModel.id) as Array<Omit<SemanticRow, 'score'>>;
    const ranked: SemanticRow[] = rows.map((row) => ({ ...row, tags: JSON.parse(String(row.tags)), score: similarity(target, row.embedding) }))
      .sort((left, right) => Number(right.score) - Number(left.score) || String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(left.id).localeCompare(String(right.id)));
    const after = cursor ? ranked.filter((row) =>
      Number(row.score) < Number(cursor.score) ||
      (row.score === cursor.score && (String(row.updatedAt) < cursor.updatedAt || (row.updatedAt === cursor.updatedAt && String(row.id) > cursor.id)))
    ) : ranked;
    const items = after.slice(0, limit).map((row) => {
      const item = { ...row } as Partial<SemanticRow>;
      delete item.embedding;
      return item;
    });
    const last = items.at(-1);
    return {
      items,
      groups: Object.fromEntries(types.map((type) => [type, items.filter((item) => item.type === type).length])),
      nextCursor: after.length > limit && last
        ? Buffer.from(JSON.stringify({ score: last.score, updatedAt: last.updatedAt, id: last.id })).toString('base64url')
        : null,
      model: semanticModel
    };
  }

  createView(input: SearchInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare('INSERT INTO saved_views VALUES (?, ?, ?, ?, 1, ?, ?)').run(
      id, input.name, input.scope, JSON.stringify(input.filters), now, now
    );
    return this.getView(id);
  }

  getView(id: string) {
    const row = this.database.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '保存视图不存在', '检查视图标识', id);
    return { id, name: row.name, scope: row.scope, filters: JSON.parse(String(row.filters_json)), version: row.version };
  }

  listViews(scope?: string) {
    const rows = scope
      ? this.database.prepare('SELECT id FROM saved_views WHERE scope = ? ORDER BY name, id').all(scope)
      : this.database.prepare('SELECT id FROM saved_views ORDER BY scope, name, id').all();
    return rows.map((row) => this.getView(String((row as { id: string }).id)));
  }
}
