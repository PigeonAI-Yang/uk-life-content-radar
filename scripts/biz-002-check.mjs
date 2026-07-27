import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-002');
mkdirSync(receiptDirectory, { recursive: true });
const args = [resolve('node_modules', 'vitest', 'vitest.mjs'), 'run',
  'tests/business-management.test.ts', 'tests/contracts.test.ts', 'tests/routes.test.ts'];
const run = spawnSync(process.execPath, args, { encoding: 'utf8', shell: false });
writeFileSync(resolve(receiptDirectory, 'test.log'), `${run.stdout}${run.stderr}`);
const result = {
  task: 'BIZ-002',
  status: run.status === 0 ? 'completed' : 'partial',
  command: `node ${args.join(' ')}`,
  uiEntry: '经营',
  commands: ['product.create', 'product.get', 'product.update', 'product.list',
    'strategy.propose', 'strategy.get', 'strategy.list', 'strategy.approve'],
  databaseObjects: ['products', 'product_versions', 'strategy_proposals', 'strategy_versions'],
  files: ['business/products/<product-id>/<version>.json',
    'business/strategies/<account-id>/<version>-<strategy-id>.json'],
  mcpRule: 'strategy.approve is human-only; other product and strategy tools share the dispatcher',
  failureExperiments: [
    'pending proposal creates no formal strategy version',
    'stale product version is rejected without overwriting the current file'
  ],
  exitCode: run.status
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (run.status !== 0) {
  process.stderr.write(`${run.stdout}${run.stderr}`);
  process.exit(run.status ?? 1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
