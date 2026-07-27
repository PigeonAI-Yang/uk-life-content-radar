import Database from 'better-sqlite3/win32-x64';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const [databasePath, rootPath] = process.argv.slice(2);
if (!databasePath || !rootPath) throw new Error('需要数据库路径和业务根目录');
const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('synchronous = OFF');
const now = '2026-07-27T00:00:00.000Z';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceRoot = path.join(rootPath, 'sources', 'scale');
const assetRoot = path.join(rootPath, 'assets', 'original', 'scale');
const packageRoot = path.join(rootPath, 'packages', 'scale');
fs.mkdirSync(sourceRoot, { recursive: true });
fs.mkdirSync(assetRoot, { recursive: true });
fs.mkdirSync(packageRoot, { recursive: true });

const insertAccount = database.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)');
const insertSource = database.prepare('INSERT INTO sources VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertSourceVersion = database.prepare('INSERT INTO source_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)');
const insertAsset = database.prepare('INSERT INTO assets VALUES (?, ?, 1, ?, ?, ?)');
const insertAssetVersion = database.prepare('INSERT INTO asset_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertContent = database.prepare('INSERT INTO content_projects VALUES (?, ?, ?, 1, ?, ?, ?)');
const insertVersion = database.prepare('INSERT INTO content_versions VALUES (?, ?, 1, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertCandidate = database.prepare('INSERT INTO package_candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertPackage = database.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertPackageFile = database.prepare('INSERT INTO package_files VALUES (?, ?, ?, ?, ?)');

database.transaction(() => {
  for (let index = 0; index < 20; index += 1) {
    const id = `scale-account-${String(index).padStart(2, '0')}`;
    insertAccount.run(id, `规模账号 ${index}`, '英国生活规模检索', index === 19 ? '归档人群哨兵' : '在英华人', '可靠',
      '[]', JSON.stringify({ xiaohongshu: id, douyin: id, wechat: id }), JSON.stringify({ xiaohongshu: 'v1' }),
      index === 19 ? 'archived' : 'active', now, now);
  }
})();

const sourceBatch = database.transaction((start, end) => {
  for (let index = start; index < end; index += 1) {
    const id = `scale-source-${String(index).padStart(6, '0')}`;
    const archived = index === 99_999;
    const paging = index < 250 ? ' 分页哨兵' : '';
    const semantic = index === 54_321 ? ' 租房保证金退回办法和押金返还流程' : '';
    const body = `规模资料 ${index} 英国生活长期资料${paging}${semantic}`;
    const directory = path.join(sourceRoot, String(Math.floor(index / 1000)).padStart(3, '0'));
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${String(index).padStart(6, '0')}.md`);
    fs.writeFileSync(filePath, body);
    const bytes = Buffer.from(body);
    const title = index === 54_321 ? '旧资料：租房押金处理' : `规模资料 ${index}`;
    insertSource.run(id, title, body, archived ? 'archived' : 'active', filePath, bytes.length, digest(bytes), now,
      now, now, `https://example.invalid/source/${index}`, index === 98_765 ? '地区哨兵' : '英国生活',
      index === 98_765 ? '北爱尔兰' : '英国', index === 98_765 ? '新移民哨兵' : '在英华人',
      JSON.stringify(index === 98_765 ? ['唯一标签哨兵'] : ['规模']));
    insertSourceVersion.run(`${id}-v1`, id, title, body, filePath, bytes.length, digest(bytes), now, now);
  }
});
for (let start = 0; start < 100_000; start += 1000) sourceBatch(start, start + 1000);

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360f8cf00000301010018dd8db10000000049454e44ae426082', 'hex');
const pngSha = digest(png);
const assetBatch = database.transaction((start, end) => {
  for (let index = start; index < end; index += 1) {
    const id = `scale-asset-${String(index).padStart(5, '0')}`;
    const directory = path.join(assetRoot, String(Math.floor(index / 1000)).padStart(2, '0'));
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${String(index).padStart(5, '0')}.png`);
    fs.writeFileSync(filePath, png);
    insertAsset.run(id, index === 12_345 ? '已用素材唯一哨兵' : `规模素材 ${index}`, 'active', now, now);
    insertAssetVersion.run(`${id}-v1`, id, filePath, png.length, pngSha, now, now, 'import', null, 1, 1);
  }
});
for (let start = 0; start < 30_000; start += 1000) assetBatch(start, start + 1000);

database.transaction(() => {
  for (let index = 0; index < 5000; index += 1) {
    const id = `scale-content-${String(index).padStart(4, '0')}`;
    const versionId = `${id}-v1`;
    const accountId = `scale-account-${String(index % 20).padStart(2, '0')}`;
    const body = index === 4321 ? '历史文案唯一哨兵 英国账单旧版本' : `规模历史文案 ${index}`;
    insertContent.run(id, accountId, `规模内容 ${index}`, 'active', now, now);
    insertVersion.run(versionId, id, index % 3 === 0 ? 'xiaohongshu' : index % 3 === 1 ? 'douyin' : 'wechat',
      body, digest(body), now, '', '[]', 'saved', null, null, null, null);
  }
})();

database.transaction(() => {
  for (let index = 0; index < 1000; index += 1) {
    const packageId = `scale-package-${String(index).padStart(4, '0')}`;
    const candidateId = `scale-candidate-${String(index).padStart(4, '0')}`;
    const contentId = `scale-content-${String(index).padStart(4, '0')}`;
    const versionId = `${contentId}-v1`;
    const accountId = `scale-account-${String(index % 20).padStart(2, '0')}`;
    const platform = index % 3 === 0 ? 'xiaohongshu' : index % 3 === 1 ? 'douyin' : 'wechat';
    const directory = path.join(packageRoot, String(index).padStart(4, '0'));
    fs.mkdirSync(directory, { recursive: true });
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.stringify({ packageId, platform, title: `规模内容 ${index}` });
    fs.writeFileSync(manifestPath, manifest);
    insertCandidate.run(candidateId, accountId, contentId, versionId, platform, `${platform}-v1`, '[]', digest(manifest), 'approved', now, now);
    insertPackage.run(packageId, candidateId, accountId, platform, directory, manifestPath, 'completed', now);
    insertPackageFile.run(packageId, 'manifest.json', manifestPath, Buffer.byteLength(manifest), digest(manifest));
  }
})();

database.pragma('optimize');
const counts = {
  resources: database.prepare('SELECT count(*) count FROM sources').get().count,
  assetVersions: database.prepare('SELECT count(*) count FROM asset_versions').get().count,
  contents: database.prepare('SELECT count(*) count FROM content_projects').get().count,
  packages: database.prepare('SELECT count(*) count FROM packages').get().count,
  accounts: database.prepare('SELECT count(*) count FROM accounts').get().count,
  searchable: database.prepare('SELECT count(*) count FROM search_fts').get().count
};
database.close();
process.stdout.write(`${JSON.stringify(counts)}\n`);
