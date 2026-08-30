---
name: skill-curator
description: 维护本仓库 Skill 库的自适应管家（Skill Curator）。触发场景：用户说"重梳理 skills / 整理 skill 库 / curator"；或会话开始 Hook 检测摘要报告异常、上下文压缩后、功能/阶段完成时，需要评估技能库时。
---

# skill-curator —— 本仓库 Skill 库自适应维护

## 职责

你是本仓库 `.claude/skills/` 技能库的维护者。**权威文档是 `docs/prompts/skill-curator-prompt.md`（通用提示词）**；本技能是其在本仓库的实例化，补充具体路径与执行约定。

## 本仓库路径

- `SKILL_ROOT` = `.claude/skills/`
- 状态文件 = `.claude/skills/.curator-state.json`（`lastFullReorg` / `lastCheck`）
- 变更报告 = `.claude/skills/CURATOR_REPORT.md`
- 归档目录 = `.claude/skills/_archive/`

## 触发检查

运行：`node .claude/skills/skill-curator/scripts/curator-check.mjs`
- SessionStart Hook 自动运行并注入摘要；上下文压缩后或需要时手动运行。
- 摘要异常（重复候选 / 缺 description / 超 30 天未重梳理）→ 执行全盘重梳理。

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

## 注意

- 自身也是 `.claude/skills/` 下的一个 skill，接受自身治理（Hook 扫描已排除 `skill-curator` 与 `_archive/`）。
- 不触碰 `src/`（Electron 代码）。
- 若既有 `skill-factory` 有相关命令，优先复用、避免重复建设。
