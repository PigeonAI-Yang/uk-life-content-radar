import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';

function sha256(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

function fileInfo(filePath: string) {
  if (!fs.existsSync(filePath)) throw new BusinessError('FILE_MISSING', '业务文件不存在', '恢复文件后重试', filePath);
  const data = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return { filePath: path.resolve(filePath), byteSize: stat.size, fileMtime: stat.mtime.toISOString(), sha256: sha256(data) };
}

export class CoreService {
  constructor(private readonly database: Database.Database, private readonly rootPath: string) {}

  createResource(input: Record<string, unknown>) {
    const id = randomUUID();
    const source = input.filePath ? fs.readFileSync(String(input.filePath)) : Buffer.from(String(input.body));
    const target = path.join(this.rootPath, 'sources', `${id}${input.filePath ? path.extname(String(input.filePath)) : '.md'}`);
    this.commitFile(id, source, target);
    const info = fileInfo(target);
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO sources (
        id, title, body, version, status, file_path, byte_size, sha256, file_mtime, created_at, updated_at,
        topic, region, target_audience, tags
      ) VALUES (?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.title, source.toString('utf8'), info.filePath, info.byteSize, info.sha256, info.fileMtime, now, now,
      input.topic ?? '', input.region ?? '', input.targetAudience ?? '', JSON.stringify(input.tags ?? []));
    this.database.prepare(`
      INSERT INTO source_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), id, input.title, source.toString('utf8'), info.filePath, info.byteSize, info.sha256, info.fileMtime, now);
    return this.getResource(id);
  }

  getResource(id: string) {
    const row = this.database.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '资料不存在', '检查资料标识', id);
    const actual = fileInfo(String(row.file_path));
    const fileStatus = actual.sha256 === row.sha256 && actual.byteSize === row.byte_size ? 'present' : 'modified';
    return { id, title: row.title, body: row.body, version: row.version, status: row.status, ...actual, fileStatus };
  }

  async importAsset(input: Record<string, unknown>) {
    const sourcePath = String(input.filePath);
    fileInfo(sourcePath);
    const id = randomUUID();
    const versionId = randomUUID();
    const target = path.join(this.rootPath, 'assets', 'original', `${id}${path.extname(sourcePath)}`);
    this.commitFile(id, fs.readFileSync(sourcePath), target);
    const info = fileInfo(target);
    if (process.resourcesPath) process.env.PATH = `${process.resourcesPath}${path.delimiter}${process.env.PATH ?? ''}`;
    const { default: sharp } = await import('sharp');
    const metadata = await sharp(target).metadata().catch(() => null);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare('INSERT INTO assets VALUES (?, ?, 1, ?, ?, ?)').run(id, path.basename(sourcePath), 'active', now, now);
      this.database.prepare(`
        INSERT INTO asset_versions
        (id, asset_id, version, file_path, byte_size, sha256, file_mtime, created_at, operation, parent_version_id, width, height)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'import', NULL, ?, ?)
      `).run(versionId, id, info.filePath, info.byteSize, info.sha256, info.fileMtime, now, metadata?.width ?? null, metadata?.height ?? null);
    })();
    return this.getAsset(id);
  }

  getAsset(id: string) {
    const row = this.database.prepare(`
      SELECT a.*, v.id AS version_id, v.file_path, v.byte_size, v.sha256, v.file_mtime
      FROM assets a JOIN asset_versions v ON v.asset_id = a.id WHERE a.id = ? ORDER BY v.version DESC LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new BusinessError('NOT_FOUND', '素材不存在', '检查素材标识', id);
    const actual = fileInfo(String(row.file_path));
    return { id, name: row.name, version: row.version, versionId: row.version_id, status: row.status, ...actual,
      fileStatus: actual.sha256 === row.sha256 && actual.byteSize === row.byte_size ? 'present' : 'modified' };
  }

  createContent(input: Record<string, unknown>) {
    const account = this.database.prepare('SELECT id FROM accounts WHERE id = ?').get(input.accountId);
    if (!account) throw new BusinessError('NOT_FOUND', '账号不存在', '先创建账号', String(input.accountId));
    const id = randomUUID();
    const versionId = randomUUID();
    const now = new Date().toISOString();
    const file = this.writeContentVersion(id, versionId, '');
    this.database.transaction(() => {
      this.database.prepare('INSERT INTO content_projects VALUES (?, ?, ?, 1, ?, ?, ?)').run(id, input.accountId, input.title, 'active', now, now);
      this.database.prepare(`
        INSERT INTO content_versions
        (id, content_id, version, platform, parent_id, body, sha256, created_at, outline, verification_state, edit_state, file_path, byte_size, file_sha256, file_mtime)
        VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, '', '[]', 'generated', ?, ?, ?, ?)
      `).run(versionId, id, '', sha256(''), now, file.filePath, file.byteSize, file.sha256, file.fileMtime);
    })();
    return this.getContent(id);
  }

  getContent(id: string) {
    const project = this.database.prepare('SELECT * FROM content_projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!project) throw new BusinessError('NOT_FOUND', '内容不存在', '检查内容标识', id);
    const versions = this.database.prepare(`
      SELECT id, version, platform, parent_id AS parentId, body, sha256, outline,
        verification_state AS verificationState, edit_state AS editState,
        file_path AS filePath, byte_size AS byteSize, file_sha256 AS fileSha256, file_mtime AS fileMtime
      FROM content_versions WHERE content_id = ? ORDER BY version, platform
    `).all(id).map((version) => {
      const item = version as Record<string, unknown>;
      if (!item.filePath) return item;
      const actual = fileInfo(String(item.filePath));
      return { ...item, actualFileSha256: actual.sha256, fileStatus: actual.sha256 === item.fileSha256 ? 'present' : 'modified' };
    });
    const resources = this.database.prepare('SELECT source_id FROM content_source_refs WHERE content_id = ?').all(id);
    const assets = this.database.prepare(`
      SELECT r.asset_version_id, v.asset_id, r.image_order
      FROM content_asset_refs r JOIN asset_versions v ON v.id = r.asset_version_id
      WHERE r.content_id = ? ORDER BY r.image_order
    `).all(id);
    const excerpts = this.database.prepare('SELECT excerpt_id FROM content_excerpt_refs WHERE content_id = ?').all(id);
    const notes = this.database.prepare('SELECT note_id FROM content_note_refs WHERE content_id = ?').all(id);
    return { id, accountId: project.account_id, title: project.title, version: Number(project.version), status: project.status, versions, resources, excerpts, notes, assets };
  }

  saveVersion(input: Record<string, unknown>) {
    const content = this.getContent(String(input.contentId));
    if (content.version !== Number(input.expectedVersion)) throw new BusinessError('VERSION_CONFLICT', '内容版本已变化', '读回后重试', content.id);
    const now = new Date().toISOString();
    const id = randomUUID();
    const nextVersion = content.version + 1;
    const platform = input.platform ? String(input.platform) : null;
    const file = this.writeContentVersion(content.id, id, String(input.body), platform ?? 'common');
    this.database.transaction(() => {
      this.database.prepare('UPDATE content_projects SET version = version + 1, updated_at = ? WHERE id = ?').run(now, content.id);
      this.database.prepare(`
        INSERT INTO content_versions
        (id, content_id, version, platform, parent_id, body, sha256, created_at, outline, verification_state, edit_state, file_path, byte_size, file_sha256, file_mtime)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
      `).run(id, content.id, nextVersion, platform, input.body, sha256(String(input.body)), now, input.outline,
        JSON.stringify(input.verificationItems), file.filePath, file.byteSize, file.sha256, file.fileMtime);
    })();
    return this.getContent(content.id);
  }

  generatePlatformVersion(input: Record<string, unknown>) {
    const content = this.getContent(String(input.contentId));
    const common = [...content.versions].reverse().find((item) => !(item as { platform: unknown }).platform) as { id: string; body: string } | undefined;
    const existing = content.versions.find((item) =>
      (item as { platform: unknown; version: number }).platform === input.platform &&
      (item as { version: number }).version === content.version);
    if (existing) return { ...content, generation: 'preserved_manual_version' };
    const id = randomUUID();
    const body = common?.body ?? '';
    const now = new Date().toISOString();
    const file = this.writeContentVersion(content.id, id, body, String(input.platform));
    this.database.prepare(`
      INSERT INTO content_versions
      (id, content_id, version, platform, parent_id, body, sha256, created_at, outline, verification_state, edit_state, file_path, byte_size, file_sha256, file_mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '[]', 'generated', ?, ?, ?, ?)
    `).run(
      id, content.id, content.version, input.platform, common?.id ?? null, body, sha256(body), now,
      file.filePath, file.byteSize, file.sha256, file.fileMtime
    );
    return this.getContent(content.id);
  }

  history(contentId: string) {
    return this.getContent(contentId);
  }

  createFromVersion(input: Record<string, unknown>) {
    const version = this.database.prepare(`
      SELECT v.*, p.title FROM content_versions v JOIN content_projects p ON p.id=v.content_id WHERE v.id=?
    `).get(input.versionId) as Record<string, unknown> | undefined;
    if (!version) throw new BusinessError('NOT_FOUND', '历史版本不存在', '检查版本标识', String(input.versionId));
    const created = this.createContent({ accountId: input.accountId, title: `${version.title}（来自历史）` });
    return this.saveVersion({
      contentId: created.id, expectedVersion: 1, body: version.body, outline: version.outline ?? '',
      verificationItems: JSON.parse(String(version.verification_state ?? '[]'))
    });
  }

  linkResource(contentId: string, resourceId: string, remove = false) {
    this.getContent(contentId);
    this.getResource(resourceId);
    if (remove) this.database.prepare('DELETE FROM content_source_refs WHERE content_id = ? AND source_id = ?').run(contentId, resourceId);
    else this.database.prepare('INSERT OR IGNORE INTO content_source_refs VALUES (?, ?)').run(contentId, resourceId);
    return this.getContent(contentId);
  }

  linkAsset(contentId: string, versionId: string, order: number, remove = false) {
    this.getContent(contentId);
    const asset = this.database.prepare('SELECT asset_id FROM asset_versions WHERE id = ?').get(versionId);
    if (!asset) throw new BusinessError('NOT_FOUND', '素材版本不存在', '检查素材版本标识', versionId);
    if (remove) this.database.prepare('DELETE FROM content_asset_refs WHERE content_id = ? AND asset_version_id = ?').run(contentId, versionId);
    else this.database.prepare('INSERT OR REPLACE INTO content_asset_refs VALUES (?, ?, ?)').run(contentId, versionId, order);
    return this.getContent(contentId);
  }

  private commitFile(id: string, data: Buffer, target: string) {
    const temporary = path.join(this.rootPath, '.content-terminal', 'tmp', `${id}.tmp`);
    try {
      fs.mkdirSync(path.dirname(temporary), { recursive: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temporary, data, { flag: 'wx' });
      fs.renameSync(temporary, target);
    } catch (error) {
      throw new BusinessError('FILE_UNWRITABLE', error instanceof Error ? error.message : String(error), '检查业务根目录写权限');
    }
  }

  private writeContentVersion(contentId: string, versionId: string, body: string, platform = 'common') {
    const target = path.join(this.rootPath, 'contents', contentId, `${versionId}-${platform}.md`);
    this.commitFile(versionId, Buffer.from(body), target);
    return fileInfo(target);
  }
}
