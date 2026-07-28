import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { CommandDispatcher } from '../src/business/dispatcher';
import { BusinessError } from '../src/contracts/errors';
import type { BrowserManager } from '../src/main/browser-manager';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

async function setup() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-handoff-'));
  temporaryPaths.push(temporary);
  const rootPath = path.join(temporary, 'root');
  const database = new AppDatabase();
  const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
  const dispatcher = new CommandDispatcher(
    database.getConnection(settings.databasePath),
    rootPath,
    {} as BrowserManager
  );
  const account = await dispatcher.dispatch('account.create', {
    caller: 'test', idempotencyKey: 'account', name: '英国生活号',
    positioning: '英国生活', audience: '在英华人', tone: '自然'
  });
  if (!account.ok) throw new Error(account.error.message);
  const accountId = (account.result as { id: string }).id;
  const proposal = await dispatcher.dispatch('strategy.propose', {
    caller: 'test', idempotencyKey: 'proposal', accountId,
    proposalType: 'conversion', proposed: { direction: '发布租房新规解读' },
    rationale: '帮助读者理解新规并引导咨询', evidence: [], successMeasure: '7天10条有效私信'
  });
  if (!proposal.ok) throw new Error(proposal.error.message);
  return { database, dispatcher, proposal: proposal.result as { id: string; version: number } };
}

describe('人工批准后 Pi 自动接力', () => {
  test('任务派发失败时仍读回真实批准和明确失败', async () => {
    const { database, dispatcher, proposal } = await setup();
    const internal = dispatcher as unknown as { tasks: { start: () => never } };
    internal.tasks.start = () => {
      throw new BusinessError('AGENT_EXECUTION_FAILED', '测试派发失败', '重试');
    };
    const response = await dispatcher.dispatch('strategy.approve', {
      id: proposal.id, expectedVersion: proposal.version
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const result = response.result as {
      strategy: { status: string; approvedStrategy: { versionFile: { filePath: string } } };
      agentTask: null;
      dispatchError: { code: string };
    };
    expect(result.strategy.status).toBe('approved');
    expect(fs.existsSync(result.strategy.approvedStrategy.versionFile.filePath)).toBe(true);
    expect(result.agentTask).toBeNull();
    expect(result.dispatchError.code).toBe('AGENT_EXECUTION_FAILED');
    database.close();
  });
});
