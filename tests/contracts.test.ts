import { describe, expect, it } from 'vitest';
import { commandSchemas, humanOnlyCommands } from '../src/contracts/commands';
import { errorCodes } from '../src/contracts/errors';

describe('统一业务契约', () => {
  it('登记统一业务命令与查询', () => {
    expect(Object.keys(commandSchemas)).toHaveLength(103);
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
    expect(commandSchemas).toHaveProperty('product.create');
    expect(commandSchemas).toHaveProperty('strategy.approve');
    expect(humanOnlyCommands.has('strategy.approve')).toBe(true);
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
