import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-004');
mkdirSync(receiptDirectory, { recursive: true });
const args = [resolve('node_modules', 'vitest', 'vitest.mjs'), 'run',
  'tests/business-workspace.test.ts', 'tests/customer-service.test.ts', 'tests/routes.test.ts'];
const run = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
writeFileSync(resolve(receiptDirectory, 'test.log'), `${run.stdout}${run.stderr}`);
const result = {
  task: 'BIZ-004', status: run.status === 0 ? 'completed' : 'partial',
  uiEntry: '经营',
  sections: ['当前生意', '产品与服务', '经营建议', '客户与成交', '今天要跟进'],
  relationships: ['客户→来源帖子', '客户→产品', '客户→沟通原件', '客户→成交'],
  failureExperiment: 'external deletion is read back as missing and UI explains re-import',
  exitCode: run.status
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (run.status !== 0) {
  process.stderr.write(`${run.stdout}${run.stderr}`);
  process.exit(run.status ?? 1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
