import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AppDatabase } from '../src/storage/database';
import { TaskService } from '../src/tasks/task-service';
import type { AgentExecutor } from '../src/agent/agent-executor';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

function workspace() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-agent-task-'));
  temporaryPaths.push(temporary);
  const rootPath = path.join(temporary, 'root');
  const database = new AppDatabase();
  const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
  return { database, connection: database.getConnection(settings.databasePath), rootPath };
}

async function waitFor<T extends { status: string }>(get: () => T, status: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = get();
    if (value.status === status) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`任务未进入 ${status}`);
}

describe('Pi 持久任务', () => {
  test('串行执行、写入事件和结果文件并保持幂等', async () => {
    const { database, connection, rootPath } = workspace();
    const service = new TaskService(connection, rootPath);
    let calls = 0;
    const executor: AgentExecutor = {
      execute: async ({ onEvent }) => {
        calls += 1;
        onEvent({ type: 'tool_call', name: 'business.snapshot' });
        return { sessionId: 'session-1', summary: '已完成', toolCalls: 1 };
      }
    };
    service.setAgentExecutor(executor);
    const input = {
      caller: 'test', idempotencyKey: 'same-agent-task', type: 'agent.execute',
      parameters: { accountId: 'account-1', goal: '读取经营快照', triggerEvent: 'manual' }
    };
    const first = service.start(input);
    const second = service.start(input);
    expect(second.id).toBe(first.id);
    const completed = await waitFor(() => service.get(first.id), 'succeeded');
    expect(calls).toBe(1);
    const files = (completed.result as { files: { filePath: string; fileStatus: string }[] }).files;
    expect(files).toHaveLength(2);
    expect(files.every((file) => fs.existsSync(file.filePath) && file.fileStatus === 'present')).toBe(true);
    database.close();
  });

  test('取消运行任务后停止执行且不写成成功', async () => {
    const { database, connection, rootPath } = workspace();
    const service = new TaskService(connection, rootPath);
    const executor: AgentExecutor = {
      execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        setTimeout(() => resolve({ summary: '不应完成', toolCalls: 0 }), 10_000);
      })
    };
    service.setAgentExecutor(executor);
    const task = service.start({
      caller: 'test', idempotencyKey: 'cancel-agent-task', type: 'agent.execute',
      parameters: { accountId: 'account-1', goal: '等待取消', triggerEvent: 'manual' }
    });
    await waitFor(() => service.get(task.id), 'running');
    service.cancel(task.id);
    await waitFor(() => service.get(task.id), 'cancelled');
    expect(service.get(task.id).status).toBe('cancelled');
    database.close();
  });

  test('启动时只自动恢复中断任务一次', async () => {
    const { database, connection, rootPath } = workspace();
    const now = new Date().toISOString();
    connection.prepare(`
      INSERT INTO tasks (id, type, trigger, status, progress, parameters_json, created_at, updated_at)
      VALUES ('agent-interrupted', 'agent.execute', 'test', 'running', 10, ?, ?, ?)
    `).run(JSON.stringify({ accountId: 'account-1', goal: '恢复', triggerEvent: 'restart' }), now, now);
    const service = new TaskService(connection, rootPath);
    expect(service.get('agent-interrupted').status).toBe('interrupted');
    service.setAgentExecutor({
      execute: async () => ({ summary: '恢复完成', toolCalls: 0 })
    });
    const completed = await waitFor(() => service.get('agent-interrupted'), 'succeeded');
    expect((completed.parameters as { resumeCount: number }).resumeCount).toBe(1);
    database.close();
  });
});
