import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const project = resolve(import.meta.dirname, '..');
const directory = resolve(project, 'artifacts', 'task-receipts', 'PI-004');
const api = JSON.parse(readFileSync(resolve(directory, 'custom-api-result.json'), 'utf8'));
const install = JSON.parse(readFileSync(resolve(directory, 'install-result.json'), 'utf8'));
if (api.status !== 'completed' || install.status !== 'completed') throw new Error('PI-004 子验收未完成');
if (!api.checks.realCustomApi || !api.checks.realMcpToolCall || !install.checks.uninstallPreservesBusinessData) {
  throw new Error('PI-004 关键证据缺失');
}
if (!existsSync(api.screenshot) || !existsSync(install.businessRoot)) throw new Error('PI-004 磁盘证据缺失');
const result = {
  task: 'PI-004', status: 'completed',
  runtime: api.runtime, api: api.api, modelConnection: api.connection,
  agentTaskId: api.agentTask.id, agentToolCalls: api.agentResult.toolCalls,
  installer: install.installer, installedExecutable: install.installedExecutable,
  businessRootAfterUninstall: install.businessRoot,
  checks: { ...api.checks, ...install.checks }
};
writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
