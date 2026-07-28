import fs from 'node:fs';
import path from 'node:path';
import { readStoredCredential } from '@earendil-works/pi-coding-agent';
import { BusinessError } from '../contracts/errors';

export type AgentAuthCandidate = {
  source: 'pi_subscription' | 'codex_subscription' | 'api_key';
  detected: boolean;
  validated: boolean;
  message: string;
};

export type AgentAuthStatus = {
  runtime: 'pi';
  selected: AgentAuthCandidate['source'] | null;
  candidates: AgentAuthCandidate[];
};

type SafeStorage = {
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  isEncryptionAvailable(): boolean;
};

function detectPiSubscription(authPath: string): AgentAuthCandidate {
  try {
    const credential = readStoredCredential('openai-codex', authPath);
    return {
      source: 'pi_subscription',
      detected: Boolean(credential),
      validated: false,
      message: credential ? '检测到 Pi 的 ChatGPT Plus/Pro 登录，连接测试后才能确认有效' : '未检测到 Pi 订阅登录'
    };
  } catch {
    return {
      source: 'pi_subscription',
      detected: false,
      validated: false,
      message: 'Pi 登录文件无法读取，需要重新登录'
    };
  }
}

function detectCodexSubscription(authPath: string): AgentAuthCandidate {
  try {
    const data = JSON.parse(fs.readFileSync(authPath, 'utf8')) as {
      auth_mode?: unknown;
      tokens?: Record<string, unknown>;
    };
    const tokens = data.tokens;
    const detected = data.auth_mode === 'chatgpt'
      && typeof tokens?.access_token === 'string'
      && typeof tokens?.refresh_token === 'string'
      && typeof tokens?.account_id === 'string';
    return {
      source: 'codex_subscription',
      detected,
      validated: false,
      message: detected ? '检测到本机 Codex 订阅登录，需要授权 Pi 导入并验证' : '未检测到可导入的 Codex 订阅登录'
    };
  } catch {
    return {
      source: 'codex_subscription',
      detected: false,
      validated: false,
      message: fs.existsSync(authPath) ? 'Codex 登录文件无法读取，需要重新登录' : '未检测到 Codex 订阅登录'
    };
  }
}

export function scanAgentAuth(input: {
  piAuthPath: string;
  codexAuthPath: string;
  apiKeyConfigured: boolean;
}): AgentAuthStatus {
  const candidates = [
    detectPiSubscription(input.piAuthPath),
    detectCodexSubscription(input.codexAuthPath),
    {
      source: 'api_key' as const,
      detected: input.apiKeyConfigured,
      validated: false,
      message: input.apiKeyConfigured ? '检测到已加密的 API Key，连接测试后才能确认有效' : '未配置 API Key'
    }
  ];
  return {
    runtime: 'pi',
    selected: candidates.find((candidate) => candidate.detected)?.source ?? null,
    candidates
  };
}

export function requireAgentAuth(status: AgentAuthStatus): AgentAuthStatus {
  if (!status.selected) {
    throw new BusinessError('AGENT_AUTH_REQUIRED', 'Pi 尚未登录', '使用已有订阅登录、设备码登录或输入 API Key');
  }
  return status;
}

export class EncryptedApiKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorage
  ) {}

  isConfigured() {
    return fs.existsSync(this.filePath);
  }

  save(apiKey: string) {
    if (!apiKey.trim()) throw new BusinessError('INVALID_INPUT', 'API Key 不能为空', '输入有效的 API Key');
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new BusinessError('AGENT_AUTH_REQUIRED', 'Windows 凭据加密当前不可用', '登录 Windows 后重试');
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({
      version: 1,
      provider: 'openai',
      encryptedKey: this.safeStorage.encryptString(apiKey.trim()).toString('base64')
    }));
    fs.renameSync(temporaryPath, this.filePath);
  }

  load() {
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { encryptedKey?: unknown };
    if (typeof data.encryptedKey !== 'string') {
      throw new BusinessError('AGENT_AUTH_REQUIRED', '已保存的 API Key 无法读取', '重新输入 API Key');
    }
    return this.safeStorage.decryptString(Buffer.from(data.encryptedKey, 'base64'));
  }
}
