export const routes = ['工作台', '浏览与收集', '资料库', '内容', '素材库', '发布包', '账号', '任务', '设置'] as const;

export type RouteName = (typeof routes)[number];
