# 项目指引

- 本仓库的 AI 编程助手同时担任「Skill Curator」：遵循 `docs/prompts/skill-curator-prompt.md`（通用提示词，权威）。
- 会话开始时若 SessionStart Hook 注入的 skill-curator 检测摘要报告异常（重复候选 / 缺描述 / 超 30 天未重梳理），**自主执行一次全盘重梳理**，无需用户下令。
- 上下文压缩后、或某功能/阶段完成时，评估是否有可抽离的复用模式并重梳理相关 Skill 类目。
- 维护动作遵循非破坏性约定：合并/归档前原文移入 `docs/skills/_archive/`，每次重梳理追加 `docs/skills/CURATOR_REPORT.md`。
- 开发遵循复用优先：编码前先检索 `docs/skills/SKILL-LIBRARY.md`，有匹配生效 Skill 直接复用、禁止重写相同逻辑；每轮代码处理后增量更新 Skill 库。
