import type Database from 'better-sqlite3';
import { BusinessError } from '../contracts/errors';
import { BusinessManagementService } from './business-management-service';
import { CustomerService } from './customer-service';

export class BusinessSnapshotService {
  private readonly management: BusinessManagementService;
  private readonly customers: CustomerService;

  constructor(private readonly database: Database.Database, rootPath: string) {
    this.management = new BusinessManagementService(database, rootPath);
    this.customers = new CustomerService(database, rootPath);
  }

  snapshot(accountId: string) {
    const account = this.database.prepare(
      'SELECT id, name, positioning, audience, version FROM accounts WHERE id=?'
    ).get(accountId) as Record<string, unknown> | undefined;
    if (!account) throw new BusinessError('NOT_FOUND', '账号不存在', '先创建或选择账号', accountId);
    const products = this.management.listProducts(accountId).items;
    const strategies = this.management.listStrategies(accountId).items;
    const leads = this.customers.listLeads(accountId).items;
    const contents = this.database.prepare(`
      SELECT c.id, c.title, c.status, c.updated_at,
        (SELECT count(*) FROM leads l WHERE l.source_content_id=c.id) AS consultations,
        (SELECT count(*) FROM deals d JOIN leads l ON l.id=d.lead_id
          WHERE l.source_content_id=c.id AND d.outcome='won') AS deals
      FROM content_projects c WHERE c.account_id=? ORDER BY c.updated_at DESC
    `).all(accountId);
    const stageCounts = Object.fromEntries(
      ['new_message', 'need_understood', 'wechat_added', 'negotiating', 'won', 'lost']
        .map((stage) => [stage, leads.filter((lead) => lead.stage === stage).length])
    );
    const gaps = [
      !products.length && '尚未建立产品或服务',
      !strategies.some((item) => item.status === 'approved') && '尚无已批准经营策略',
      !contents.length && '尚无内容项目',
      !leads.length && '尚无客户线索',
      leads.some((lead) => lead.conversations.some((record) => record.confirmationStatus === 'pending'))
        && '存在待确认沟通记录',
      leads.some((lead) => lead.conversations.some((record) => record.originalFile.fileStatus !== 'present'))
        && '存在缺失或被修改的沟通原件'
    ].filter(Boolean);
    return {
      generatedAt: new Date().toISOString(),
      account,
      products,
      approvedStrategies: strategies.filter((item) => item.status === 'approved'),
      pendingStrategyProposals: strategies.filter((item) => item.status === 'pending'),
      contentSupply: contents,
      customerStages: stageCounts,
      leads,
      deals: this.customers.listDeals(accountId).items,
      pending: this.pending(accountId),
      dataGaps: gaps
    };
  }

  pending(accountId: string) {
    const leads = this.customers.listLeads(accountId).items;
    const now = new Date().toISOString();
    return {
      followUps: leads.filter((lead) => lead.nextFollowUpAt && lead.nextFollowUpAt <= now),
      unconfirmedConversations: leads.flatMap((lead) => lead.conversations
        .filter((record) => record.confirmationStatus === 'pending')
        .map((record) => ({ leadId: lead.id, nickname: lead.nickname, record }))),
      missingFiles: leads.flatMap((lead) => lead.conversations
        .filter((record) => record.originalFile.fileStatus !== 'present')
        .map((record) => ({ leadId: lead.id, nickname: lead.nickname, record })))
    };
  }
}
