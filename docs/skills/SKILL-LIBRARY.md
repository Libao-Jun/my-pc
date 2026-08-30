# 📚 项目Skill库（动态维护，随开发迭代更新）

> 说明：Skill 库为当前项目可复用逻辑集合，后续开发遇到对应场景直接调用对应 Skill，禁止重复实现；状态分为【生效｜待优化｜已废弃】。每轮代码处理后在 `docs/skills/CURATOR_REPORT.md` 记录变更。

| Skill ID | Skill名称 | 能力描述 | 输入参数 | 输出/返回结果 | 使用约束&边界 | 示例调用方式 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-001 | skill-curator | 维护本仓库 Skill 库的自适应管家：检测/新增/修改/合并/精简/归档可复用 Skill，输出索引表并强制复用优先 | SKILL_ROOT 路径、检测摘要、待评估的代码或 Skill | 更新后的 Skill 库、检测摘要、CURATOR_REPORT.md | 非破坏性（归档可恢复）；不触碰 `src/`、`.claude/skills/skill-factory/`、既有 28 个 skill | 说「整理 skill 库」或「重新梳理Skill库」 | 生效 |

> 新增分配递增 Skill ID；修改直接更新对应行；废弃改状态保留记录；待优化标记迭代点。
