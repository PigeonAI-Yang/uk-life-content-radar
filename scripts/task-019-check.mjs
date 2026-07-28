import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const receipts = resolve('artifacts', 'task-receipts');
const finalDirectory = resolve(receipts, 'TASK-019');
mkdirSync(finalDirectory, { recursive: true });
const read = (task) => JSON.parse(readFileSync(resolve(receipts, task, 'result.json'), 'utf8'));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const ledger = readFileSync(resolve('docs', 'tasks.md'), 'utf8');
const completed = (id) => new RegExp(`\\| ${id} \\|[^\\n]+completed（已完成）`).test(ledger);
const dependencyIds = [
  ...Array.from({ length: 19 }, (_, index) => `TASK-${String(index).padStart(3, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `UIR-00${index + 1}`),
  ...Array.from({ length: 8 }, (_, index) => `BIZ-00${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `PI-00${index + 1}`)
];

const task3 = read('TASK-003');
const task4 = read('TASK-004');
const task7 = read('TASK-007');
const task14 = read('TASK-014');
const task15 = read('TASK-015');
const task16 = read('TASK-016');
const task17 = read('TASK-017');
const task18 = read('TASK-018');
const biz8 = read('BIZ-008');
const environment = JSON.parse(readFileSync(resolve(finalDirectory, 'system-environment.json'), 'utf8'));
const packageFiles = task14.packages.flatMap((item) => item.files);
const diskFilesMatch = packageFiles.every((file) =>
  existsSync(file.absolute_path) &&
  readFileSync(file.absolute_path).length === file.byte_size &&
  sha256(file.absolute_path) === file.sha256
);
const humanPath = resolve(finalDirectory, 'human-approval.json');
const human = existsSync(humanPath) ? JSON.parse(readFileSync(humanPath, 'utf8')) : undefined;
const installerMatches = existsSync(task18.installer.path) && sha256(task18.installer.path) === task18.installer.sha256;

const checks = [
  { id: 1, name: '人工查看情报主链', passed: human?.confirmed === true && human.installerSha256 === task18.installer.sha256 },
  { id: 2, name: '真实 MCP 完整链', passed: task4.status === 'completed' && task4.toolCount > 0 && biz8.checks.newMcpSession },
  { id: 3, name: '双入口一致性', passed: task7.status === 'completed' && task7.comparedManifestKeys.length > 0 && biz8.checks.uiMcpSqliteFiles },
  { id: 4, name: '审批门禁与外部篡改', passed: task4.approvalToolExposed === false && task14.failures.missingFile.error.code === 'FILE_MISSING' },
  { id: 5, name: '真实情报到资料和内容', passed: biz8.status === 'completed' && biz8.checks.realSource && biz8.checks.partialFailure && biz8.checks.resourceAndContent && biz8.checks.piMcpHandoff },
  { id: 6, name: '任务中断取消部分成功重启', passed: task3.cancelled.status === 'cancelled' && task3.interrupted.status === 'interrupted' && task15.tasks.partial.status === 'partial' },
  { id: 7, name: '十万级全文和语义检索', passed: task16.seedCounts.searchable >= 100000 && task16.timingsMs.medianKeyword < 2000 && task16.timingsMs.medianSemantic < 5000 },
  { id: 8, name: '存储路径数量容量增长', passed: task15.scans.second.growthFiles > 0 && task15.scans.second.totalBytes > task15.scans.second.freeBytes },
  { id: 9, name: '九模块四档布局键盘缩放', passed: task17.routes.length === 9 && task17.layouts.length === 4 && task17.layouts.every((item) => item.overflow === 0) && task17.keyboard.reached && task17.accessibility.textZoom === 2 },
  { id: 10, name: '干净 Windows 11 安装后台调用重开卸载', passed: environment.systemImageCleanRoomVerified === true && installerMatches && task18.uninstall.applicationExecutableRemoved && task18.uninstall.businessRootExists && diskFilesMatch }
];
const incompleteDependencies = dependencyIds.filter((id) => !completed(id));
const result = {
  status: checks.every((item) => item.passed) && !incompleteDependencies.length ? 'completed' : 'blocked',
  incompleteDependencies, checks, humanApprovalPath: humanPath,
  installer: task18.installer, verifiedAt: new Date().toISOString()
};
writeFileSync(resolve(finalDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (result.status !== 'completed') {
  process.stderr.write(`TASK-019 blocked: ${checks.filter((item) => !item.passed).map((item) => item.name).join('、')}\n`);
  process.exitCode = 2;
}
