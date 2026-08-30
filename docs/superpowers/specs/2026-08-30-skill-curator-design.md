# 设计：Skill 自适应维护系统（skill-curator）—— AI 编程助手通用提示词

对应需求：**AI 编程助手通用提示词：动态提取 & 维护可复用 Skill（Vibe Coding / Claude Code / Codex）**。

目标：让任意 AI 编程助手在 **Vibe Coding 模式下自主维护一个可复用 Skill 库**——自动识别、新增、修改、合并、精简、归档 Skill，**无需开发者手动发指令**；AI 自主判断何时做全盘重梳理。降低 token 消耗，提升开发效率。

核心：Skill 库**动态自适应迭代**，不是一次性提取。

---

## 1. 背景与动机

- 本仓库已有 `skill-factory` skill（`.claude/skills/skill-factory/SKILL.md`）：对话内触发式抽离 + 命令驱动优化（Skill Commander `/skills` 命令、Skill Optimizer）。但**全盘重梳理必须用户发命令**（如 `/skills optimize`），且是项目内技能，不跨工具。
- 新需求的增量是：
  1. **AI 自主判断何时全盘重梳理**（不靠开发者手动发指令）；
  2. **通用可移植提示词**（一份提示词，可贴入 Claude Code 的 `CLAUDE.md` / Codex 的 `AGENTS.md` / 任意 Vibe Coding 工具）。

## 2. 目标与非目标

**目标**
- 产出一份**工具无关的通用提示词**，使任何 AI 编程助手以"Skill Curator"身份常驻维护一个 Skill 库。
- 在本仓库落地实例：`skill-curator` skill + SessionStart Hook + `CLAUDE.md` 常驻命令。
- 非破坏性自治：新增/修改/合并/精简/归档全自主；物理删除必须先归档且满期无引用。
- 自动触发全盘重梳理：会话开始（Hook 强制检查）、上下文压缩后、功能/阶段完成时。

**非目标**
- 不设 token 硬约束指标（如每 skill 体积上限、每类目数量上限）——本版仅内置"描述优先、正文按需读"惯例；用户可后续追加约束。
- 不按"累计 N 个变更"触发（用户未选）。
- 不改动 Electron 应用代码（不触碰 `src/`）；纯文档 + `.claude/` 配置交付。

## 3. 关键决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 交付物形态 | **通用提示词文档 + `skill-curator` Skill 实例 + Claude Code SessionStart Hook** |
| 2 | 安全边界 | **非破坏性自治**：删除前必先归档；归档满 30 天且无引用才可清理 |
| 3 | 触发信号 | **会话开始（Hook 强制检查）+ 上下文压缩后 + 功能/阶段完成时**（用户未选"累计 N 个变更"） |
| 4 | token 约束 | **暂不硬约束**；内置描述优先/渐进式披露惯例 |
| 5 | 检测状态来源 | **派生式**：不维护手写清单；Hook 每次实时扫描 skill 目录 frontmatter；仅一个 `.curator-state.json` 记录 `lastCheck`/`lastFullReorg` |

**核心洞察**：AI 只在回合内行动。"自动触发" = ① Hook 把确定性检测结果注入每个会话开始；② 提示词把"何时重梳理"的裁量权交给 AI（压缩后/功能完成时自行决定）。Hook 负责检测，AI 负责梳理。

## 4. 总体架构

```
docs/prompts/skill-curator-prompt.md   ← 通用提示词（可移植核心，工具无关，可贴入 CLAUDE.md/AGENTS.md/任意 Vibe 工具）
        │ 实例化
        ▼
.claude/skills/skill-curator/
   ├── SKILL.md                        ← 本仓库执行实例（SOP 实体化，frontmatter 触发词）
   └── scripts/curator-check.mjs       ← SessionStart Hook 脚本（Node 内置 API，零依赖）
        │ 挂载
        ▼
.claude/settings.json  hooks.SessionStart   ← 每会话强制注入检测摘要
.claude/CLAUDE.md                            ← 精简常驻命令 + 指向通用提示词全文
```

**触发回路**
- **会话开始**：Hook 运行 `curator-check.mjs` → 扫描 `SKILL_ROOT/*/SKILL.md` → 摘要注入上下文 → 若摘要报"重复候选/超体积/缺描述/过久未重梳理"→ AI 自主决定是否当场重梳理。
- **上下文压缩后**：AI 重读 Hook 摘要自行判断；若摘要已不在上下文，可**手动重跑检查脚本**（`node .claude/skills/skill-curator/scripts/curator-check.mjs`）重新获得当前状态后判断——Hook 仅在会话开始自动跑，脚本本身随时可执行。
- **功能/阶段完成时**：AI 顺手把该功能可复用部分抽离为新 skill 并重梳理相关类目。

