import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { DispatchResult } from '../business/dispatcher';

type PipeRequest = { id: string; command: string; input: unknown };
type PipeResponse = { id: string; result?: DispatchResult; error?: string };

export function startPipeServer(
  userDataPath: string,
  dispatch: (command: string, input: unknown) => DispatchResult | Promise<DispatchResult>
) {
  const pipeName = `\\\\.\\pipe\\content-media-terminal-${process.pid}`;
  const discoveryPath = path.join(userDataPath, 'codex-handoff.json');
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response: PipeResponse;
        try {
          const request = JSON.parse(line) as PipeRequest;
          response = { id: request.id, result: await dispatch(request.command, request.input) };
        } catch (error) {
          response = { id: '', error: error instanceof Error ? error.message : String(error) };
        }
        socket.write(`${JSON.stringify(response)}\n`);
      }
    });
  });
  server.listen(pipeName, () => {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(discoveryPath, JSON.stringify({
      pipeName,
      pid: process.pid,
      version: '0.1.0',
      startedAt: new Date().toISOString()
    }));
  });
  return { server, pipeName, discoveryPath };
}
