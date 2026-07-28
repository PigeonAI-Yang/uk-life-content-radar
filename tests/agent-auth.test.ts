import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readStoredCredential } from '@earendil-works/pi-coding-agent';
import { CustomApiConfigStore, EncryptedApiKeyStore, importCodexSubscription, requireAgentAuth, scanAgentAuth } from '../src/agent/auth-service';

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

  test('Codex 订阅转换为 Pi 凭据且不返回令牌', async () => {
    const target = workspace();
    const codexAuthPath = path.join(target, 'codex-auth.json');
    const piAuthPath = path.join(target, 'pi', 'auth.json');
    const payload = Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url');
    fs.writeFileSync(codexAuthPath, JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: `header.${payload}.signature`, refresh_token: 'refresh', account_id: 'account' }
    }));
    expect(await importCodexSubscription(codexAuthPath, piAuthPath)).toBeUndefined();
    expect(readStoredCredential('openai-codex', piAuthPath)).toMatchObject({
      type: 'oauth', accountId: 'account', expires: 4_102_444_800_000
    });
  });

  test('自定义 API 只保存地址、协议和模型，不保存密钥', () => {
    const target = workspace();
    const filePath = path.join(target, 'agent-api.json');
    const store = new CustomApiConfigStore(filePath);
    expect(store.save({ baseUrl: 'http://127.0.0.1:61946/v1/', model: 'gpt-5.6-sol' }))
      .toEqual({ baseUrl: 'http://127.0.0.1:61946/v1', model: 'gpt-5.6-sol', protocol: 'openai-responses' });
    expect(fs.readFileSync(filePath, 'utf8')).not.toMatch(/key|token|secret/i);
    expect(() => store.save({ baseUrl: 'file:///not-an-api', model: 'model' }))
      .toThrow('自定义 API 地址或模型无效');
  });
});
