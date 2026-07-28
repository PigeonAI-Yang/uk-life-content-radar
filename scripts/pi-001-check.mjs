import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { createAgentSession, readStoredCredential } from '@earendil-works/pi-coding-agent';

const project = resolve(import.meta.dirname, '..');
const receiptPath = resolve(project, 'artifacts', 'task-receipts', 'PI-001', 'result.json');
const piAuthPath = resolve(process.env.USERPROFILE, '.pi', 'agent', 'auth.json');
const codexAuthPath = resolve(process.env.USERPROFILE, '.codex', 'auth.json');
const packageData = JSON.parse(readFileSync(resolve(project, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'), 'utf8'));

if (packageData.version !== '0.82.1') throw new Error(`Pi SDK 版本未锁定: ${packageData.version}`);
if (typeof createAgentSession !== 'function' || typeof readStoredCredential !== 'function') {
  throw new Error('Pi SDK 缺少嵌入应用所需导出');
}

const test = spawnSync(process.execPath, [resolve(project, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/agent-auth.test.ts'], {
  cwd: project,
  encoding: 'utf8',
  stdio: 'inherit'
});
if (test.status !== 0) throw new Error('Pi 认证失败实验未通过');

let codex = { exists: existsSync(codexAuthPath), authMode: null, tokenShapeDetected: false };
if (codex.exists) {
  try {
    const data = JSON.parse(readFileSync(codexAuthPath, 'utf8'));
    codex = {
      exists: true,
      authMode: typeof data.auth_mode === 'string' ? data.auth_mode : null,
      tokenShapeDetected: Boolean(
        data.tokens
        && typeof data.tokens.access_token === 'string'
        && typeof data.tokens.refresh_token === 'string'
        && typeof data.tokens.account_id === 'string'
      )
    };
  } catch {
    codex = { exists: true, authMode: null, tokenShapeDetected: false };
  }
}

const result = {
  task: 'PI-001',
  status: 'completed',
  sdk: {
    package: '@earendil-works/pi-coding-agent',
    version: packageData.version,
    nodeRequirement: packageData.engines?.node,
    embeddingExports: ['createAgentSession', 'readStoredCredential']
  },
  authScan: {
    piAuthFileDetected: existsSync(piAuthPath),
    piCredentialConfigured: Boolean(readStoredCredential('openai-codex', piAuthPath)),
    codex,
    note: '文件或凭据形状只表示候选存在，未描述为真实登录有效'
  },
  failureExperiment: {
    command: 'npm test -- --run tests/agent-auth.test.ts',
    noCredentialsError: 'AGENT_AUTH_REQUIRED',
    encryptedApiKeyPlaintextAbsent: true,
    passed: true
  },
  secretMaterialWrittenToReceipt: false
};

mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
