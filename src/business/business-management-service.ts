import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';

type Row = Record<string, unknown>;

export class BusinessManagementService {
  constructor(
    private readonly database: Database.Database,
    private readonly rootPath: string
  ) {}

  createProduct(input: Record<string, unknown>) {
    this.requireAccount(String(input.accountId));
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      accountId: String(input.accountId),
      name: String(input.name),
      targetCustomer: String(input.targetCustomer),
      problem: String(input.problem),
      priceRange: String(input.priceRange),
      serviceScope: String(input.serviceScope),
      suitableFor: String(input.suitableFor),
      unsuitableFor: String(input.unsuitableFor),
      version: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now
    };
    return this.database.transaction(() => {
      const file = this.writeJson(
        path.join('business', 'products', product.id, '0001.json'),
        product
      );
      this.database.prepare(`
        INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
      `).run(
        product.id, product.accountId, product.name, product.targetCustomer, product.problem,
        product.priceRange, product.serviceScope, product.suitableFor, product.unsuitableFor,
        now, now
      );
      this.database.prepare(`
        INSERT INTO product_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), product.id, JSON.stringify(product), file.filePath, file.byteSize,
        file.sha256, file.fileMtime, now
      );
      return this.getProduct(product.id);
    })();
  }

  getProduct(id: string) {
    const row = this.database.prepare('SELECT * FROM products WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '产品或服务不存在', '检查产品标识', id);
    const product = this.mapProduct(row);
    const version = this.database.prepare(
      'SELECT * FROM product_versions WHERE product_id=? AND version=?'
    ).get(id, product.version) as Row;
    return { ...product, versionFile: this.readFile(version) };
  }

  listProducts(accountId?: string) {
    const rows = accountId
      ? this.database.prepare(
        'SELECT id FROM products WHERE account_id=? ORDER BY updated_at DESC, id'
      ).all(accountId)
      : this.database.prepare('SELECT id FROM products ORDER BY updated_at DESC, id').all();
    return { items: (rows as { id: string }[]).map((row) => this.getProduct(row.id)) };
  }

  updateProduct(input: Record<string, unknown>) {
    const current = this.getProduct(String(input.id));
    const expectedVersion = Number(input.expectedVersion);
    if (current.version !== expectedVersion) {
      throw new BusinessError(
        'VERSION_CONFLICT',
        `产品当前版本为 ${current.version}`,
        '读回最新版本后重新提交',
        current.id
      );
    }
    const next = {
      ...current,
      name: input.name === undefined ? current.name : String(input.name),
      targetCustomer: input.targetCustomer === undefined
        ? current.targetCustomer : String(input.targetCustomer),
      problem: input.problem === undefined ? current.problem : String(input.problem),
      priceRange: input.priceRange === undefined ? current.priceRange : String(input.priceRange),
      serviceScope: input.serviceScope === undefined
        ? current.serviceScope : String(input.serviceScope),
      suitableFor: input.suitableFor === undefined ? current.suitableFor : String(input.suitableFor),
      unsuitableFor: input.unsuitableFor === undefined
        ? current.unsuitableFor : String(input.unsuitableFor),
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString()
    };
    delete (next as { versionFile?: unknown }).versionFile;
    return this.database.transaction(() => {
      const file = this.writeJson(
        path.join('business', 'products', current.id, `${String(next.version).padStart(4, '0')}.json`),
        next
      );
      const result = this.database.prepare(`
        UPDATE products SET name=?, target_customer=?, problem=?, price_range=?,
          service_scope=?, suitable_for=?, unsuitable_for=?, version=version+1, updated_at=?
        WHERE id=? AND version=?
      `).run(
        next.name, next.targetCustomer, next.problem, next.priceRange, next.serviceScope,
        next.suitableFor, next.unsuitableFor, next.updatedAt, current.id, expectedVersion
      );
      if (result.changes !== 1) {
        throw new BusinessError(
          'VERSION_CONFLICT',
          '产品已被其他入口更新',
          '读回最新版本后重新提交',
          current.id
        );
      }
      this.database.prepare(`
        INSERT INTO product_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), current.id, next.version, JSON.stringify(next), file.filePath,
        file.byteSize, file.sha256, file.fileMtime, next.updatedAt
      );
      this.database.prepare(`
        UPDATE strategy_versions SET status='invalidated', invalidated_at=?
        WHERE product_id=? AND status='active'
      `).run(next.updatedAt, current.id);
      this.database.prepare(`
        UPDATE strategy_proposals SET status='invalidated', updated_at=?
        WHERE product_id=? AND status='approved'
      `).run(next.updatedAt, current.id);
      return this.getProduct(current.id);
    })();
  }

  proposeStrategy(input: Record<string, unknown>) {
    this.requireAccount(String(input.accountId));
    if (input.productId) this.getProduct(String(input.productId));
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO strategy_proposals (
        id, account_id, product_id, proposal_type, proposed_json, rationale,
        evidence_json, success_measure, status, version, approved_strategy_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, NULL, ?, ?)
    `).run(
      id, input.accountId, input.productId ?? null, input.proposalType,
      JSON.stringify(input.proposed), input.rationale, JSON.stringify(input.evidence),
      input.successMeasure, now, now
    );
    return this.getStrategy(id);
  }

  getStrategy(id: string) {
    const row = this.database.prepare(
      'SELECT * FROM strategy_proposals WHERE id=?'
    ).get(id) as Row | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '经营提案不存在', '检查提案标识', id);
    const approved = row.approved_strategy_id
      ? this.database.prepare('SELECT * FROM strategy_versions WHERE id=?')
        .get(row.approved_strategy_id) as Row | undefined
      : undefined;
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      productId: row.product_id === null ? null : String(row.product_id),
      proposalType: String(row.proposal_type),
      proposed: JSON.parse(String(row.proposed_json)),
      rationale: String(row.rationale),
      evidence: JSON.parse(String(row.evidence_json)),
      successMeasure: String(row.success_measure),
      status: String(row.status),
      version: Number(row.version),
      approvedStrategy: approved ? {
        id: String(approved.id),
        version: Number(approved.version),
        status: String(approved.status),
        approvedAt: String(approved.approved_at),
        versionFile: this.readFile(approved)
      } : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  listStrategies(accountId: string, status?: string) {
    this.requireAccount(accountId);
    const rows = status
      ? this.database.prepare(
        'SELECT id FROM strategy_proposals WHERE account_id=? AND status=? ORDER BY updated_at DESC, id'
      ).all(accountId, status)
      : this.database.prepare(
        'SELECT id FROM strategy_proposals WHERE account_id=? ORDER BY updated_at DESC, id'
      ).all(accountId);
    return { items: (rows as { id: string }[]).map((row) => this.getStrategy(row.id)) };
  }

  approveStrategy(id: string, expectedVersion: number) {
    const current = this.getStrategy(id);
    if (current.version !== expectedVersion) {
      throw new BusinessError(
        'VERSION_CONFLICT',
        `提案当前版本为 ${current.version}`,
        '读回最新提案后重新批准',
        id
      );
    }
    if (current.status !== 'pending') {
      throw new BusinessError('INVALID_INPUT', '只有待批准提案可以批准', '读取提案当前状态', id);
    }
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      this.database.prepare(`
        UPDATE strategy_versions SET status='invalidated', invalidated_at=?
        WHERE account_id=? AND status='active'
          AND ((product_id IS NULL AND ? IS NULL) OR product_id=?)
      `).run(now, current.accountId, current.productId, current.productId);
      const versionRow = this.database.prepare(`
        SELECT COALESCE(MAX(version), 0) AS version
        FROM strategy_versions WHERE account_id=?
          AND ((product_id IS NULL AND ? IS NULL) OR product_id=?)
      `).get(current.accountId, current.productId, current.productId) as { version: number };
      const strategyId = randomUUID();
      const strategyVersion = versionRow.version + 1;
      const snapshot = {
        proposalId: current.id,
        accountId: current.accountId,
        productId: current.productId,
        proposalType: current.proposalType,
        proposed: current.proposed,
        rationale: current.rationale,
        evidence: current.evidence,
        successMeasure: current.successMeasure,
        version: strategyVersion,
        approvedAt: now
      };
      const file = this.writeJson(
        path.join(
          'business', 'strategies', current.accountId,
          `${String(strategyVersion).padStart(4, '0')}-${strategyId}.json`
        ),
        snapshot
      );
      this.database.prepare(`
        INSERT INTO strategy_versions VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?
        )
      `).run(
        strategyId, current.accountId, current.productId, current.id, strategyVersion,
        JSON.stringify(snapshot), file.filePath, file.byteSize, file.sha256, file.fileMtime,
        now, now
      );
      const result = this.database.prepare(`
        UPDATE strategy_proposals
        SET status='approved', version=version+1, approved_strategy_id=?, updated_at=?
        WHERE id=? AND version=? AND status='pending'
      `).run(strategyId, now, id, expectedVersion);
      if (result.changes !== 1) {
        throw new BusinessError(
          'VERSION_CONFLICT',
          '提案已被其他入口处理',
          '读回最新提案状态',
          id
        );
      }
      return this.getStrategy(id);
    })();
  }

  private mapProduct(row: Row) {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      name: String(row.name),
      targetCustomer: String(row.target_customer),
      problem: String(row.problem),
      priceRange: String(row.price_range),
      serviceScope: String(row.service_scope),
      suitableFor: String(row.suitable_for),
      unsuitableFor: String(row.unsuitable_for),
      version: Number(row.version),
      status: String(row.status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private requireAccount(id: string) {
    if (!this.database.prepare('SELECT 1 FROM accounts WHERE id=?').get(id)) {
      throw new BusinessError('NOT_FOUND', '账号不存在', '先创建或选择账号', id);
    }
  }

  private writeJson(relativePath: string, value: unknown) {
    const target = path.join(this.rootPath, relativePath);
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', `${randomUUID()}.tmp`);
    const data = Buffer.from(JSON.stringify(value, null, 2));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(temporary, data, { flag: 'wx' });
      fs.renameSync(temporary, target);
    } catch {
      if (fs.existsSync(temporary)) fs.rmSync(temporary);
      throw new BusinessError('FILE_UNWRITABLE', '业务版本文件无法保存', '检查业务根目录写入权限');
    }
    const stat = fs.statSync(target);
    return {
      filePath: path.resolve(target),
      byteSize: stat.size,
      sha256: createHash('sha256').update(data).digest('hex'),
      fileMtime: stat.mtime.toISOString()
    };
  }

  private readFile(row: Row) {
    const filePath = String(row.file_path);
    if (!fs.existsSync(filePath)) {
      return {
        filePath,
        byteSize: Number(row.byte_size),
        savedSha256: String(row.sha256),
        fileMtime: String(row.file_mtime),
        fileStatus: 'missing'
      };
    }
    const data = fs.readFileSync(filePath);
    const actualSha256 = createHash('sha256').update(data).digest('hex');
    return {
      filePath: path.resolve(filePath),
      byteSize: data.length,
      savedSha256: String(row.sha256),
      actualSha256,
      fileMtime: fs.statSync(filePath).mtime.toISOString(),
      contentSummary: data.toString('utf8').slice(0, 240),
      fileStatus: actualSha256 === row.sha256 && data.length === row.byte_size
        ? 'present' : 'modified'
    };
  }
}
