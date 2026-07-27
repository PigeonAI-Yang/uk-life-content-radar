import { describe, expect, it } from 'vitest';
import { routes } from '../src/renderer/routes';

describe('一级导航', () => {
  it('固定为九个业务模块且无主题导航', () => {
    expect(routes).toEqual(['工作台', '浏览与收集', '资料库', '内容', '素材库', '发布包', '账号', '任务', '设置']);
    expect(routes).not.toContain('签证' as never);
  });
});
