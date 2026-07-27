project-purpose: Windows 本地优先的自媒体桌面终端，供人类完成资料、内容、素材、账号和三平台发布包工作。
target-surface: 项目内验收环境的九模块真实界面。
runtime-chain: 验收快捷方式 -> 打包 Electron -> preload -> 统一业务命令 -> SQLite/磁盘 -> React DOM -> 截图与交互。
completion-authority: PRD、UI 视觉规范、TASK-017 与用户实际可用性。
focused-gate: 隐藏启动同一验收配置，逐模块捕获 DOM、截图、控制台和真实数据。
budgets: 本轮只诊断一个症状“交付 UI 是否真实完整”，确认根因前不改产品。
stop-conditions: 无法复现、证据冲突、需要用户视觉偏好或修复范围超过八个产品文件。
