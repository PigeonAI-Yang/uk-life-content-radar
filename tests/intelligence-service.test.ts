import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { IntelligenceService } from '../src/business/intelligence-service';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('资讯扫描与候选', () => {
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
    database.close();
  });
});
