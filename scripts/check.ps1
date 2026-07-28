[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Assert-Path {
    param([Parameter(Mandatory)][string]$RelativePath)

    $fullPath = Join-Path $projectRoot $RelativePath
    Write-Host "检查文件: $RelativePath"
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw "缺少必需文件: $RelativePath"
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)][string]$RelativePath,
        [Parameter(Mandatory)][string]$Pattern,
        [Parameter(Mandatory)][string]$Description
    )

    $fullPath = Join-Path $projectRoot $RelativePath
    Write-Host "检查契约: $Description"
    if (-not (Select-String -LiteralPath $fullPath -Pattern $Pattern -Quiet)) {
        throw "$RelativePath 缺少契约: $Description"
    }
}

$requiredFiles = @(
    'AGENTS.md',
    'SKILL.md',
    'docs/ai-harness.md',
    'docs/architecture.md',
    'docs/development-workflow.md',
    'docs/verification.md',
    'docs/spark/2026-07-26-ai-media-desktop-terminal-prd.md',
    'docs/spark/2026-07-28-content-business-partner-system-design.md',
    'docs/spec.md',
    'docs/ui-visual-spec.md',
    'docs/plan.md',
    'docs/tasks.md',
    '.ai/evals/README.md',
    'scripts/check.ps1',
    'package.json',
    'package-lock.json',
    'forge.config.ts',
    'src/main/index.ts',
    'src/renderer/App.tsx'
)

foreach ($relativePath in $requiredFiles) {
    Assert-Path -RelativePath $relativePath
}

Assert-Contains -RelativePath 'SKILL.md' -Pattern '^name:\s*uk-life-content-radar\s*$' -Description '技能名称'
Assert-Contains -RelativePath 'SKILL.md' -Pattern '^description:\s*.+' -Description '技能描述'

$prdPath = 'docs/spark/2026-07-26-ai-media-desktop-terminal-prd.md'
Assert-Contains -RelativePath $prdPath -Pattern '^## 1\. 产品定义\s*$' -Description '产品定义'
Assert-Contains -RelativePath $prdPath -Pattern '^## 3\. 非目标\s*$' -Description '第一版非目标'
Assert-Contains -RelativePath $prdPath -Pattern '^## 10\. API（应用程序接口）与 MCP（模型上下文协议）契约\s*$' -Description '双入口业务契约'
Assert-Contains -RelativePath $prdPath -Pattern '^## 14\. 第一版完成定义\s*$' -Description '完成定义'

