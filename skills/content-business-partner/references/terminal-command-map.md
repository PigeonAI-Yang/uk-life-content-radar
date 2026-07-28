# 终端命令地图

只列总控 Skill 高频使用的业务语义。调用前以 MCP 实际发现结果为准。

## 恢复与待办

- `account.search`：发现账号。
- `business.snapshot`：恢复完整经营上下文和数据缺口。
- `business.pending`：读取到期跟进、待确认沟通和异常文件。

## 产品与策略

- `product.create|get|update|list`
- `strategy.propose|get|list`
- `strategy.approve` 仅桌面 UI 可用，MCP 不应发现。

## 资讯与创作

- `intelligence.record_scan|get|list`
- `intelligence.promote_resource|promote_content`
- `resource.create|get|update|search`
- `content.create|get|save_version|history`
- `content.link_resource|link_asset|generate_platform_version`
- `asset.import|get|search` 及已有基础编辑命令

## 客户与经营结果

- `lead.create|get|list|update`
- `conversation.import|confirm|list`
- `deal.record|list`
- `post_metrics.record|list`

## 发布

- `package.create_preview|request_approval|get_approval|build|get`
- `approval.approve` 仅桌面 UI 可用，MCP 不应发现。

所有写命令按契约提供稳定 `caller`、`idempotencyKey` 或 `expectedVersion`。写后调用对应读取命令验证，不以工具返回无异常代替读回。
