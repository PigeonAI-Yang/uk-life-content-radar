import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/storage/database';
import { BusinessManagementService } from '../src/business/business-management-service';
import { humanOnlyCommands } from '../src/contracts/commands';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

function workspace() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-management-'));
  temporaryPaths.push(temporary);
  const rootPath = path.join(temporary, 'root');
  const database = new AppDatabase();
  const settings = database.initialize(rootPath, path.join(temporary, 'profile', 'root.json'));
  const connection = database.getConnection(settings.databasePath);
  const now = new Date().toISOString();
  connection.prepare(`
    INSERT INTO accounts VALUES (
      'account-1', '英国生活号', '', '', '', '[]', '{}', '{}', 1, 'active', ?, ?
    )
  `).run(now, now);
  return { database, connection, rootPath, service: new BusinessManagementService(connection, rootPath) };
}

describe('产品与人工批准经营策略', () => {
  test('产品和批准策略写入真实版本文件，产品变化使旧策略失效', () => {
    const { database, connection, service } = workspace();
    const product = service.createProduct({
      accountId: 'account-1', name: '英国租房材料整理', targetCustomer: '在英租客',
      problem: '材料散乱', priceRange: '£99-£299', serviceScope: '整理与检查',
      suitableFor: '需要快速准备材料', unsuitableFor: '要求伪造材料'
    });
    expect(product.versionFile.fileStatus).toBe('present');
    expect(fs.statSync(product.versionFile.filePath).size).toBe(product.versionFile.byteSize);

    const proposal = service.proposeStrategy({
      accountId: 'account-1', productId: product.id, proposalType: 'conversion',
      proposed: { direction: '用实用清单吸引私信' }, rationale: '解决当下问题',
      evidence: ['用户常问材料清单'], successMeasure: '7天10条有效私信'
    });
    expect(proposal.status).toBe('pending');
    expect(connection.prepare('SELECT count(*) AS count FROM strategy_versions').get()).toEqual({ count: 0 });

    const approved = service.approveStrategy(proposal.id, proposal.version);
    expect(approved.status).toBe('approved');
    expect(approved.approvedStrategy?.versionFile.fileStatus).toBe('present');

    service.updateProduct({ id: product.id, expectedVersion: 1, priceRange: '£129-£329' });
    expect(service.getStrategy(proposal.id).status).toBe('invalidated');
    database.close();
  });

  test('旧版本更新被拒绝且不覆盖现有产品文件', () => {
    const { database, service } = workspace();
    const product = service.createProduct({
      accountId: 'account-1', name: '服务', targetCustomer: '客户', problem: '问题',
      priceRange: '£1', serviceScope: '范围', suitableFor: '', unsuitableFor: ''
    });
    const before = fs.readFileSync(product.versionFile.filePath, 'utf8');
    expect(() => service.updateProduct({ id: product.id, expectedVersion: 2, name: '错误覆盖' }))
      .toThrow('产品当前版本为 1');
    expect(fs.readFileSync(product.versionFile.filePath, 'utf8')).toBe(before);
    expect(service.getProduct(product.id).name).toBe('服务');
    expect(humanOnlyCommands.has('strategy.approve')).toBe(true);
    database.close();
  });
});
