import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { BusinessError } from '../contracts/errors';

type Row = Record<string, unknown>;

export class IntelligenceService {
  constructor(private readonly database: Database.Database) {}

  recordScan(input: Record<string, unknown>) {
    const sources = input.sources as Record<string, unknown>[];
    const candidates = input.candidates as Record<string, unknown>[];
    for (const item of [...sources, ...candidates]) {
      if (item.sourceId && !this.database.prepare('SELECT 1 FROM sources WHERE id=?').get(item.sourceId)) {
        throw new BusinessError('INVALID_INPUT', 'sourceId 只能引用终端中已有的资料对象', '网页发现的来源请省略 sourceId');
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const failed = sources.filter((source) => source.status === 'failed');
    const status = failed.length ? failed.length === sources.length ? 'failed' : 'partial' : 'succeeded';
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO tasks (
          id, type, trigger, status, progress, parameters_json, result_json, created_at, updated_at
        ) VALUES (?, 'intelligence.scan', ?, ?, 100, ?, ?, ?, ?)
      `).run(id, input.caller, status, JSON.stringify({ startedAt: input.startedAt, endedAt: input.endedAt }),
        JSON.stringify({ sourceCount: sources.length, candidateCount: candidates.length }), now, now);
      const insertSource = this.database.prepare(`
        INSERT INTO intelligence_scan_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const source of sources) {
        insertSource.run(randomUUID(), id, source.name, source.sourceId ?? null, source.status,
          source.itemCount, source.error ?? null,
          source.status === 'succeeded' ? input.endedAt : source.lastSuccessAt ?? null, now);
      }
      const insertCandidate = this.database.prepare(`
        INSERT INTO intelligence_candidates (
          id, source_id, scan_task_id, title, source_url, audience, impact, timeliness,
          verification_status, duplicate_of_id, angles_json, publish_before, status,
          discovered_at, last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?)
      `);
      for (const candidate of candidates) {
        insertCandidate.run(randomUUID(), candidate.sourceId ?? null, id, candidate.title,
          candidate.sourceUrl, candidate.audience, candidate.impact, candidate.timeliness,
          candidate.verificationStatus, candidate.duplicateOfId ?? null,
          JSON.stringify(candidate.angles), candidate.publishBefore ?? null,
          candidate.discoveredAt, input.endedAt, now, now);
      }
    })();
    return this.getScan(id);
  }

  getScan(id: string) {
    const task = this.database.prepare('SELECT * FROM tasks WHERE id=? AND type=?')
      .get(id, 'intelligence.scan') as Row | undefined;
    if (!task) throw new BusinessError('NOT_FOUND', '资讯扫描不存在', '检查扫描标识', id);
    return {
      id, status: String(task.status), trigger: String(task.trigger),
      parameters: JSON.parse(String(task.parameters_json)), result: JSON.parse(String(task.result_json)),
      sources: this.database.prepare('SELECT * FROM intelligence_scan_sources WHERE task_id=? ORDER BY source_name').all(id),
      candidates: this.database.prepare('SELECT id, title, status FROM intelligence_candidates WHERE scan_task_id=?').all(id),
      createdAt: String(task.created_at), updatedAt: String(task.updated_at)
    };
  }

  getCandidate(id: string) {
    const row = this.database.prepare('SELECT * FROM intelligence_candidates WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '资讯候选不存在', '检查候选标识', id);
    return {
      id: String(row.id), scanTaskId: String(row.scan_task_id), sourceId: row.source_id ? String(row.source_id) : null,
      title: String(row.title), sourceUrl: String(row.source_url), audience: String(row.audience),
      impact: String(row.impact), timeliness: String(row.timeliness),
      verificationStatus: String(row.verification_status),
      duplicateOfId: row.duplicate_of_id ? String(row.duplicate_of_id) : null,
      angles: JSON.parse(String(row.angles_json)), publishBefore: row.publish_before ? String(row.publish_before) : null,
      status: String(row.status), discoveredAt: String(row.discovered_at), lastCheckedAt: String(row.last_checked_at),
      promotedResourceId: row.promoted_resource_id ? String(row.promoted_resource_id) : null,
      promotedContentId: row.promoted_content_id ? String(row.promoted_content_id) : null
    };
  }

  listCandidates(status: string | undefined, limit: number) {
    const rows = status
      ? this.database.prepare('SELECT id FROM intelligence_candidates WHERE status=? ORDER BY discovered_at DESC LIMIT ?').all(status, limit)
      : this.database.prepare('SELECT id FROM intelligence_candidates ORDER BY discovered_at DESC LIMIT ?').all(limit);
    return { items: (rows as { id: string }[]).map((row) => this.getCandidate(row.id)) };
  }

  latestScan() {
    const row = this.database.prepare(
      "SELECT id FROM tasks WHERE type='intelligence.scan' ORDER BY updated_at DESC, id DESC LIMIT 1"
    ).get() as { id: string } | undefined;
    if (!row) return { latest: null };
    return { latest: this.getScan(row.id) };
  }

  markPromoted(candidateId: string, field: 'resource' | 'content', objectId: string) {
    const candidate = this.getCandidate(candidateId);
    const existingId = field === 'resource' ? candidate.promotedResourceId : candidate.promotedContentId;
    if (existingId) {
      throw new BusinessError('INVALID_INPUT', `该候选已经生成${field === 'resource' ? '资料' : '内容'}`, '读取已有对象', candidateId);
    }
    const status = field === 'resource'
      ? candidate.promotedContentId ? 'resource_and_content' : 'resource'
      : candidate.promotedResourceId ? 'resource_and_content' : 'content';
    this.database.prepare(`
      UPDATE intelligence_candidates SET status=?, ${field === 'resource' ? 'promoted_resource_id' : 'promoted_content_id'}=?, updated_at=?
      WHERE id=?
    `).run(status, objectId, new Date().toISOString(), candidateId);
    return this.getCandidate(candidateId);
  }
}
