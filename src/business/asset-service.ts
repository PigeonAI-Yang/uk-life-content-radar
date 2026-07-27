import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BusinessError } from '../contracts/errors';

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const xml = (value: string) => value.replace(/[<>&"']/g, (character) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);

export class AssetService {
  constructor(private readonly database: Database.Database, private readonly rootPath: string) {
    this.database.prepare(`
      UPDATE asset_operations SET status='interrupted',
        error_json='{"code":"TASK_INTERRUPTED","message":"图片处理被应用退出中断"}',
        updated_at=? WHERE status='running'
    `).run(new Date().toISOString());
  }

  get(id: string) {
    const asset = this.database.prepare('SELECT * FROM assets WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!asset) throw new BusinessError('NOT_FOUND', '素材不存在', '检查素材标识', id);
    const rows = this.database.prepare('SELECT * FROM asset_versions WHERE asset_id=? ORDER BY version').all(id) as Record<string, unknown>[];
    const versions = rows.map((row) => this.readVersion(row));
    const latest = versions.at(-1)!;
    const usage = this.database.prepare(`
      SELECT r.content_id, r.image_order FROM content_asset_refs r
      JOIN asset_versions v ON v.id=r.asset_version_id WHERE v.asset_id=? ORDER BY r.content_id, r.image_order
    `).all(id);
    const operations = this.database.prepare('SELECT * FROM asset_operations WHERE asset_id=? ORDER BY created_at DESC, id').all(id);
    return {
      ...latest, id, name: asset.name, version: Number(asset.version), status: asset.status,
      versionId: latest.id, latestVersionNumber: latest.version, versions, usage, operations
    };
  }

  search(query: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT id FROM assets WHERE name LIKE ? AND status <> 'archived' ORDER BY updated_at DESC, id LIMIT ?
    `).all(`%${query}%`, limit) as { id: string }[];
    return { items: rows.map((row) => this.get(row.id)), nextCursor: null };
  }

  setStatus(id: string, expectedVersion: number, status: 'active' | 'archived') {
    const current = this.get(id);
    if (current.version !== expectedVersion) throw new BusinessError('VERSION_CONFLICT', '素材版本已变化', '读回后重试', id);
    this.database.prepare('UPDATE assets SET status=?, version=version+1, updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
    return this.get(id);
  }

  importExternal(input: Record<string, unknown>) {
    const source = String(input.filePath);
    if (!fs.existsSync(source)) throw new BusinessError('FILE_MISSING', '外部图片不存在', '恢复文件后重试', source);
    return this.addVersion(String(input.assetId), String(input.versionId ?? this.get(String(input.assetId)).versionId),
      'external', input, async (target) => fs.copyFileSync(source, target), path.extname(source));
  }

  crop(input: Record<string, unknown>) {
    return this.process(input, 'crop', (pipeline) => pipeline.extract({
      left: Number(input.left), top: Number(input.top), width: Number(input.width), height: Number(input.height)
    }));
  }

  resize(input: Record<string, unknown>) {
    return this.process(input, 'resize', (pipeline) => pipeline.resize(Number(input.width), Number(input.height)));
  }

  compress(input: Record<string, unknown>) {
    return this.process(input, 'compress', (pipeline) => pipeline.jpeg({ quality: Number(input.quality) }), '.jpg');
  }

  convert(input: Record<string, unknown>) {
    const template = String(input.templateVersion);
    const size = template.startsWith('wechat') ? [900, 383] : [1080, 1440];
    return this.process(input, 'platform', (pipeline) =>
      pipeline.resize(size[0], size[1], { fit: 'contain', background: '#ffffff' }));
  }

  overlay(input: Record<string, unknown>) {
    return this.addVersion(String(input.assetId), String(input.versionId), 'overlay', input, async (target, source) => {
      const { default: sharp } = await this.loadSharp();
      const metadata = await sharp(source).metadata();
      const text = Buffer.from(
        `<svg width="${metadata.width}" height="${metadata.height}"><text x="${Number(input.x)}" y="${Number(input.y)}" font-family="${xml(String(input.font))}" font-size="${Number(input.size)}" fill="${xml(String(input.color))}">${xml(String(input.text))}</text></svg>`
      );
      await sharp(source).composite([{ input: text }]).toFile(target);
    });
  }

  private async process(input: Record<string, unknown>, operation: string, transform: (pipeline: import('sharp').Sharp) => import('sharp').Sharp, extension?: string) {
    const width = Number(input.width ?? 0);
    const height = Number(input.height ?? 0);
    if (width && height) {
      const free = fs.statfsSync(this.rootPath).bavail * fs.statfsSync(this.rootPath).bsize;
      if (width * height * 4 > free) {
        this.database.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('storageAlert', ?)").run(JSON.stringify({
          code: 'DISK_FULL', message: '目标图片所需空间超过磁盘剩余容量',
          requiredBytes: width * height * 4, freeBytes: free, updatedAt: new Date().toISOString()
        }));
        throw new BusinessError('DISK_FULL', '目标图片所需空间超过磁盘剩余容量', '减小尺寸或释放业务盘空间');
      }
    }
    const { default: sharp } = await this.loadSharp();
    return this.addVersion(String(input.assetId), String(input.versionId), operation, input, async (target, source) => {
      await transform(sharp(source)).toFile(target);
    }, extension);
  }

  private async addVersion(assetId: string, sourceVersionId: string, operation: string, parameters: Record<string, unknown>,
    writer: (target: string, source: string) => void | Promise<void>, extension?: string) {
    const current = this.get(assetId);
    const source = current.versions.find((version) => version.id === sourceVersionId);
    if (!source) throw new BusinessError('NOT_FOUND', '素材版本不存在', '检查素材版本标识', sourceVersionId);
    if (source.fileStatus === 'missing') throw new BusinessError('FILE_MISSING', '素材版本文件不存在', '恢复文件后重试', sourceVersionId);
    if (operation !== 'external' && source.fileStatus === 'modified') throw new BusinessError('FILE_MODIFIED', '素材版本已被外部修改', '导入为新版本后再处理', sourceVersionId);
    const operationId = randomUUID();
    const versionId = randomUUID();
    const next = Math.max(...current.versions.map((version) => Number(version.version))) + 1;
    const target = path.join(this.rootPath, operation === 'external' ? 'assets/original' : 'assets/derived', assetId,
      `${String(next).padStart(4, '0')}-${operation}${extension ?? path.extname(source.filePath)}`);
    const now = new Date().toISOString();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.database.prepare(`
      INSERT INTO asset_operations VALUES (?, ?, ?, NULL, ?, ?, 'running', NULL, ?, ?)
    `).run(operationId, assetId, sourceVersionId, operation, JSON.stringify(parameters), now, now);
    try {
      await writer(target, source.filePath);
      const bytes = fs.readFileSync(target);
      const stat = fs.statSync(target);
      const { default: sharp } = await this.loadSharp();
      const metadata = await sharp(target).metadata();
      this.database.transaction(() => {
        this.database.prepare(`
          INSERT INTO asset_versions
          (id, asset_id, version, file_path, byte_size, sha256, file_mtime, created_at, operation, parent_version_id, width, height)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(versionId, assetId, next, path.resolve(target), bytes.length, digest(bytes), stat.mtime.toISOString(), now,
          operation, sourceVersionId, metadata.width ?? null, metadata.height ?? null);
        this.database.prepare('UPDATE assets SET version=version+1, updated_at=? WHERE id=?').run(now, assetId);
        this.database.prepare("UPDATE asset_operations SET output_version_id=?, status='completed', updated_at=? WHERE id=?")
          .run(versionId, now, operationId);
      })();
      return this.get(assetId);
    } catch (error) {
      if (fs.existsSync(target)) fs.rmSync(target);
      const business = error instanceof BusinessError ? error : new BusinessError('FILE_UNWRITABLE',
        error instanceof Error ? error.message : String(error), '检查图片参数和业务盘状态');
      this.database.prepare("UPDATE asset_operations SET status='failed', error_json=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(business.toJSON()), new Date().toISOString(), operationId);
      throw business;
    }
  }

  private readVersion(row: Record<string, unknown>) {
    const filePath = String(row.file_path);
    if (!fs.existsSync(filePath)) return { id: row.id, version: row.version, filePath, byteSize: row.byte_size, sha256: row.sha256, fileMtime: row.file_mtime, operation: row.operation, width: row.width, height: row.height, fileStatus: 'missing' };
    const bytes = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const actualSha256 = digest(bytes);
    return {
      id: row.id, version: row.version, filePath: path.resolve(filePath), byteSize: stat.size, sha256: row.sha256,
      actualSha256, fileMtime: stat.mtime.toISOString(), operation: row.operation, parentVersionId: row.parent_version_id,
      width: row.width, height: row.height,
      fileStatus: actualSha256 === row.sha256 && stat.size === row.byte_size ? 'present' : 'modified'
    };
  }

  private async loadSharp() {
    if (process.resourcesPath) process.env.PATH = `${process.resourcesPath}${path.delimiter}${process.env.PATH ?? ''}`;
    return import('sharp');
  }
}
