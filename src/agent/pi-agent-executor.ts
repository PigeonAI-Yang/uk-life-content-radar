import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAgentSession, defineTool, ModelRuntime, type AgentSession } from '@earendil-works/pi-coding-agent';
import type { CustomApiConfig } from './auth-service';
import { Type } from 'typebox';
import { BusinessError } from '../contracts/errors';
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from './agent-executor';

type PiAgentOptions = {
  cwd: string;
  agentDir: string;
  executablePath: string;
  helperPath: string;
  discoveryPath: string;
  skillPath: string;
  customApiProvider?: () => (CustomApiConfig & { apiKey: string }) | undefined;
};

function assistantSummary(messages: unknown[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((item): item is { type: string; text: string } =>
        Boolean(item) && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        && typeof (item as { text?: unknown }).text === 'string')
      .map((item) => item.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return 'Pi 已完成任务，但没有返回文字摘要';
}

export class PiAgentExecutor implements AgentExecutor {
  constructor(private readonly options: PiAgentOptions) {}

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const client = new Client({ name: 'content-media-terminal-pi', version: '0.1.0' });
    let session: AgentSession | undefined;
    let toolCalls = 0;
    const previousApiKey = process.env.CONTENT_TERMINAL_CUSTOM_API_KEY;
    try {
      const customApi = this.options.customApiProvider?.();
      let modelRuntime: ModelRuntime | undefined;
      let model;
      if (customApi) {
        process.env.CONTENT_TERMINAL_CUSTOM_API_KEY = customApi.apiKey;
        fs.mkdirSync(this.options.agentDir, { recursive: true });
        const modelsPath = path.join(this.options.agentDir, 'models.json');
        fs.writeFileSync(modelsPath, JSON.stringify({
          providers: {
            'custom-api': {
              baseUrl: customApi.baseUrl,
              api: customApi.protocol,
              apiKey: '$CONTENT_TERMINAL_CUSTOM_API_KEY',
              authHeader: true,
              models: [{
                id: customApi.model,
                name: customApi.model,
                reasoning: true,
                input: ['text', 'image'],
                contextWindow: 200000,
                maxTokens: 64000
              }]
            }
          }
        }, null, 2));
        modelRuntime = await ModelRuntime.create({ modelsPath });
        model = modelRuntime.getModel('custom-api', customApi.model);
        if (!model) throw new BusinessError('AGENT_MODEL_UNAVAILABLE', '自定义 API 模型不可用', '检查接口地址和模型名称');
      }
      await client.connect(new StdioClientTransport({
        command: this.options.executablePath,
        args: [this.options.helperPath],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CONTENT_TERMINAL_MCP_DISCOVERY_FILE: this.options.discoveryPath
        }
      }));
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      if (names.includes('strategy.approve') || names.includes('approval.approve')) {
        throw new BusinessError('AGENT_MCP_UNAVAILABLE', 'Pi 发现了不应开放的人工批准工具', '检查 MCP 工具边界');
      }
      const terminalMcp = defineTool({
        name: 'terminal_mcp',
        label: '自媒体终端',
        description: '调用自媒体桌面终端的 MCP 工具。先读取，再写入，写后立即读回。',
        parameters: Type.Object({
          name: Type.String({ description: '已经发现的 MCP 工具名称' }),
          arguments: Type.Record(Type.String(), Type.Unknown())
        }),
        execute: async (_toolCallId, input) => {
          if (!names.includes(input.name)) {
            throw new BusinessError('AGENT_MCP_UNAVAILABLE', `MCP 工具不存在: ${input.name}`, '使用已发现的工具名称');
          }
          toolCalls += 1;
          request.onEvent({ type: 'tool_call', name: input.name, at: new Date().toISOString() });
          const response = await client.callTool({ name: input.name, arguments: input.arguments });
          const content = Array.isArray(response.content) ? response.content as { type: string; text?: string }[] : [];
          return {
            content: content
              .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
              .map((item) => ({ type: 'text' as const, text: item.text })),
            details: { name: input.name, isError: Boolean(response.isError) }
          };
        }
      });
      const created = await createAgentSession({
        cwd: this.options.cwd,
        agentDir: this.options.agentDir,
        noTools: 'all',
        tools: ['terminal_mcp'],
        customTools: [terminalMcp],
        modelRuntime,
        model
      });
      session = created.session;
      const abort = () => { void session?.abort(); };
      request.signal.addEventListener('abort', abort, { once: true });
      const unsubscribe = session.subscribe((event) => {
        if (['agent_start', 'agent_end', 'turn_start', 'turn_end', 'agent_settled'].includes(event.type)) {
          request.onEvent({ type: event.type, at: new Date().toISOString() });
        }
      });
      const skill = fs.readFileSync(path.resolve(this.options.skillPath), 'utf8');
      const prompt = [
        skill,
        '',
        '## 本次终端任务',
        `账号标识：${request.accountId}`,
        `触发事件：${request.triggerEvent}`,
        request.objectId ? `对象标识：${request.objectId}` : '',
        request.objectVersion === undefined ? '' : `对象版本：${request.objectVersion}`,
        `目标：${request.goal}`,
        '',
        '只能使用 terminal_mcp 工具处理终端业务。完成写操作后必须读回。'
      ].filter(Boolean).join('\n');
      await session.prompt(prompt);
      await session.waitForIdle();
      unsubscribe();
      request.signal.removeEventListener('abort', abort);
      return {
        sessionId: session.sessionId,
        summary: assistantSummary(session.messages),
        toolCalls
      };
    } catch (error) {
      if (request.signal.aborted) {
        throw new BusinessError('AGENT_CANCELLED', 'Pi 任务已取消', '读取已完成的业务对象');
      }
      if (error instanceof BusinessError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/api key|auth|login|credential/i.test(message)) {
        throw new BusinessError('AGENT_AUTH_REQUIRED', 'Pi 尚未完成可用登录', '在设置中登录 ChatGPT Plus/Pro 或配置 API Key');
      }
      if (/mcp|stdio|pipe|desktop_unavailable|enoent|spawn/i.test(message)) {
        throw new BusinessError('AGENT_MCP_UNAVAILABLE', 'Pi 无法连接终端 MCP', '保持终端运行并重试');
      }
      throw new BusinessError('AGENT_EXECUTION_FAILED', 'Pi 执行失败', message);
    } finally {
      if (previousApiKey === undefined) delete process.env.CONTENT_TERMINAL_CUSTOM_API_KEY;
      else process.env.CONTENT_TERMINAL_CUSTOM_API_KEY = previousApiKey;
      session?.dispose();
      await client.close().catch(() => undefined);
    }
  }
}
