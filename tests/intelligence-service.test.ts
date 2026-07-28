import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { IntelligenceService } from '../src/business/intelligence-service';
import { CommandDispatcher } from '../src/business/dispatcher';
import type { BrowserManager } from '../src/main/browser-manager';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('资讯扫描与候选', () => {
  test('网页来源不得伪造终端资料标识', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-intelligence-source-'));
    temporaryPaths.push(temporary);
    const database = new AppDatabase();
    const rootPath = path.join(temporary, 'root');
    const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
    const service = new IntelligenceService(database.getConnection(settings.databasePath));
    expect(() => service.recordScan({
      caller: 'test', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      sources: [{ name: 'Ofgem', sourceId: 'ofgem', status: 'succeeded', itemCount: 1 }],
      candidates: []
    })).toThrow('sourceId 只能引用终端中已有的资料对象');
    database.close();
  });

  test('部分来源失败保持 partial，历史候选保留真实发现时间', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-intelligence-'));
    temporaryPaths.push(temporary);
    const rootPath = path.join(temporary, 'root');
    const database = new AppDatabase();
    const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
    const service = new IntelligenceService(database.getConnection(settings.databasePath));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const scan = service.recordScan({
      caller: 'scheduled', startedAt: yesterday, endedAt: new Date().toISOString(),
      sources: [
        { name: 'GOV.UK', status: 'succeeded', itemCount: 1 },
        { name: '社区线索', status: 'failed', itemCount: 0, error: '连接超时', lastSuccessAt: yesterday }
      ],
      candidates: [{
        title: '英国租房规则更新', sourceUrl: 'https://www.gov.uk/example',
        audience: '在英租客', impact: '需要重新核对材料', timeliness: '本周',
        verificationStatus: '已核验', angles: ['材料清单'], discoveredAt: yesterday
      }]
    });
    expect(scan.status).toBe('partial');
    expect(scan.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_name: '社区线索', status: 'failed', last_success_at: yesterday })
    ]));
    const candidate = service.listCandidates('candidate', 10).items[0];
    expect(candidate.discoveredAt).toBe(yesterday);
    expect(candidate.status).toBe('candidate');
    expect(service.latestScan().latest).toMatchObject({
      id: scan.id,
      status: 'partial',
      sources: expect.arrayContaining([
        expect.objectContaining({ source_name: 'GOV.UK', status: 'succeeded' }),
        expect.objectContaining({ source_name: '社区线索', status: 'failed', last_success_at: yesterday })
      ])
    });
    database.close();
  });

  test('同一情报可分别沉淀为资料和内容', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-intelligence-flow-'));
    temporaryPaths.push(temporary);
    const database = new AppDatabase();
    const rootPath = path.join(temporary, 'root');
    const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
    const dispatcher = new CommandDispatcher(database.getConnection(settings.databasePath), rootPath, {} as BrowserManager);
    const account = await dispatcher.dispatch('account.create', {
      caller: 'test', idempotencyKey: 'account', name: '情报号', positioning: '英国生活',
      audience: '在英华人', tone: '自然'
    });
    if (!account.ok) throw new Error(account.error.message);
    const scan = await dispatcher.dispatch('intelligence.record_scan', {
      caller: 'test', idempotencyKey: 'scan', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      sources: [{ name: 'GOV.UK', status: 'succeeded', itemCount: 1 }],
      candidates: [{
        title: '租房新规', sourceUrl: 'https://www.gov.uk/example', audience: '在英租客',
        impact: '需要核对租约', timeliness: '本周', verificationStatus: '已核验',
        angles: ['租客须知'], discoveredAt: new Date().toISOString()
      }]
    });
    if (!scan.ok) throw new Error(scan.error.message);
    const candidateId = (scan.result as { candidates: { id: string }[] }).candidates[0].id;
    const resource = await dispatcher.dispatch('intelligence.promote_resource', {
      caller: 'test', idempotencyKey: 'resource', candidateId
    });
    const content = await dispatcher.dispatch('intelligence.promote_content', {
      caller: 'test', idempotencyKey: 'content', candidateId,
      accountId: (account.result as { id: string }).id
    });
    expect(resource.ok).toBe(true);
    expect(content.ok).toBe(true);
    if (content.ok) expect(content.result).toMatchObject({
      candidate: { status: 'resource_and_content' }
    });
    database.close();
  });
});
