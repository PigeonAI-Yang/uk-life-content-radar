import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { commandSchemas, humanOnlyCommands, type CommandName } from '../contracts/commands';
import type { DispatchResult } from '../business/dispatcher';

type Discovery = { pipeName: string };
type PipeResponse = { id: string; result?: DispatchResult; error?: string };

function discoveryPath() {
  if (process.env.CONTENT_TERMINAL_MCP_DISCOVERY_FILE) return process.env.CONTENT_TERMINAL_MCP_DISCOVERY_FILE;
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable');
  return path.join(process.env.APPDATA, 'content-media-terminal', 'codex-handoff.json');
}

function pipeCall(command: string, input: unknown) {
  return new Promise<DispatchResult>((resolveCall, rejectCall) => {
    const discovery = JSON.parse(fs.readFileSync(discoveryPath(), 'utf8')) as Discovery;
    const id = randomUUID();
    const socket = net.createConnection(discovery.pipeName);
    socket.setEncoding('utf8');
    socket.setTimeout(10_000);
    let buffer = '';
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, command, input })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const response = JSON.parse(buffer.slice(0, newline)) as PipeResponse;
      socket.end();
      if (response.error) rejectCall(new Error(response.error));
      else if (response.result) resolveCall(response.result);
      else rejectCall(new Error('Named Pipe returned no result'));
    });
    socket.on('timeout', () => socket.destroy(new Error('Named Pipe request timed out')));
    socket.on('error', rejectCall);
  });
}

const server = new McpServer({ name: 'content-media-terminal', version: '0.1.0' });
for (const [name, schema] of Object.entries(commandSchemas)) {
  if (humanOnlyCommands.has(name as CommandName)) continue;
  server.registerTool(name, {
    description: `自媒体桌面终端统一业务能力：${name}`,
    inputSchema: schema as ZodType<Record<string, unknown>>
  }, async (input: Record<string, unknown>) => {
    try {
      const result = await pipeCall(name as CommandName, input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        isError: !result.ok
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          code: 'DESKTOP_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error)
        }) }],
        isError: true
      };
    }
  });
}

async function main() {
  await server.connect(new StdioServerTransport());
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
