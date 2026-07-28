import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { BusinessSnapshotService } from '../src/business/business-snapshot-service';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('跨会话经营快照', () => {
  test('空账号明确返回数据缺口而不编造经营进展', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-snapshot-'));
    temporaryPaths.push(temporary);
    const rootPath = path.join(temporary, 'root');
    const database = new AppDatabase();
    const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
    const connection = database.getConnection(settings.databasePath);
    const now = new Date().toISOString();
    connection.prepare("INSERT INTO accounts VALUES ('account-1','英国生活号','在英生活','在英华人','','[]','{}','{}',1,'active',?,?)").run(now, now);
    const snapshot = new BusinessSnapshotService(connection, rootPath).snapshot('account-1');
    expect(snapshot.products).toEqual([]);
    expect(snapshot.leads).toEqual([]);
    expect(snapshot.dataGaps).toEqual(expect.arrayContaining([
      '尚未建立产品或服务', '尚无已批准经营策略', '尚无内容项目', '尚无客户线索'
    ]));
    database.close();
  });
});
