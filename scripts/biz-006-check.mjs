import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-006');
mkdirSync(receiptDirectory, { recursive: true });
const args = [resolve('node_modules', 'vitest', 'vitest.mjs'), 'run',
  'tests/intelligence-service.test.ts', 'tests/business-schema.test.ts', 'tests/contracts.test.ts'];
const run = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
writeFileSync(resolve(receiptDirectory, 'test.log'), `${run.stdout}${run.stderr}`);
const result = {
  task: 'BIZ-006', status: run.status === 0 ? 'completed' : 'partial',
  commands: ['intelligence.record_scan', 'intelligence.get', 'intelligence.list',
    'intelligence.scan_status', 'intelligence.promote_resource', 'intelligence.promote_content'],
  databaseObjects: ['tasks', 'intelligence_scan_sources', 'intelligence_candidates'],
  failureExperiments: ['one failed source keeps scan partial', 'old discoveredAt is preserved', 'latest scan exposes failed source and last success'],
  exitCode: run.status
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (run.status !== 0) {
  process.stderr.write(`${run.stdout}${run.stderr}`);
  process.exit(run.status ?? 1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
