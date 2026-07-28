import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const receiptDirectory = resolve('artifacts', 'task-receipts', 'BIZ-007');
mkdirSync(receiptDirectory, { recursive: true });
const source = resolve('skills', 'content-business-partner');
const installed = resolve(process.env.USERPROFILE, '.codex', 'skills', 'content-business-partner');
const validator = resolve(process.env.USERPROFILE, '.codex', 'skills', '.system', 'skill-creator', 'scripts', 'quick_validate.py');
const validation = spawnSync('python', [validator, source], { encoding: 'utf8', shell: false });
const files = ['SKILL.md', 'agents/openai.yaml', 'references/terminal-command-map.md'];
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const mismatches = files.filter((file) => sha256(resolve(source, file)) !== sha256(resolve(installed, file)));
const body = readFileSync(resolve(source, 'SKILL.md'), 'utf8');
const assertions = {
  startsWithSnapshot: body.includes('business.snapshot'),
  terminalUnavailableStopsSavedClaim: body.includes('终端未连接，本次结果尚未保存'),
  conversationIsNotMemory: body.includes('聊天上下文不是正式记忆'),
  strategyApprovalIsHumanOnly: body.includes('只有用户在终端界面批准后才是正式策略'),
  publishingApprovalIsHumanOnly: body.includes('不得替用户做最终发布批准'),
  asksMinimumQuestions: body.includes('只向用户索取会改变决定的最少信息')
};
const ok = validation.status === 0 && !mismatches.length && Object.values(assertions).every(Boolean);
const result = {
  task: 'BIZ-007', status: ok ? 'completed' : 'partial',
  source, installed, validation: `${validation.stdout}${validation.stderr}`.trim(),
  installedFiles: files, mismatches, assertions,
  failureExperiment: 'terminal unavailable wording forbids claiming saved terminal state'
};
writeFileSync(resolve(receiptDirectory, 'result.json'), JSON.stringify(result, null, 2));
if (!ok) {
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
