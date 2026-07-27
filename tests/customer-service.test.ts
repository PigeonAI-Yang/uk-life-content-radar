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

function workspace() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-customer-'));
  temporaryPaths.push(temporary);
  const rootPath = path.join(temporary, 'root');
  const database = new AppDatabase();
  const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
  const connection = database.getConnection(settings.databasePath);
  const now = new Date().toISOString();
  connection.prepare("INSERT INTO accounts VALUES ('account-1','英国生活号','','','','[]','{}','{}',1,'active',?,?)").run(now, now);
  connection.prepare("INSERT INTO products VALUES ('product-1','account-1','租房材料整理','在英租客','材料散乱','£99','整理','需要整理','伪造材料',1,'active',?,?)").run(now, now);
  connection.prepare("INSERT INTO content_projects VALUES ('content-1','account-1','租房材料清单',1,'active',?,?)").run(now, now);
  return { database, connection, rootPath, service: new CustomerService(connection, rootPath) };
}

describe('帖子到成交客户链', () => {
  test('客户、原始沟通、成交和帖子表现可双向读回', () => {
    const { database, service } = workspace();
    const lead = service.createLead({
      accountId: 'account-1', productId: 'product-1', sourceContentId: 'content-1',
      platform: 'xiaohongshu', nickname: '小英', coreNeed: '下周交材料',
      intent: '高', nextAction: '加微信'
    });
    const conversation = service.importConversation({
      leadId: lead.id, channel: 'xiaohongshu', occurredAt: new Date().toISOString(),
      text: '你好，我下周就要交租房材料，可以帮忙吗？', summary: '咨询租房材料整理',
      needs: ['时效'], objections: [], suggestedReply: '可以，先发材料清单', conclusion: '待加微信'
    });
    expect(conversation.originalFile.fileStatus).toBe('present');
    expect(fs.existsSync(conversation.originalFile.filePath)).toBe(true);
    expect(service.confirmConversation(conversation.id, 1).confirmationStatus).toBe('confirmed');

    const deal = service.recordDeal({
      leadId: lead.id, productId: 'product-1', outcome: 'won', amountMinor: 12900,
      currency: 'GBP', decidedAt: new Date().toISOString(), reason: '时效明确',
      contentInsight: '材料清单类帖子带来高意向咨询'
    }) as Record<string, unknown>;
    expect(deal.outcome).toBe('won');
    expect(service.getLead(lead.id).sourceContentId).toBe('content-1');
    expect(service.getLead(lead.id).stage).toBe('won');

    service.recordMetrics({
      contentId: 'content-1', platform: 'xiaohongshu', observedAt: new Date().toISOString(),
      sourceType: 'manual', views: 1000, messages: 8
    });
    expect(service.listMetrics('content-1').items).toHaveLength(1);
    database.close();
  });

  test('身份未确认不自动合并，原件不存在不产生沟通记录', () => {
    const { database, connection, service } = workspace();
    const pending = service.importConversation({
      channel: 'wechat', occurredAt: new Date().toISOString(), text: '不确定是谁的对话',
      summary: '身份待确认', needs: [], objections: [], suggestedReply: '', conclusion: ''
    });
    expect(pending.leadId).toBeNull();
    expect(() => service.importConversation({
      channel: 'wechat', occurredAt: new Date().toISOString(),
      filePath: path.join(os.tmpdir(), 'definitely-missing.png'), summary: '失败实验',
      needs: [], objections: [], suggestedReply: '', conclusion: ''
    })).toThrow('沟通原件不存在');
    expect((connection.prepare('SELECT count(*) AS count FROM conversation_records').get() as { count: number }).count).toBe(1);
    database.close();
  });
});
