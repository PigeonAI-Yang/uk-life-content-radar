import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-001');
mkdirSync(receiptDirectory, { recursive: true });
const command = [
  process.execPath,
  [resolve('node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/business-schema.test.ts']
];
const run = spawnSync(command[0], command[1], { encoding: 'utf8', shell: false });
writeFileSync(resolve(receiptDirectory, 'test.log'), `${run.stdout}${run.stderr}`);
const result = {
  task: 'BIZ-001',
  status: run.status === 0 ? 'completed' : 'partial',
  command: `node ${command[1].join(' ')}`,
  migrationVersion: 15,
  databaseObjects: [
    'products', 'product_versions', 'strategy_proposals', 'strategy_versions',
    'leads', 'conversation_records', 'deals', 'post_metrics', 'intelligence_candidates', 'intelligence_scan_sources'
  ],
  businessDirectories: [
    'business/products', 'business/strategies', 'customers', 'conversations', 'intelligence'
  ],
  failureExperiment: 'invalid SQL inside transaction leaves no should_rollback table',
  exitCode: run.status
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (run.status !== 0) {
  process.stderr.write(`${run.error?.message ?? ''}${run.stdout ?? ''}${run.stderr ?? ''}`);
  process.exit(run.status ?? 1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
