import { z } from 'zod';

const id = z.object({ id: z.string().min(1) }).strict();
const versioned = z.object({ id: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
const search = z.object({ query: z.string().default(''), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }).strict();
const idempotent = {
  caller: z.string().min(1),
  idempotencyKey: z.string().min(1)
};
const taskId = z.object({ taskId: z.string().min(1) }).strict();
const sourceId = z.object({ sourceId: z.string().min(1) }).strict();
const contentId = z.object({ contentId: z.string().min(1) }).strict();
const assetId = z.object({ assetId: z.string().min(1) }).strict();
const candidateId = z.object({ candidateId: z.string().min(1) }).strict();
const accountId = z.object({ accountId: z.string().min(1) }).strict();
const metadata = {
  topic: z.string().default(''),
  region: z.string().default(''),
  targetAudience: z.string().default(''),
  tags: z.array(z.string()).default([])
};
const metadataUpdate = {
  topic: z.string().optional(),
  region: z.string().optional(),
  targetAudience: z.string().optional(),
  tags: z.array(z.string()).optional()
};
const librarySearch = z.object({
  query: z.string().default(''),
  mode: z.enum(['keyword', 'semantic']).default('keyword'),
  types: z.array(z.enum(['resource', 'excerpt', 'note', 'content', 'asset', 'package', 'account']))
    .default(['resource', 'excerpt', 'note', 'content', 'asset', 'package', 'account']),
  topic: z.string().optional(),
  region: z.string().optional(),
  targetAudience: z.string().optional(),
  source: z.string().optional(),
  accountId: z.string().optional(),
  platform: z.enum(['xiaohongshu', 'douyin', 'wechat']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).default([]),
  includeArchived: z.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25)
}).strict();

export const commandSchemas = {
  'account.create': z.object({
    ...idempotent,
    name: z.string().trim().min(1),
    positioning: z.string().default(''),
    audience: z.string().default(''),
    tone: z.string().default(''),
    forbiddenExpressions: z.array(z.string()).default([]),
    platformIdentities: z.record(z.string(), z.string()).default({}),
    defaultTemplates: z.record(z.string(), z.string()).default({})
  }).strict(),
  'account.get': id,
  'account.update': versioned.extend({
    name: z.string().trim().min(1).optional(),
    positioning: z.string().optional(),
    audience: z.string().optional(),
    tone: z.string().optional(),
    forbiddenExpressions: z.array(z.string()).optional(),
    platformIdentities: z.record(z.string(), z.string()).optional(),
    defaultTemplates: z.record(z.string(), z.string()).optional()
  }).strict(),
  'account.search': search,
  'product.create': z.object({
    ...idempotent,
    accountId: z.string().min(1),
    name: z.string().trim().min(1),
    targetCustomer: z.string().min(1),
    problem: z.string().min(1),
    priceRange: z.string().min(1),
    serviceScope: z.string().min(1),
    suitableFor: z.string().default(''),
    unsuitableFor: z.string().default('')
  }).strict(),
  'product.get': id,
  'product.update': versioned.extend({
    name: z.string().trim().min(1).optional(),
    targetCustomer: z.string().min(1).optional(),
    problem: z.string().min(1).optional(),
    priceRange: z.string().min(1).optional(),
    serviceScope: z.string().min(1).optional(),
    suitableFor: z.string().optional(),
    unsuitableFor: z.string().optional()
  }).strict(),
  'product.list': z.object({ accountId: z.string().min(1).optional() }).strict(),
  'strategy.propose': z.object({
    ...idempotent,
    accountId: z.string().min(1),
    productId: z.string().min(1).optional(),
    proposalType: z.enum(['product', 'audience', 'positioning', 'price', 'promise', 'conversion']),
    proposed: z.record(z.string(), z.unknown()),
    rationale: z.string().min(1),
    evidence: z.array(z.string().min(1)).default([]),
    successMeasure: z.string().min(1)
  }).strict(),
  'strategy.get': id,
  'strategy.list': accountId.extend({
    status: z.enum(['pending', 'approved', 'rejected', 'invalidated']).optional()
  }).strict(),
  'strategy.approve': versioned,
  'lead.create': z.object({
    ...idempotent,
    accountId: z.string().min(1),
    productId: z.string().min(1).optional(),
    sourceContentId: z.string().min(1).optional(),
    platform: z.enum(['xiaohongshu', 'douyin', 'wechat', 'other']),
    nickname: z.string().min(1),
    coreNeed: z.string().default(''),
    intent: z.string().default(''),
    nextAction: z.string().default(''),
    nextFollowUpAt: z.string().datetime().optional()
  }).strict(),
  'lead.get': id,
  'lead.list': accountId.extend({ stage: z.enum([
    'new_message', 'need_understood', 'wechat_added', 'negotiating', 'won', 'lost'
  ]).optional() }).strict(),
  'lead.update': versioned.extend({
    stage: z.enum(['new_message', 'need_understood', 'wechat_added', 'negotiating', 'won', 'lost']).optional(),
    coreNeed: z.string().optional(),
    intent: z.string().optional(),
    wechatAdded: z.boolean().optional(),
    nextAction: z.string().optional(),
    nextFollowUpAt: z.string().datetime().nullable().optional()
  }).strict(),
  'conversation.import': z.object({
    ...idempotent,
    leadId: z.string().min(1).optional(),
    channel: z.enum(['xiaohongshu', 'wechat', 'spoken', 'other']),
    occurredAt: z.string().datetime(),
    filePath: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    summary: z.string().min(1),
    needs: z.array(z.string()).default([]),
    objections: z.array(z.string()).default([]),
    suggestedReply: z.string().default(''),
    conclusion: z.string().default(''),
    nextFollowUpAt: z.string().datetime().optional()
  }).strict().refine((value) => Boolean(value.filePath) !== Boolean(value.text), '必须且只能提供 filePath 或 text'),
  'conversation.confirm': versioned,
  'conversation.list': z.object({ leadId: z.string().min(1).optional() }).strict(),
  'deal.record': z.object({
    ...idempotent,
    leadId: z.string().min(1),
    productId: z.string().min(1),
    outcome: z.enum(['won', 'lost']),
    amountMinor: z.number().int().min(0).optional(),
    currency: z.string().length(3).default('GBP'),
    decidedAt: z.string().datetime(),
    reason: z.string().min(1),
    contentInsight: z.string().default('')
  }).strict(),
  'deal.list': accountId,
  'post_metrics.record': z.object({
    ...idempotent,
    contentId: z.string().min(1),
    platform: z.enum(['xiaohongshu', 'douyin', 'wechat']),
    observedAt: z.string().datetime(),
    sourceType: z.enum(['manual', 'screenshot', 'import']),
    impressions: z.number().int().min(0).optional(),
    views: z.number().int().min(0).optional(),
    likes: z.number().int().min(0).optional(),
    saves: z.number().int().min(0).optional(),
    comments: z.number().int().min(0).optional(),
    messages: z.number().int().min(0).optional(),
    evidenceFilePath: z.string().min(1).optional()
  }).strict(),
  'post_metrics.list': contentId,
  'business.snapshot': accountId,
  'business.pending': accountId,
  'intelligence.record_scan': z.object({
    ...idempotent,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    sources: z.array(z.object({
      name: z.string().min(1), sourceId: z.string().min(1).optional(),
      status: z.enum(['succeeded', 'failed']), itemCount: z.number().int().min(0),
      error: z.string().optional(), lastSuccessAt: z.string().datetime().optional()
    }).strict()).min(1),
    candidates: z.array(z.object({
      sourceId: z.string().min(1).optional(), title: z.string().min(1),
      sourceUrl: z.string().url(), audience: z.string().min(1), impact: z.string().min(1),
      timeliness: z.string().min(1), verificationStatus: z.string().min(1),
      duplicateOfId: z.string().min(1).optional(), angles: z.array(z.string().min(1)),
      publishBefore: z.string().datetime().optional(), discoveredAt: z.string().datetime()
    }).strict()).default([])
  }).strict(),
  'intelligence.get': id,
  'intelligence.list': z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
  'intelligence.scan_status': z.object({}).strict(),
  'intelligence.promote_resource': z.object({
    ...idempotent, candidateId: z.string().min(1)
  }).strict(),
  'intelligence.promote_content': z.object({
    ...idempotent, candidateId: z.string().min(1), accountId: z.string().min(1)
  }).strict(),
  'browser.tabs.list': z.object({}).strict(),
  'collect.webpage': z.object({ ...idempotent, tabId: z.string().min(1), destination: z.enum(['library', 'content']) }).strict(),
  'collect.selection': z.object({ ...idempotent, tabId: z.string().min(1), destination: z.enum(['library', 'content']) }).strict(),
  'collect.image': z.object({ ...idempotent, tabId: z.string().min(1), resourceUrl: z.string().url(), destination: z.enum(['assets', 'content']) }).strict(),
  'collect.download': z.object({ ...idempotent, tabId: z.string().min(1), resourceUrl: z.string().url(), destination: z.enum(['assets', 'content']) }).strict(),
  'resource.create': z.object({ ...idempotent, ...metadata, title: z.string().min(1), body: z.string(), filePath: z.string().min(1).optional() }).strict(),
  'resource.get': id,
  'resource.update': versioned.extend({ ...metadataUpdate, title: z.string().min(1).optional(), body: z.string().optional() }).strict(),
  'resource.search': search,
  'resource.archive': versioned,
  'resource.restore': versioned,
  'resource.link_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'resource.unlink_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'excerpt.create': sourceId.extend({ ...metadata, text: z.string().min(1), context: z.string() }).strict(),
  'excerpt.get': id,
  'excerpt.update': versioned.extend({ ...metadataUpdate, text: z.string().min(1), context: z.string() }).strict(),
  'excerpt.search': search,
  'excerpt.archive': versioned,
  'excerpt.restore': versioned,
  'excerpt.link_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'excerpt.unlink_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'note.create': z.object({ ...metadata, body: z.string().min(1), sourceId: z.string().optional(), contentId: z.string().optional() }).strict(),
  'note.get': id,
  'note.update': versioned.extend({ ...metadataUpdate, body: z.string().min(1) }).strict(),
  'note.search': search,
  'note.archive': versioned,
  'note.restore': versioned,
  'note.link_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'note.unlink_content': id.extend({ contentId: z.string().min(1) }).strict(),
  'content.create': z.object({ ...idempotent, accountId: z.string().min(1), title: z.string().min(1) }).strict(),
  'content.get': id,
  'content.save_version': z.object({
    contentId: z.string().min(1), expectedVersion: z.number().int().positive(), body: z.string(),
    outline: z.string().default(''), verificationItems: z.array(z.string()).default([]),
    platform: z.enum(['xiaohongshu', 'douyin', 'wechat']).optional()
  }).strict(),
  'content.history': contentId,
  'content.create_from_version': z.object({ ...idempotent, versionId: z.string().min(1), accountId: z.string().min(1) }).strict(),
  'content.link_resource': contentId.extend({ resourceId: z.string().min(1) }).strict(),
  'content.unlink_resource': contentId.extend({ resourceId: z.string().min(1) }).strict(),
  'content.link_asset': contentId.extend({ assetVersionId: z.string().min(1), order: z.number().int().min(0) }).strict(),
  'content.unlink_asset': contentId.extend({ assetVersionId: z.string().min(1) }).strict(),
  'content.generate_platform_version': z.object({ ...idempotent, contentId: z.string().min(1), platform: z.enum(['xiaohongshu', 'douyin', 'wechat']) }).strict(),
  'asset.import': z.object({ ...idempotent, filePath: z.string().min(1) }).strict(),
  'asset.get': id,
  'asset.search': search,
  'asset.archive': versioned,
  'asset.restore': versioned,
  'asset.import_external_version': z.object({ ...idempotent, assetId: z.string().min(1), versionId: z.string().min(1).optional(), filePath: z.string().min(1) }).strict(),
  'asset.crop': assetId.extend({ ...idempotent, versionId: z.string().min(1), left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  'asset.resize': assetId.extend({ ...idempotent, versionId: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  'asset.compress': assetId.extend({ ...idempotent, versionId: z.string().min(1), quality: z.number().int().min(1).max(100) }).strict(),
  'asset.convert_platform_size': assetId.extend({ ...idempotent, versionId: z.string().min(1), templateVersion: z.string().min(1) }).strict(),
  'asset.overlay_text': assetId.extend({ ...idempotent, versionId: z.string().min(1), text: z.string().min(1), font: z.string().min(1), size: z.number().positive(), color: z.string().min(1), x: z.number(), y: z.number() }).strict(),
  'package.create_preview': z.object({ ...idempotent, accountId: z.string().min(1), platform: z.enum(['xiaohongshu', 'douyin', 'wechat']), contentVersionId: z.string().min(1), assetVersionIds: z.array(z.string().min(1)), templateVersion: z.string().min(1) }).strict(),
  'package.list_candidates': search,
  'package.request_approval': candidateId,
  'package.get_approval': candidateId,
  'package.build': z.object({
    ...idempotent,
    candidateId: z.string().min(1).optional(),
    candidateIds: z.array(z.string().min(1)).min(1).max(3).optional()
  }).strict().refine((value) => Boolean(value.candidateId) !== Boolean(value.candidateIds), '必须且只能提供 candidateId 或 candidateIds'),
  'package.get': id,
  'package.open_directory': id,
  'package.copy_text': id,
  'approval.approve': candidateId,
  'task.start': z.object({ ...idempotent, type: z.string().min(1), parameters: z.record(z.string(), z.unknown()) }).strict(),
  'task.get': taskId,
  'task.list': search,
  'task.cancel': taskId,
  'settings.initialize_root': z.object({ rootPath: z.string().min(1) }).strict(),
  'settings.get': z.object({}).strict(),
  'settings.update_export_directory': z.object({ directory: z.string().min(1) }).strict(),
  'settings.update_platform_template': z.object({ platform: z.enum(['xiaohongshu', 'douyin', 'wechat']), template: z.record(z.string(), z.unknown()) }).strict(),
  'storage.scan': z.object({}).strict(),
  'search.index_status': z.object({}).strict(),
  'search.query': librarySearch,
  'saved_view.create': z.object({ ...idempotent, name: z.string().min(1), scope: z.enum(['library', 'global']), filters: librarySearch }).strict(),
  'saved_view.get': id,
  'saved_view.list': z.object({ scope: z.enum(['library', 'global']).optional() }).strict()
} as const;

export type CommandName = keyof typeof commandSchemas;
export const humanOnlyCommands: ReadonlySet<CommandName> = new Set([
  'approval.approve',
  'strategy.approve'
]);
