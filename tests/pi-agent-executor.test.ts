import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { PiAgentExecutor } from '../src/agent/pi-agent-executor';

describe('Pi MCP 连接失败', () => {
  test('MCP helper 不存在时返回明确错误而不是认证错误', async () => {
    const executor = new PiAgentExecutor({
      cwd: process.cwd(),
      agentDir: path.resolve('artifacts', 'task-receipts', 'PI-002', 'missing-agent-dir'),
      executablePath: process.execPath,
      helperPath: path.resolve('missing-mcp-helper.cjs'),
      discoveryPath: path.resolve('missing-discovery.json'),
      skillPath: path.resolve('skills', 'content-business-partner', 'SKILL.md')
    });
    await expect(executor.execute({
      taskId: 'missing-mcp',
      accountId: 'account',
      goal: '读取经营快照',
      triggerEvent: 'test',
      signal: new AbortController().signal,
      onEvent: () => undefined
    })).rejects.toMatchObject({ code: 'AGENT_MCP_UNAVAILABLE' });
  });
});
