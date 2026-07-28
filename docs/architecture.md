# 架构上下文

## 当前状态

[项目事实] 当前目录已包含 Electron（桌面应用框架）终端源码、统一业务内核、SQLite（本地数据库）迁移、MCP（模型上下文协议）服务、React（界面框架）页面、测试、打包配置和 Windows（微软桌面系统）安装产物。当前阶段按已确认设计扩展内容生意工作台。

## 技术栈与运行时

- 已确认平台：Windows（微软桌面系统）。
- 已确认存储方向：业务文件位于用户指定目录；SQLite（本地数据库）保存索引、元数据、关系和状态。
- 已确认集成方向：统一业务 API（应用程序接口）供界面与 MCP（模型上下文协议）共同调用。
- 已确认技术栈：Electron（桌面应用框架）+ Electron Forge（桌面打包工具）+ Webpack（网页打包工具）+ TypeScript（类型化脚本语言）+ React（界面框架）+ Fluent UI（微软流畅设计组件库）。
- 已确认数据与能力实现：better-sqlite3（同步数据库驱动）、手写 SQL（结构化查询语言）、Lexical（富文本编辑器内核）、Sharp（图片处理库）、Electron WebContentsView（网页内容视图）。
- 已确认 MCP（模型上下文协议）链：Codex（代码智能体）通过 stdio（标准输入输出）连接官方 TypeScript SDK（类型脚本开发包）服务；该服务通过 Windows Named Pipe（微软系统命名管道）调用桌面主进程中的唯一业务内核。
- 已验证 npm（包管理器）、Sharp（图片处理库）原生重建、语义搜索、Electron Forge（桌面打包工具）打包和 Windows（微软桌面系统）安装链。
- 已选定 Pi SDK 作为固定后台 Agent 执行内核；Pi 通过现有 MCP（模型上下文协议）链访问业务内核，不建设通用执行器适配层。

详细边界与决策门见 [SPEC（技术规格）](spec.md)。

## 当前入口

| 文件 | 当前作用 |
| --- | --- |
| `SKILL.md` | 英国生活资讯收集、核验、选题和案例配图流程 |
| `agents/openai.yaml` | 技能展示信息与默认调用提示 |
| `references/source-map.md` | 英国生活资讯来源发现入口 |
| `docs/spark/2026-07-26-ai-media-desktop-terminal-prd.md` | 用户已确认的第一版产品契约 |
| `docs/spec.md` | 前后端、数据、文件、MCP（模型上下文协议）与安装技术规格 |
| `docs/ui-visual-spec.md` | 已确认参考方向对应的界面视觉与空间规范 |
| `docs/plan.md` | 按双入口垂直闭环推进的实施计划 |
| `docs/tasks.md` | TASK-000 至 TASK-019、UIR-001 至 UIR-004 与 BIZ-001 至 BIZ-008 的唯一执行台账 |
| `scripts/check.ps1` | 当前 harness（验证脚手架）总门禁 |

应用运行入口为 `npm start`，总门禁为 `pwsh -NoProfile -File scripts/check.ps1`。

## 目录地图

```text
.
├─ .ai/evals/                 功能验收与回归模板
├─ agents/                    技能代理展示配置
├─ docs/                      产品与工程上下文
│  └─ spark/                  产品设计文档
├─ references/                资讯来源地图
├─ scripts/                   项目检查脚本
├─ AGENTS.md                  智能体入口规则
└─ SKILL.md                   现有英国生活内容雷达技能
```

`.superpowers/` 是构思阶段的临时可视化产物，不是产品源码。

## 已确认产品数据流

```text
人类界面 ─┐
          ├─ 统一业务能力 ─ 本地索引与状态
MCP（模型上下文协议） ─┘        └─ 用户指定业务文件目录
```

后台自动接力：

```text
人工批准 → 持久 agent.execute 任务 → Pi Runner
→ MCP stdio helper → Windows Named Pipe → 唯一业务内核
→ 任务状态、事件文件和业务产物读回
```

业务主链：

```text
浏览与收集 → 资料与素材管理 → 内容创作与引用 → 图片基础处理
→ 核验、去重、影响与时效判断 → 情报候选 → 资料/选题/内容
→ 研究与写作 → 可选的平台版本、发布包和经营结果回填
```

## 关键集成边界

- 界面与 MCP（模型上下文协议）不得各自实现一套业务逻辑。
- 资料、内容和素材可独立存在，通过引用关系复用，不复制底层文件。
- 最终发布包审批绑定确定正文和图片版本，内容变化后旧批准失效。
- 英国资讯核验规则来自 `SKILL.md`，但桌面终端不应被限定为只支持英国生活主题。

## 当前实施缺口

- 产品、策略、客户、沟通、成交、平台表现和资讯候选的数据对象正在 BIZ-001 至 BIZ-006 落地。
- “经营”工作区和总控 Skill 尚未完成真实验收。
- 最终人工完整链和干净 Windows 11（微软桌面系统）验收仍需用户参与。
- Pi SDK 认证探测、持久执行、批准触发和真实订阅安装态验收按 PI-001 至 PI-004 实施。