## 5. 通用提示词内容（核心交付物 `docs/prompts/skill-curator-prompt.md`）

工具无关，`SKILL_ROOT` 参数化（默认 `.claude/skills/`，可替换为任意助手技能目录）。

**文档章节（6 节）**

1. **身份与常驻职责**：你是该技能库的维护者（Skill Curator）。每个会话中持续识别可复用模式并维护技能库，但**不打断主任务**——识别后先记下，在触发点统一处理。
2. **检测规则**（重梳理前自查）
   - 重复：`name` 近似、`description` 高度相似（同时出现核心短语）的 Skill 配对。
   - 超体积：SKILL.md 正文明显过长（经验阈值 >8KB 提示，不强制）。
   - 缺描述：frontmatter 无 `description` 或描述空泛（无法用于检索）。
   - 陈旧：距上次全盘重梳理超过 30 天。
3. **维护 SOP**（识别 → 新增 → 修改 → 合并 → 精简 → 归档）
   - **新增**：同一逻辑重复 ≥3 次、跨文件复用、同类问题反复出现 → 抽离为 Skill；有标准结构模板。
   - **修改**：skill 内容与当前实践不符时更新，保持 `name`/`description` 稳定。
   - **合并**：重复/近重复 skill 合并；**合并前把被合并方原文移入 `_archive/`**。
   - **精简**：超体积 skill 删冗余、把长代码示例改为要点 + 指针；正文按需读。
   - **归档**：不再适用或已被合并的 skill 移入 `SKILL_ROOT/_archive/<name>/`（非删除）。
   - **清理**：仅归档满 30 天且无引用（无调用、无报告提及）才允许物理删除。
4. **自主触发条件**：会话开始 Hook 摘要异常 / 上下文压缩后 / 功能阶段完成时。触发即按 SOP 执行全盘重梳理。
5. **变更报告**：每次重梳理在 `SKILL_ROOT/CURATOR_REPORT.md` 追加条目（新增/合并/精简/归档了什么、为什么、如何回滚），保证人类可审计、可恢复。
6. **token 节俭惯例**：描述优先——维护索引时只读 `description`；正文仅在执行该 skill 时加载；合并/精简以"同功能更低 token 达成"为准绳（本版不设硬指标）。

## 6. Hook 设计（`.claude/skills/skill-curator/scripts/curator-check.mjs`）

- **运行时**：Node 22 内置 `fs`/`path`，零依赖。命令：`node .claude/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]`（参数缺省用 `.claude/skills/`）。
- **扫描**：`SKILL_ROOT/*/SKILL.md` 的 frontmatter（`name`/`description`）+ 文件字节数；排除 `SKILL_ROOT/_archive/` 与自身（`skill-curator`）。
- **状态**：读写 `SKILL_ROOT/.curator-state.json`：
  ```json
  { "lastFullReorg": "2026-08-30T00:00:00.000Z", "lastCheck": "2026-08-30T00:00:00.000Z" }
  ```
  - 每次运行更新 `lastCheck`；`lastFullReorg` 由 skill-curator 重梳理时写入（初始为 `null` → 文案显示"从未"）。
- **输出**（stdout 注入会话上下文；异常与正常均输出，但正常时仅一行）：
  ```
  【skill-curator 检测】28 个 SKILL.md · 总大小 412 KB · 距上次全盘重梳理 18 天
  - 最大: diagram-generator (52 KB)、resume-optimizer (38 KB)、xlsx (31 KB)
  - 重复候选: a↔b（description 均含 "xx"）; c↔d
  - 缺 description: （无）
  - 建议: 无需处理  /  建议合并 a↔b  /  已超 30 天，建议全盘重梳理
  ```
- **detection 规则**（脚本内实现）：
  - 重复候选：两两比较 `name` 的编辑距离 ≤2 或共享 `description` 中长度 ≥6 的相同中文短语/≥12 的相同英文单词序列。
  - 超体积：单文件 >8KB 记入"最大"列表（仅展示，不阻塞）。
  - 缺描述：无 `description` 或长度 <8。
  - 陈旧：`now - lastFullReorg > 30d`。

## 7. skill-curator SKILL.md（本仓库执行实例）

- frontmatter：
  ```yaml
  name: skill-curator
  description: 维护本仓库 Skill 库的自适应管家。触发场景：用户说"重梳理 skills / 整理 skill 库 / curator"；或会话开始 Hook 摘要报异常、上下文压缩后、功能/阶段完成时，需要评估技能库时。
  ```
