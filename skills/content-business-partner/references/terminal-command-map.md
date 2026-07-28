# 终端命令地图

只列总控 Skill 高频使用的业务语义。调用前以 MCP 实际发现结果为准。

## 开工与情报主链

- `account.search`：发现账号。
- `intelligence.scan_status`：读取最近扫描、成功与失败来源、最后成功时间。
- `intelligence.list|get`：读取候选及其核验、时效和沉淀状态。
- `intelligence.record_scan`：登记一次真实扫描。
- `intelligence.promote_resource|promote_content`：把候选分别沉淀为资料和内容。
- `resource.get|search`、`content.get|search`、`task.list`：恢复资料、内容供给与任务。

## 产品与策略

- `product.create|get|update|list`
- `strategy.propose|get|list`
- `strategy.approve` 仅桌面 UI 可用，MCP 不应发现。

## 创作

- `resource.create|get|update|search`
- `content.create|get|save_version|history`
- `content.link_resource|link_asset|generate_platform_version`
- `asset.import|get|search` 及已有基础编辑命令

## 客户与经营结果

只有已有真实对象或用户明确要求时再读取：

- `business.snapshot|pending`
- `lead.create|get|list|update`
- `conversation.import|confirm|list`
- `deal.record|list`
- `post_metrics.record|list`

## 发布

- `package.create_preview|request_approval|get_approval|build|get`
- `approval.approve` 仅桌面 UI 可用，MCP 不应发现。

所有写命令按契约提供稳定 `caller`、`idempotencyKey` 或 `expectedVersion`。写后调用对应读取命令验证，不以工具返回无异常代替读回。
