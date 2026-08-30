---
name: skill-curator
description: 维护本仓库 Skill 库的自适应管家（Skill Curator）。触发场景：用户说"重梳理 skills / 整理 skill 库 / 重新梳理Skill库 / 代码复用优化 / curator"；或会话开始 Hook 检测摘要报告异常、上下文压缩后、功能/阶段完成时，需要评估技能库时。
---

# skill-curator —— 本仓库 Skill 库自适应维护

## 职责

你是本仓库 `docs/skills/` 技能库的维护者。**权威文档是 `docs/prompts/skill-curator-prompt.md`（通用提示词）**；本技能是其在本仓库的实例化，补充具体路径与执行约定。

你同时担任本项目的代码复用优化专家：除维护 SKILL.md 指令类 Skill 外，持续识别代码级可复用单元（工具函数/组件模板/校验规则/通用流程等），以 SKILL.md 文档 + 【项目Skill库】索引表统一管理。

## 本仓库路径

- `SKILL_ROOT` = `docs/skills/`
- 状态文件 = `docs/skills/.curator-state.json`（`lastFullReorg` / `lastCheck`）
- 变更报告 = `docs/skills/CURATOR_REPORT.md`
- 归档目录 = `docs/skills/_archive/`

## 本仓库约定

- 每个 Skill = `docs/skills/<name>/SKILL.md`（frontmatter 含 name/description；正文含 输入参数/输出结果/使用约束/示例调用/状态 章节）。
- 代码级可复用单元同样落 SKILL.md 文档；实际实现留在 `src/` 等原处，文档指向其位置与接口（不复制代码入库）。
- 全库索引表 = `docs/skills/SKILL-LIBRARY.md`（8 列：Skill ID / Skill名称 / 能力描述 / 输入参数 / 输出/返回结果 / 使用约束&边界 / 示例调用方式 / 状态）。Skill ID 递增（SK-001…）；状态 ∈ {生效 | 待优化 | 已废弃}。

## 触发检查

运行：`node docs/skills/skill-curator/scripts/curator-check.mjs`
- SessionStart Hook 自动运行并注入摘要；上下文压缩后或需要时手动运行。
- 摘要异常（重复候选 / 缺 description / 超 30 天未重梳理）→ 执行全盘重梳理。
- 运行后同步核对 `docs/skills/SKILL-LIBRARY.md` 与 `docs/skills/*/SKILL.md` 是否一致。

## 维护 SOP（非破坏性）

1. **新增**：同一逻辑重复 ≥3 次 / 跨文件复用 / 同类问题反复 → 抽离为新 skill（frontmatter 含精准 description；正文要点优先）。
2. **修改**：与当前实践不符时更新；保持 name/description 稳定。
3. **合并**：重复/近重复 skill 合并；**合并前将被合并方原文移入 `_archive/`**。
4. **精简**：超体积 skill 删冗余、长示例改要点 + 指针。
5. **归档**：不再适用或已合并的 skill 移入 `_archive/<name>/`（非删除）。
6. **清理**：仅归档满 30 天且无引用才允许物理删除。

## 变更报告

每次重梳理后在 `CURATOR_REPORT.md` 追加：

```markdown
## YYYY-MM-DD（触发源: session-start | compaction | feature | manual）
- 新增: skill-a（原因）
- 合并: skill-b → skill-a（skill-b 原文移入 _archive/）
- 归档: skill-c（原因）
- 精简: skill-d（体积 X→Y KB）
- 更新: .curator-state.json lastFullReorg=YYYY-MM-DD
```

## 完成动作

1. 执行上述 SOP；
2. 更新 `.curator-state.json` 的 `lastFullReorg` 为当前日期 ISO；
3. 追加 `CURATOR_REPORT.md`；
4. 向用户输出本次变更摘要。

## 开发执行约束（复用优先）

- 编码前先检索【项目Skill库】：有匹配生效 Skill 直接复用，禁止重写相同逻辑，只写业务适配层。
- 不满足时优先「少量适配」>「更新已有 Skill」>「新增 Skill」；完成编码后同步更新库。
- 不要过度抽象：不为提取而拆分简单一次性逻辑。

## 每轮输出流程

1. 先处理用户本次实际开发需求，输出代码、修改方案；
2. 完成代码处理后，扫描本次新增/变更代码，更新 Skill 库（识别/新增/修改/废弃）；
3. 输出更新后的完整【项目Skill库】索引表；
4. 简短说明本次 Skill 变更摘要（无变更写「本轮无新增/变更Skill」）。

## 注意

- 自身也是 `docs/skills/` 下的一个 skill，接受自身治理（Hook 扫描已纳入自身、仅排除 `_archive/`）。既有 28 个 skill 仍位于 `.claude/skills/`（Claude 原生发现），不属于本库扫描范围。
- 不触碰 `src/`（Electron 代码）。
- 若既有 `skill-factory` 有相关命令，优先复用、避免重复建设。
- 状态「已废弃」= 保留记录不删除（非破坏性）。