Assert-Contains -RelativePath 'docs/spec.md' -Pattern '^## 2\. 运行边界\s*$' -Description '统一业务运行边界'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern 'Electron Forge（桌面打包工具）' -Description '已确认桌面打包方案'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern 'Webpack（网页打包工具）官方 TypeScript（类型化脚本语言）模板' -Description '已确认 Webpack 技术栈'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern 'better-sqlite3（同步数据库驱动）' -Description '已确认数据库驱动'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '^## 7\. MCP（模型上下文协议）对等规则\s*$' -Description 'MCP 对等规则'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '\| 账号 \| 创建、更新 \|' -Description '账号业务契约'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '真实 MCP（模型上下文协议）服务、注册信息' -Description '真实 MCP 前置交付'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '正文摘要.*文件摘要' -Description '批准绑定真实内容摘要'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '不提供任何永久删除业务命令或界面入口' -Description '无永久删除能力'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '`account\.create`、`account\.get`、`account\.update`、`account\.search`' -Description '账号逐命令契约'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '\| 关键输入 \| 必须返回 \| 核心错误 \|' -Description '命令输入输出错误契约'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^## 3\. 窗口与网格\s*$' -Description '界面空间规范'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^## 11\. 视觉验收\s*$' -Description '视觉验收'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^### 7\.2 浏览与收集\s*$' -Description '浏览收集页面规范'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^### 7\.7 账号\s*$' -Description '账号页面规范'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^### 7\.8 经营\s*$' -Description '经营页面规范'
Assert-Contains -RelativePath 'docs/ui-visual-spec.md' -Pattern '^### 7\.9 设置\s*$' -Description '设置页面规范'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '^## 3\. 阶段 1：单平台最小发布闭环\s*$' -Description '最小发布闭环计划'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '^## 9\. 阶段 7：完整桌面交付\s*$' -Description '安装应用交付计划'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '最小持久任务执行、状态转换、取消提交点' -Description '持久任务前置'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '真实 Codex（代码智能体）客户端发现工具' -Description '真实 MCP 调用验收'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '创建最小账号' -Description '账号实施切片'
Assert-Contains -RelativePath 'docs/plan.md' -Pattern '逐行执行 UI（用户界面）视觉规范第 8\.1 节页面状态矩阵' -Description '页面状态逐项验收'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^## 2\. 主台账\s*$' -Description '任务主台账'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### TASK-000 工程壳、依赖锁定与总门禁\s*$' -Description '首个工程任务'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### TASK-019 第一版最终验收与发布裁决\s*$' -Description '最终验收任务'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '直接依赖 TASK-000 至 TASK-018、UIR-001 至 UIR-004、BIZ-001 至 BIZ-008 与 PI-001 至 PI-004 全部为 completed（已完成）' -Description '最终任务完整依赖'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern 'TASK-019 本身不得吸收实现工作' -Description '最终任务不补功能'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### BIZ-001 内容事业合伙人产品契约、数据对象与迁移\s*$' -Description '内容生意工作台首任务'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### BIZ-008 真实帖子至成交样例与完整验收\s*$' -Description '内容生意工作台最终验收'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '^## 15\. 内容事业合伙人扩展\s*$' -Description '内容事业合伙人技术契约'
Assert-Contains -RelativePath 'src/storage/migrations.ts' -Pattern 'version:\s*14' -Description '内容生意数据库迁移'
Assert-Contains -RelativePath 'docs/spec.md' -Pattern '^## 16\. Pi Agent 执行内核\s*$' -Description 'Pi Agent 技术契约'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### PI-001 Pi 产品契约、依赖、认证探测与失败实验\s*$' -Description 'Pi Agent 首任务'
Assert-Contains -RelativePath 'docs/tasks.md' -Pattern '^### PI-004 真实自定义 API、安装应用与自动接力验收\s*$' -Description 'Pi Agent 最终验收'
Assert-Contains -RelativePath 'package.json' -Pattern '"@earendil-works/pi-coding-agent":\s*"0\.82\.1"' -Description 'Pi SDK 锁定版本'
Assert-Contains -RelativePath 'src/tasks/task-service.ts' -Pattern "type === 'agent\.execute'" -Description 'Pi 持久任务入口'
Assert-Contains -RelativePath 'src/agent/pi-agent-executor.ts' -Pattern "name: 'terminal_mcp'" -Description 'Pi 仅通过统一 MCP 工具入口'
Assert-Contains -RelativePath 'src/business/dispatcher.ts' -Pattern "triggerEvent: 'strategy\.approved'" -Description '批准后自动创建 Pi 接力'
Assert-Contains -RelativePath 'src/renderer/SettingsPanel.tsx' -Pattern '使用本机 Codex 登录' -Description 'Pi 登录设置入口'
Assert-Contains -RelativePath 'src/renderer/SettingsPanel.tsx' -Pattern '导入 CockpitTools' -Description 'CockpitTools 自定义 API 入口'
Assert-Contains -RelativePath 'src/agent/pi-agent-executor.ts' -Pattern "'custom-api'" -Description 'Pi 自定义 Responses API'

function Invoke-NpmGate {
    param([Parameter(Mandatory)][string]$Script)

    Write-Host "运行应用门禁: npm run $Script"
    & npm.cmd run $Script
    if ($LASTEXITCODE -ne 0) {
        throw "应用门禁失败: npm run $Script"
    }
}

Push-Location $projectRoot
try {
    Invoke-NpmGate -Script 'typecheck'
    Invoke-NpmGate -Script 'lint'
    Invoke-NpmGate -Script 'test'
    Invoke-NpmGate -Script 'build'
} finally {
    Pop-Location
}

Write-Host 'harness（验证脚手架）检查通过。'
