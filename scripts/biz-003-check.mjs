import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-003');
mkdirSync(receiptDirectory, { recursive: true });
const args = [resolve('node_modules', 'vitest', 'vitest.mjs'), 'run',
  'tests/customer-service.test.ts', 'tests/contracts.test.ts'];
const run = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
writeFileSync(resolve(receiptDirectory, 'test.log'), `${run.stdout}${run.stderr}`);
const result = {
  task: 'BIZ-003', status: run.status === 0 ? 'completed' : 'partial',
  commands: ['lead.create', 'lead.get', 'lead.list', 'lead.update', 'conversation.import',
    'conversation.confirm', 'conversation.list', 'deal.record', 'deal.list',
    'post_metrics.record', 'post_metrics.list'],
  businessFlow: ['新私信', '已了解需求', '已加微信', '洽谈中', '已成交/未成交'],
  files: ['conversations/<conversation-id>/<original-file>'],
  failureExperiments: ['unknown identity stays unlinked', 'missing original creates no database record'],
  exitCode: run.status
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (run.status !== 0) {
  process.stderr.write(`${run.stdout}${run.stderr}`);
  process.exit(run.status ?? 1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
