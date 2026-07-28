export type AgentExecutionRequest = {
  taskId: string;
  accountId: string;
  goal: string;
  triggerEvent: string;
  objectId?: string;
  objectVersion?: number;
  signal: AbortSignal;
  onEvent: (event: Record<string, unknown>) => void;
};

export type AgentExecutionResult = {
  sessionId?: string;
  summary: string;
  toolCalls: number;
};

export interface AgentExecutor {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}
