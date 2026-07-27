import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export class PackageService {
  constructor(private readonly database: Database.Database, private readonly rootPath: string) {}

  createPreview(input: Record<string, unknown>) {
    const account = this.database.prepare('SELECT * FROM accounts WHERE id = ?').get(input.accountId) as Record<string, unknown> | undefined;
    const version = this.database.prepare(`
      SELECT v.*, p.title, p.account_id, p.version AS project_version
      FROM content_versions v JOIN content_projects p ON p.id = v.content_id WHERE v.id = ?
    `).get(input.contentVersionId) as Record<string, unknown> | undefined;
    if (!account || !version || version.account_id !== input.accountId) throw new BusinessError('NOT_FOUND', '账号或内容版本不存在', '读回对象后重试');
    const assetIds = input.assetVersionIds as string[];
    this.readAssets(assetIds);
    const id = randomUUID();
    const now = new Date().toISOString();
    const fingerprint = this.fingerprint(account, version, assetIds, String(input.platform), String(input.templateVersion));
    this.database.prepare('INSERT INTO package_candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, input.accountId, version.content_id, input.contentVersionId, input.platform, input.templateVersion,
      JSON.stringify(assetIds), fingerprint, 'draft', now, now
    );
    return this.getCandidate(id);
  }

  listCandidates(query: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT id FROM package_candidates WHERE platform LIKE ? ORDER BY updated_at DESC, id LIMIT ?
    `).all(`%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.getCandidate(row.id)), nextCursor: undefined };
  }

  requestApproval(id: string) {
    const candidate = this.getCandidate(id);
    const now = new Date().toISOString();
    this.database.prepare('INSERT OR REPLACE INTO approval_requests VALUES (?, ?, ?, ?)').run(id, candidate.currentFingerprint, 'pending', now);
    this.database.prepare("UPDATE package_candidates SET status = 'approval_pending', updated_at = ? WHERE id = ?").run(now, id);
    return this.getApproval(id);
  }

  approve(id: string) {
    const candidate = this.getCandidate(id);
    const request = this.database.prepare('SELECT fingerprint FROM approval_requests WHERE candidate_id = ?').get(id) as { fingerprint: string } | undefined;
    if (!request) throw new BusinessError('NOT_APPROVED', '尚未请求人工批准', '先请求批准', id);
    if (request.fingerprint !== candidate.currentFingerprint) throw new BusinessError('APPROVAL_INVALIDATED', '批准请求已因内容变化失效', '重新创建预览并请求批准', id);
    const now = new Date().toISOString();
    this.database.prepare('INSERT OR REPLACE INTO approvals VALUES (?, ?, ?, ?)').run(id, candidate.currentFingerprint, 'local-user', now);
    this.database.prepare("UPDATE approval_requests SET status = 'approved' WHERE candidate_id = ?").run(id);
    this.database.prepare("UPDATE package_candidates SET status = 'approved', updated_at = ? WHERE id = ?").run(now, id);
    return this.getApproval(id);
  }

  getApproval(id: string) {
    const candidate = this.getCandidate(id);
    const approval = this.database.prepare('SELECT * FROM approvals WHERE candidate_id = ?').get(id) as Record<string, unknown> | undefined;
    return {
      candidateId: id,
      status: approval && approval.fingerprint === candidate.currentFingerprint ? 'approved' : approval ? 'stale' : 'pending',
      fingerprint: approval?.fingerprint,
      currentFingerprint: candidate.currentFingerprint,
      approvedBy: approval?.approved_by,
      approvedAt: approval?.approved_at
    };
  }

  build(id: string) {
    const candidate = this.getCandidate(id);
    if (candidate.assets.some((asset) => asset.fileStatus !== 'present')) {
      throw new BusinessError('FILE_MODIFIED', '发布图片已被外部修改', '重新导入图片版本并重新批准', id);
    }
    const approval = this.getApproval(id);
    if (approval.status !== 'approved') throw new BusinessError('NOT_APPROVED', '发布包需要有效人工批准', '在界面重新批准', id);
    const packageId = randomUUID();
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', packageId);
    const target = path.join(this.rootPath, 'packages', packageId);
    fs.mkdirSync(temporary, { recursive: true });
    const files: { relativePath: string; absolutePath: string; byteSize: number; sha256: string }[] = [];
    const add = (relativePath: string, data: Buffer | string) => {
      const absolutePath = path.join(temporary, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, data);
      const bytes = fs.readFileSync(absolutePath);
      files.push({ relativePath, absolutePath: path.join(target, relativePath), byteSize: bytes.length, sha256: digest(bytes) });
    };
    const text = `${candidate.title}\n\n${candidate.body}\n\n${candidate.tags.join(' ')}`;
    add('正文.txt', text);
    candidate.assets.forEach((asset, index) => add(`图片/${String(index + 1).padStart(2, '0')}${path.extname(asset.filePath)}`, fs.readFileSync(asset.filePath)));
    if (candidate.platform === 'wechat') {
      const images = candidate.assets.map((asset, index) => `<img src="图片/${String(index + 1).padStart(2, '0')}${path.extname(asset.filePath)}" alt="插图 ${index + 1}">`).join('\n');
      add('公众号正文.html', `<h1>${escapeHtml(candidate.title)}</h1>\n<p>${escapeHtml(candidate.digest)}</p>\n${String(candidate.body).split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}\n${images}`);
    }
    const orderedImages = files.filter((file) => file.relativePath.startsWith('图片/'));
    const manifest = {
      packageId, candidateId: id, accountId: candidate.accountId, platform: candidate.platform,
      templateVersion: candidate.templateVersion, fingerprint: candidate.currentFingerprint,
      fields: {
        title: candidate.title, digest: candidate.digest, body: candidate.body, topics: candidate.tags,
        cover: files.find((file) => file.relativePath.startsWith('图片/'))?.relativePath,
        orderedImages,
        sources: candidate.sources, reviewStatus: approval.status
      },
      bodySha256: digest(String(candidate.body)), orderedImages, sources: candidate.sources,
      review: { status: approval.status, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, fingerprint: approval.fingerprint }
    };
    add('manifest.json', JSON.stringify(manifest, null, 2));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(temporary, target);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(packageId, id, candidate.accountId, candidate.platform, target, path.join(target, 'manifest.json'), 'completed', now);
      const insert = this.database.prepare('INSERT INTO package_files VALUES (?, ?, ?, ?, ?)');
      files.forEach((file) => insert.run(packageId, file.relativePath, file.absolutePath, file.byteSize, file.sha256));
    })();
    return this.getPackage(packageId);
  }

  buildBatch(ids: string[]) {
    const results = ids.map((candidateId) => {
      try {
        return { candidateId, ok: true as const, package: this.build(candidateId) };
      } catch (error) {
        return { candidateId, ok: false as const, error: error instanceof BusinessError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: String(error) } };
      }
    });
    return { status: results.every((result) => result.ok) ? 'completed' : results.some((result) => result.ok) ? 'partial' : 'failed', results };
  }

  getPackage(id: string) {
    const row = this.database.prepare('SELECT * FROM packages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '发布包不存在', '检查发布包标识', id);
    const files = this.database.prepare('SELECT * FROM package_files WHERE package_id = ? ORDER BY relative_path').all(id);
    return { id, candidateId: row.candidate_id, accountId: row.account_id, platform: row.platform, directoryPath: row.directory_path, manifestPath: row.manifest_path, status: row.status, files };
  }

  copyText(id: string) {
    const pack = this.getPackage(id);
    return { text: fs.readFileSync(path.join(String(pack.directoryPath), '正文.txt'), 'utf8') };
  }

  getCandidate(id: string) {
    const row = this.database.prepare('SELECT * FROM package_candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '发布候选不存在', '检查候选标识', id);
    const account = this.database.prepare('SELECT * FROM accounts WHERE id = ?').get(row.account_id) as Record<string, unknown>;
    const version = this.database.prepare(`
      SELECT v.*, p.title, p.version AS project_version FROM content_versions v
      JOIN content_projects p ON p.id = v.content_id WHERE v.id = ?
    `).get(row.content_version_id) as Record<string, unknown>;
    const assetIds = JSON.parse(String(row.asset_version_ids)) as string[];
    const assets = this.readAssets(assetIds);
    const sources = this.database.prepare(`
      SELECT s.id, s.title, COALESCE(s.canonical_url, s.file_path) AS url FROM content_source_refs r
      JOIN sources s ON s.id = r.source_id WHERE r.content_id = ? ORDER BY s.id
    `).all(row.content_id);
    return {
      id, accountId: row.account_id, contentId: row.content_id, contentVersionId: row.content_version_id,
      platform: row.platform, templateVersion: row.template_version, status: row.status,
      title: String(version.title), digest: String(version.body).replace(/\s+/g, ' ').slice(0, 120),
      body: String(version.body), tags: ['#英国生活'], assets, sources,
      storedFingerprint: row.fingerprint,
      currentFingerprint: this.fingerprint(account, version, assetIds, String(row.platform), String(row.template_version))
    };
  }

  private readAssets(ids: string[]) {
    return ids.map((id) => {
      const row = this.database.prepare('SELECT * FROM asset_versions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!row || !fs.existsSync(String(row.file_path))) throw new BusinessError('FILE_MISSING', '发布图片不存在', '恢复原图后重试', id);
      const bytes = fs.readFileSync(String(row.file_path));
      const actualSha256 = digest(bytes);
      return {
        id, filePath: String(row.file_path), byteSize: bytes.length, sha256: actualSha256,
        fileStatus: actualSha256 === row.sha256 && bytes.length === row.byte_size ? 'present' : 'modified'
      };
    });
  }

  private fingerprint(account: Record<string, unknown>, version: Record<string, unknown>, assetIds: string[], platform: string, template: string) {
    const assets = this.readAssets(assetIds);
    return digest(JSON.stringify({
      body: digest(String(version.body)),
      contentProjectVersion: version.project_version,
      images: assets.map((asset) => asset.sha256),
      account: digest(JSON.stringify(account)),
      platform,
      template
    }));
  }
}
