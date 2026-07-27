import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { CustomerService } from '../src/business/customer-service';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('经营工作区真实文件状态', () => {
  test('外部删除沟通原件后读回缺失状态', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-business-ui-'));
    temporaryPaths.push(temporary);
    const rootPath = path.join(temporary, 'root');
    const database = new AppDatabase();
    const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
    const connection = database.getConnection(settings.databasePath);
    const now = new Date().toISOString();
    connection.prepare("INSERT INTO accounts VALUES ('account-1','英国生活号','','','','[]','{}','{}',1,'active',?,?)").run(now, now);
    const service = new CustomerService(connection, rootPath);
    const lead = service.createLead({
      accountId: 'account-1', platform: 'xiaohongshu', nickname: '测试客户',
      coreNeed: '', intent: '', nextAction: ''
    });
    const record = service.importConversation({
      leadId: lead.id, channel: 'xiaohongshu', occurredAt: now, text: '真实私信原文',
      summary: '测试摘要', needs: [], objections: [], suggestedReply: '', conclusion: ''
    });
    expect(record.originalFile.fileStatus).toBe('present');
    fs.rmSync(record.originalFile.filePath);
    expect(service.getLead(lead.id).conversations[0].originalFile.fileStatus).toBe('missing');
    database.close();
  });
});
