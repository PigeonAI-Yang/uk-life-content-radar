import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { EncryptedApiKeyStore, requireAgentAuth, scanAgentAuth } from '../src/agent/auth-service';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

function workspace() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'content-terminal-pi-auth-'));
  temporaryPaths.push(target);
  return target;
}

describe('Pi 认证探测', () => {
  test('没有凭据时返回可证伪的认证错误', () => {
    const target = workspace();
    const status = scanAgentAuth({
      piAuthPath: path.join(target, 'pi-auth.json'),
      codexAuthPath: path.join(target, 'codex-auth.json'),
      apiKeyConfigured: false
    });
    expect(status.selected).toBeNull();
    try {
      requireAgentAuth(status);
      throw new Error('预期认证失败');
    } catch (error) {
      expect(error).toMatchObject({ code: 'AGENT_AUTH_REQUIRED' });
    }
  });

  test('只检测 Codex 登录但不把文件存在描述为已验证', () => {
    const target = workspace();
    const codexAuthPath = path.join(target, 'codex-auth.json');
    fs.writeFileSync(codexAuthPath, JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: 'access', refresh_token: 'refresh', account_id: 'account' }
    }));
    const status = scanAgentAuth({
      piAuthPath: path.join(target, 'pi-auth.json'),
      codexAuthPath,
      apiKeyConfigured: false
    });
    expect(status.selected).toBe('codex_subscription');
    expect(status.candidates[1]).toMatchObject({ detected: true, validated: false });
  });

  test('API Key 只以加密结果落盘', () => {
    const target = workspace();
    const filePath = path.join(target, 'agent-api-key.json');
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
      decryptString: (value: Buffer) => value.toString().split('').reverse().join('')
    };
    const store = new EncryptedApiKeyStore(filePath, safeStorage);
    store.save('secret-api-key');
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('secret-api-key');
    expect(store.load()).toBe('secret-api-key');
  });
});
