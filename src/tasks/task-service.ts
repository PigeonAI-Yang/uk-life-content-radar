import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';
import { requestHash } from '../business/request-hash';
import type { AgentExecutor } from '../agent/agent-executor';

type TaskRow = {
  id: string;
  type: string;
  trigger: string;
  status: string;
  progress: number;
  parameters_json: string;
  result_json?: string;
  error_json?: string;
  temporary_result?: string;
  created_at: string;
  updated_at: string;
};

function mapTask(row: TaskRow) {
  return {
    id: row.id,
    type: row.type,
    trigger: row.trigger,
    status: row.status,
    progress: row.progress,
    parameters: JSON.parse(row.parameters_json) as unknown,
    result: row.result_json ? JSON.parse(row.result_json) as unknown : undefined,
    error: row.error_json ? JSON.parse(row.error_json) as unknown : undefined,
    temporaryResult: row.temporary_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class TaskService {
  private agentExecutor?: AgentExecutor;
  private activeAgentTaskId?: string;
  private activeAgentAbort?: AbortController;

  constructor(
    private readonly database: Database.Database,
    private readonly rootPath: string
  ) {
    this.recoverInterrupted();
  }

  setAgentExecutor(executor: AgentExecutor) {
    this.agentExecutor = executor;
    const interrupted = this.database.prepare(
      "SELECT id, parameters_json FROM tasks WHERE type='agent.execute' AND status='interrupted' ORDER BY updated_at, id"
    ).all() as { id: string; parameters_json: string }[];
    for (const row of interrupted) {
      const parameters = JSON.parse(row.parameters_json) as Record<string, unknown>;
      if (Number(parameters.resumeCount ?? 0) >= 1) continue;
      parameters.resumeCount = Number(parameters.resumeCount ?? 0) + 1;
      this.database.prepare(
        "UPDATE tasks SET status='queued', progress=0, parameters_json=?, temporary_result='resume:queued', updated_at=? WHERE id=?"
      ).run(JSON.stringify(parameters), new Date().toISOString(), row.id);
    }
    this.runNextAgent();
  }

  start(input: Record<string, unknown>) {
    if (!['file.write', 'file.write_batch', 'agent.execute'].includes(String(input.type))) {
      throw new BusinessError('INVALID_INPUT', `不支持的任务类型: ${String(input.type)}`, '使用已登记的任务类型');
    }
    const parameters = input.parameters as Record<string, unknown>;
    if (input.type === 'agent.execute') {
      if (!String(parameters.accountId ?? '') || !String(parameters.goal ?? '') || !String(parameters.triggerEvent ?? '')) {
        throw new BusinessError('INVALID_INPUT', 'Pi 任务缺少账号、目标或触发事件', '补充 accountId、goal 和 triggerEvent');
      }
    } else {
      const paths = input.type === 'file.write'
        ? [String(parameters.relativePath ?? '')]
        : ((parameters.items as Record<string, unknown>[] | undefined) ?? []).map((item) => String(item.relativePath ?? ''));
      if (!paths.length || paths.some((relativePath) => {
        const relative = path.relative(this.rootPath, path.resolve(this.rootPath, relativePath));
        return !relativePath || relative.startsWith('..') || path.isAbsolute(relative);
      })) {
        throw new BusinessError('INVALID_INPUT', '任务输出必须位于业务根目录内', '使用业务根目录内的相对路径');
      }
      const durationMs = Number(parameters.durationMs ?? 0);
      if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 60_000) {
        throw new BusinessError('INVALID_INPUT', '任务时长必须为 0 至 60000 毫秒整数', '修正 durationMs');
      }
    }

    const caller = String(input.caller);
    const key = String(input.idempotencyKey);
    const hash = requestHash(input);
    const task = this.database.transaction(() => {
      const existing = this.database.prepare(
        'SELECT request_hash, result_json FROM idempotency_records WHERE caller = ? AND command = ? AND idempotency_key = ?'
      ).get(caller, 'task.start', key) as { request_hash: string; result_json?: string } | undefined;
      if (existing) {
        if (existing.request_hash !== hash) {
          throw new BusinessError('IDEMPOTENCY_CONFLICT', '同一任务幂等键对应不同请求', '使用新幂等键或恢复原请求');
        }
        return JSON.parse(String(existing.result_json)) as ReturnType<typeof mapTask>;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO tasks (
          id, type, trigger, status, progress, parameters_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)
      `).run(id, input.type, caller, JSON.stringify(parameters), now, now);
      const created = this.get(id);
      this.database.prepare(`
        INSERT INTO idempotency_records (
          caller, command, idempotency_key, request_hash, status, result_json, created_at, updated_at
        ) VALUES (?, 'task.start', ?, ?, 'succeeded', ?, ?, ?)
      `).run(caller, key, hash, JSON.stringify(created), now, now);
      return created;
    })();
    if (task.status === 'queued') {
      if (task.type === 'agent.execute') this.runNextAgent();
      else setTimeout(() => this.run(task.id), 0);
    }
    return task;
  }

  get(id: string) {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '任务不存在', '检查任务标识', id);
    return mapTask(row);
  }

  list(query: string, limit: number) {
    const rows = this.database.prepare(
      'SELECT * FROM tasks WHERE type LIKE ? ORDER BY updated_at DESC, id ASC LIMIT ?'
    ).all(`%${query}%`, limit) as TaskRow[];
    return { items: rows.map(mapTask), nextCursor: undefined };
  }

  cancel(id: string) {
    const task = this.database.transaction(() => {
      const task = this.get(id);
      if (['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'].includes(task.status)) {
        if (task.status === 'succeeded') throw new BusinessError('TASK_COMPLETED', '任务已完成', '读取任务结果', id);
        return task;
      }
      const temporaryPath = this.temporaryPath(id);
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE tasks SET status = 'cancelled', temporary_result = 'removed',
          updated_at = ? WHERE id = ? AND status IN ('queued', 'running')
      `).run(now, id);
      return this.get(id);
    })();
    if (id === this.activeAgentTaskId) this.activeAgentAbort?.abort();
    return task;
  }

  private run(id: string) {
    if (this.get(id).type === 'agent.execute') {
      void this.runAgent(id);
      return;
    }
    try {
      const task = this.database.transaction(() => {
        const current = this.get(id);
        if (current.status !== 'queued') return current;
        const temporaryPath = this.temporaryPath(id);
        if (current.type === 'file.write') {
          fs.mkdirSync(path.dirname(temporaryPath), { recursive: true });
          fs.writeFileSync(temporaryPath, String((current.parameters as Record<string, unknown>).content ?? ''));
        }
        const now = new Date().toISOString();
        this.database.prepare(`
          UPDATE tasks SET status = 'running', progress = 10, temporary_result = ?,
            updated_at = ? WHERE id = ? AND status = 'queued'
        `).run(current.type === 'file.write' ? `pending:${temporaryPath}` : 'pending:batch', now, id);
        return this.get(id);
      })();
      if (task.status !== 'running') return;
      const durationMs = Number((task.parameters as Record<string, unknown>).durationMs ?? 0);
      setTimeout(() => this.complete(id), durationMs);
    } catch (error) {
      this.fail(id, error);
    }
  }

  private complete(id: string) {
    try {
      this.database.transaction(() => {
        const task = this.get(id);
        if (task.status !== 'running') return;
        if (task.type === 'file.write_batch') {
          const results = ((task.parameters as Record<string, unknown>).items as Record<string, unknown>[]).map((item) => {
            const outputPath = path.resolve(this.rootPath, String(item.relativePath));
            try {
              fs.mkdirSync(path.dirname(outputPath), { recursive: true });
              fs.writeFileSync(outputPath, String(item.content ?? ''), { flag: 'wx' });
              return { outputPath, status: 'succeeded' };
            } catch (error) {
              return { outputPath, status: 'failed', error: error instanceof Error ? error.message : String(error) };
            }
          });
          const succeeded = results.filter((result) => result.status === 'succeeded').length;
          const status = succeeded === results.length ? 'succeeded' : succeeded ? 'partial' : 'failed';
          const now = new Date().toISOString();
          this.database.prepare(`
            UPDATE tasks SET status = ?, progress = 100, result_json = ?, temporary_result = 'committed',
              updated_at = ? WHERE id = ? AND status = 'running'
          `).run(status, JSON.stringify({ results }), now, id);
          return;
        }
        const outputPath = path.resolve(this.rootPath, String((task.parameters as Record<string, unknown>).relativePath));
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.renameSync(this.temporaryPath(id), outputPath);
        const now = new Date().toISOString();
        this.database.prepare(`
          UPDATE tasks SET status = 'succeeded', progress = 100, result_json = ?,
            temporary_result = 'committed', updated_at = ? WHERE id = ? AND status = 'running'
        `).run(JSON.stringify({ outputPath }), now, id);
      })();
    } catch (error) {
      this.fail(id, error);
    }
  }

  private fail(id: string, error: unknown) {
    const temporaryPath = this.temporaryPath(id);
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    const now = new Date().toISOString();
    const businessError = error instanceof BusinessError
      ? error.toJSON()
      : { code: 'TASK_FAILED', message: error instanceof Error ? error.message : String(error) };
    this.database.prepare(`
      UPDATE tasks SET status = 'failed', error_json = ?, temporary_result = 'removed',
        updated_at = ? WHERE id = ? AND status IN ('queued', 'running')
    `).run(JSON.stringify(businessError), now, id);
  }

  private runNextAgent() {
    if (!this.agentExecutor || this.activeAgentTaskId) return;
    const row = this.database.prepare(
      "SELECT id FROM tasks WHERE type='agent.execute' AND status='queued' ORDER BY created_at, id LIMIT 1"
    ).get() as { id: string } | undefined;
    if (row) this.run(row.id);
  }

  private async runAgent(id: string) {
    if (!this.agentExecutor || this.activeAgentTaskId) return;
    const task = this.database.transaction(() => {
      const current = this.get(id);
      if (current.status !== 'queued') return current;
      this.database.prepare(
        "UPDATE tasks SET status='running', progress=10, temporary_result='agent:running', updated_at=? WHERE id=? AND status='queued'"
      ).run(new Date().toISOString(), id);
      return this.get(id);
    })();
    if (task.status !== 'running') return;

    this.activeAgentTaskId = id;
    this.activeAgentAbort = new AbortController();
    const runDirectory = path.join(this.rootPath, 'agent-runs', id);
    const eventPath = path.join(runDirectory, 'events.jsonl');
    const resultPath = path.join(runDirectory, 'result.json');
    fs.mkdirSync(runDirectory, { recursive: true });
    fs.writeFileSync(eventPath, '', { flag: 'a' });
    const parameters = task.parameters as Record<string, unknown>;
    try {
      const result = await this.agentExecutor.execute({
        taskId: id,
        accountId: String(parameters.accountId),
        goal: String(parameters.goal),
        triggerEvent: String(parameters.triggerEvent),
        objectId: parameters.objectId ? String(parameters.objectId) : undefined,
        objectVersion: parameters.objectVersion === undefined ? undefined : Number(parameters.objectVersion),
        signal: this.activeAgentAbort.signal,
        onEvent: (event) => fs.appendFileSync(eventPath, `${JSON.stringify(event)}\n`)
      });
      const payload = {
        ...result,
        files: [this.fileReadback(eventPath)]
      };
      fs.writeFileSync(`${resultPath}.tmp`, JSON.stringify(payload, null, 2));
      fs.renameSync(`${resultPath}.tmp`, resultPath);
      payload.files.push(this.fileReadback(resultPath));
      this.database.prepare(`
        UPDATE tasks SET status='succeeded', progress=100, result_json=?, temporary_result='agent:committed',
          updated_at=? WHERE id=? AND status='running'
      `).run(JSON.stringify(payload), new Date().toISOString(), id);
    } catch (error) {
      fs.writeFileSync(`${resultPath}.tmp`, JSON.stringify({
        status: this.activeAgentAbort.signal.aborted ? 'cancelled' : 'failed',
        error: error instanceof BusinessError ? error.toJSON() : { message: error instanceof Error ? error.message : String(error) }
      }, null, 2));
      fs.renameSync(`${resultPath}.tmp`, resultPath);
      if (this.activeAgentAbort.signal.aborted) {
        this.database.prepare(
          "UPDATE tasks SET status='cancelled', progress=100, result_json=?, temporary_result='agent:cancelled', updated_at=? WHERE id=? AND status='running'"
        ).run(JSON.stringify({ files: [this.fileReadback(resultPath)] }), new Date().toISOString(), id);
      } else {
        this.fail(id, error);
        this.database.prepare(
          "UPDATE tasks SET result_json=? WHERE id=? AND status='failed'"
        ).run(JSON.stringify({ files: [this.fileReadback(eventPath), this.fileReadback(resultPath)] }), id);
      }
    } finally {
      this.activeAgentTaskId = undefined;
      this.activeAgentAbort = undefined;
      this.runNextAgent();
    }
  }

  private recoverInterrupted() {
    const rows = this.database.prepare("SELECT id FROM tasks WHERE status = 'running'").all() as { id: string }[];
    const update = this.database.prepare(`
      UPDATE tasks SET status = 'interrupted', temporary_result = ?, updated_at = ? WHERE id = ? AND status = 'running'
    `);
    this.database.transaction(() => {
      for (const row of rows) {
        const temporaryPath = this.temporaryPath(row.id);
        update.run(fs.existsSync(temporaryPath) ? `retained:${temporaryPath}` : 'missing', new Date().toISOString(), row.id);
      }
    })();
  }

  private temporaryPath(id: string) {
    return path.join(this.rootPath, '.content-terminal', 'tmp', `${id}.tmp`);
  }

  private fileReadback(filePath: string) {
    const content = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    return {
      filePath: path.resolve(filePath),
      byteSize: stats.size,
      fileMtime: stats.mtime.toISOString(),
      sha256: createHash('sha256').update(content).digest('hex'),
      fileStatus: 'present'
    };
  }
}
