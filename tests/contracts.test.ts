import { describe, expect, it } from 'vitest';
import { commandSchemas } from '../src/contracts/commands';
import { errorCodes } from '../src/contracts/errors';

describe('统一业务契约', () => {
  it('登记 SPEC 6.1 与 TASK-010 的 77 个明确命令与查询', () => {
    expect(Object.keys(commandSchemas)).toHaveLength(77);
    expect(commandSchemas).toHaveProperty('account.create');
    expect(commandSchemas).toHaveProperty('collect.webpage');
    expect(commandSchemas).toHaveProperty('resource.search');
    expect(commandSchemas).toHaveProperty('content.generate_platform_version');
    expect(commandSchemas).toHaveProperty('asset.overlay_text');
    expect(commandSchemas).toHaveProperty('package.build');
    expect(commandSchemas).toHaveProperty('task.cancel');
    expect(commandSchemas).toHaveProperty('search.index_status');
    expect(commandSchemas).toHaveProperty('search.query');
    expect(commandSchemas).toHaveProperty('saved_view.create');
    expect(commandSchemas).toHaveProperty('saved_view.get');
    expect(commandSchemas).toHaveProperty('saved_view.list');
  });

  it('拒绝空账号名和未声明字段', () => {
    const schema = commandSchemas['account.create'];
    expect(schema.safeParse({ caller: 'test', idempotencyKey: '1', name: '', positioning: '', audience: '', tone: '' }).success).toBe(false);
    expect(schema.safeParse({ caller: 'test', idempotencyKey: '1', name: '账号', positioning: '', audience: '', tone: '', extra: true }).success).toBe(false);
  });

  it('稳定错误码覆盖规格要求', () => {
    expect(errorCodes).toContain('VERSION_CONFLICT');
    expect(errorCodes).toContain('IDEMPOTENCY_CONFLICT');
    expect(errorCodes).toContain('FILE_MODIFIED');
    expect(errorCodes).toContain('APPROVAL_INVALIDATED');
    expect(errorCodes).toContain('DISK_FULL');
  });
});
