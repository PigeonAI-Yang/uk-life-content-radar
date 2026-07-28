export const errorCodes = [
  'NOT_FOUND',
  'INVALID_INPUT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'FILE_UNREADABLE',
  'FILE_UNWRITABLE',
  'FILE_MISSING',
  'FILE_MODIFIED',
  'TASK_FAILED',
  'TASK_CANCELLED',
  'TASK_COMPLETED',
  'NOT_APPROVED',
  'APPROVAL_INVALIDATED',
  'DISK_FULL',
  'ROOT_ALREADY_INITIALIZED',
  'COMMAND_NOT_IMPLEMENTED'
  ,'TAB_NOT_FOUND'
  ,'PAGE_UNREADABLE'
  ,'DOWNLOAD_FAILED'
  ,'DUPLICATE_URL'
  ,'AUTH_REQUIRED'
  ,'AGENT_AUTH_REQUIRED'
  ,'AGENT_AUTH_EXPIRED'
  ,'AGENT_MODEL_UNAVAILABLE'
  ,'AGENT_MCP_UNAVAILABLE'
  ,'AGENT_CANCELLED'
  ,'AGENT_INTERRUPTED'
  ,'AGENT_EXECUTION_FAILED'
  ,'OFFLINE'
  ,'DATABASE_UNAVAILABLE'
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recovery: string,
    public readonly relatedId?: string
  ) {
    super(message);
  }

  toJSON() {
    return { code: this.code, message: this.message, recovery: this.recovery, relatedId: this.relatedId };
  }
}