- 正文结构：
  1. 一句话职责 + 指向 `docs/prompts/skill-curator-prompt.md`（通用提示词全文是权威）。
  2. 本仓库具体路径：`SKILL_ROOT = .claude/skills/`、状态 `.claude/skills/.curator-state.json`、报告 `.claude/skills/CURATOR_REPORT.md`、归档 `.claude/skills/_archive/`。
  3. 执行 SOP（照 §5-3）：新增/修改/合并/精简/归档，非破坏性约定。
  4. 触发检查：`node .claude/skills/skill-curator/scripts/curator-check.mjs`。
  5. 变更报告格式（追加到 `CURATOR_REPORT.md`）：
     ```
     ## YYYY-MM-DD（触发源: session-start | compaction | feature | manual）
     - 新增: skill-a（原因）
     - 合并: skill-b → skill-a（skill-b 原文移入 _archive/）
     - 归档: skill-c（原因）
     - 精简: skill-d（体积 X→Y KB）
     - 更新: .curator-state.json lastFullReorg=YYYY-MM-DD
     ```
  6. 完成动作：更新 `lastFullReorg`、追加报告、输出摘要给用户。

## 8. CLAUDE.md 常驻命令（`.claude/CLAUDE.md`，现为空 → 写入）

```markdown
# 项目指引

- 本仓库的 AI 编程助手同时担任「Skill Curator」：遵循 `docs/prompts/skill-curator-prompt.md`（通用提示词，权威）。
- 会话开始时若 SessionStart Hook 注入的 skill-curator 检测摘要报告异常（重复候选 / 缺描述 / 超 30 天未重梳理），**自主执行一次全盘重梳理**，无需用户下令。
- 上下文压缩后、或某功能/阶段完成时，评估是否有可抽离的复用模式并重梳理相关 Skill 类目。
- 维护动作遵循非破坏性约定：合并/归档前原文移入 `.claude/skills/_archive/`，每次重梳理追加 `.claude/skills/CURATOR_REPORT.md`。
```

CLAUDE.md 只放常驻命令，全文在 `docs/prompts/`——这本身演示了"描述优先、正文按需读"。

## 9. 与 skill-factory 的关系

- **共存，不合并**：`skill-factory` 保留命令式管理（Skill Commander `/skills` 命令、Skill Optimizer、config.json）；`skill-curator` 是自主层。
- 通用提示词注明："若检测到既有 skill-factory，合并其优化结果、复用其命令，避免重复建设。"
- skill-curator 自身也是 `.claude/skills/` 下的一个 skill，接受自身治理（self-maintenance 允许，但 `_archive/` 排除于 Hook 扫描）。

## 10. 交付物清单

| 路径 | 动作 | 说明 |
|------|------|------|
| `docs/prompts/skill-curator-prompt.md` | 新增 | 通用提示词（核心交付物，工具无关） |
| `.claude/skills/skill-curator/SKILL.md` | 新增 | 本仓库执行实例 |
| `.claude/skills/skill-curator/scripts/curator-check.mjs` | 新增 | SessionStart Hook 脚本（零依赖） |
| `.claude/CLAUDE.md` | 修改（现为空） | 常驻命令 + 指向通用提示词 |
| `.claude/settings.json` | 修改 | 加 `hooks.SessionStart` |
| `docs/superpowers/specs/2026-08-30-skill-curator-design.md` | 新增 | 本设计文档 |

**不改动**：`src/`（Electron 代码）、`.claude/skills/skill-factory/`、既有 28 个 skill 内容。

## 11. 验收标准

- [ ] 新开 Claude Code 会话：SessionStart Hook 注入 skill-curator 检测摘要；正常时一行提醒，异常时列出候选。
- [ ] 人为制造重复描述/缺描述/超 30 天未重梳理：Hook 摘要正确报出候选。
- [ ] 对用户说"整理 skill 库"（或会话开始摘要异常）→ AI 自主执行非破坏性重梳理 → 追加 `CURATOR_REPORT.md` → 归档内容在 `_archive/` 可恢复 → `.curator-state.json` 的 `lastFullReorg` 更新。
- [ ] `node .claude/skills/skill-curator/scripts/curator-check.mjs` 手动运行无错误、输出符合格式。
- [ ] 全流程除首次安装外无需任何人工命令触发。
- [ ] `git status` 只含本设计交付物改动。

## 12. 回滚与数据安全

- **非破坏性**：任何合并/精简/归档都在 `_archive/` 保留原文；物理删除仅限满 30 天且无引用。
- 每次重梳理写入 `CURATOR_REPORT.md`，含"如何回滚"说明。
- Hook 脚本只读 `SKILL_ROOT`（除更新 `.curator-state.json` 外无写操作）；真正的梳理动作由 AI 按 SOP 执行，全程可审计。
