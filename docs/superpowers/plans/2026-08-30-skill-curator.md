# Skill 自适应维护系统（skill-curator）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任意 AI 编程助手以「Skill Curator」身份自主维护可复用 Skill 库——AI 自主判断何时全盘重梳理，无需人工命令。交付：通用提示词 + 本仓库 skill-curator Skill 实例 + SessionStart Hook。

**Architecture:** 三件交付物。① `docs/prompts/skill-curator-prompt.md`（工具无关通用提示词，可移植核心）；② `.claude/skills/skill-curator/`（本仓库执行实例：`SKILL.md` + 零依赖 Node Hook 脚本）；③ `.claude/settings.json` 挂载 `SessionStart` Hook + `.claude/CLAUDE.md` 常驻命令。Hook 每会话开始扫描 skill 目录生成检测摘要注入上下文；摘要异常时 AI 按 SOP 自主重梳理，非破坏性（归档可恢复）。

**Tech Stack:** 纯文档 + `.claude/` 配置；Hook 脚本用 Node 22 内置 `fs`/`path`，零依赖。不触碰 Electron 代码。

## Global Constraints

- 纯文档 + `.claude/` 配置交付；**不改动** `src/`（Electron 代码）、`.claude/skills/skill-factory/`、既有 28 个 skill 的内容（位置与内容均不动）。
- **技能库根 = `docs/skills/`**（用户需求变更：skills 不入传统 `.agents`/`.claude`，作为文档资产放 docs 下）。既有 28 个仍留 `.claude/skills/`（Claude 原生发现，curator 不扫描）；skill-curator 自身迁入 `docs/skills/skill-curator/`。触发条件不变。
- **Skill 库形态 = SKILL.md 文档 + 表索引**（用户需求变更 2）：代码级可复用单元（工具函数/组件模板/校验规则/通用流程等）也落 `SKILL_ROOT/<name>/SKILL.md`（正文含 输入参数/输出结果/使用约束/示例调用/状态，实际实现留在 `src/` 等原处、文档指向其接口）；`SKILL_ROOT/SKILL-LIBRARY.md` 为 8 列【项目Skill库】索引表（统一每轮输出格式）。
- 通用提示词**工具无关**：正文不出现 Claude Code 专属操作词（工具名仅允许在「适配说明」小节出现）。
- Hook 脚本**零依赖**（仅 Node 内置 API）；Node 22。
- **非破坏性**：任何合并/精简/归档都在 `_archive/` 保留原文；物理删除仅限归档满 30 天且无引用。**脚本内不含任何删除逻辑**。
- 中文提示/文案。
- `.curator-state.json` schema：`{ "lastFullReorg": string|null, "lastCheck": string }`（ISO 时间；初始 `lastFullReorg: null`，文案显示「从未」）。
- Hook 扫描排除 `_archive/`；skill-curator 自身纳入扫描（docs 库初始仅含自身时，摘要如实报「1 个 SKILL.md」，而非 0 个）。
- commit message 必须以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。

---

### Task 1: 通用提示词 `docs/prompts/skill-curator-prompt.md`（核心交付物）

**Files:**
- Create: `docs/prompts/skill-curator-prompt.md`

**Interfaces:**
- Produces: 通用提示词全文。Task 3 的 `skill-curator/SKILL.md` 指向本文件为权威；Task 4 的 `CLAUDE.md` 指向本文件。

- [ ] **Step 1: 创建目录并写入提示词全文**

创建 `docs/prompts/` 目录，写入 `docs/prompts/skill-curator-prompt.md`，内容**逐字**如下：

```markdown
# AI 编程助手通用提示词：动态提取 & 维护可复用 Skill

> 用途：将本提示词粘贴进任意 AI 编程助手的指令文件（Claude Code 的 `CLAUDE.md`、Codex 的 `AGENTS.md`、其他 Vibe Coding 工具的指令区），即可让该助手以「Skill Curator」身份常驻维护一个可复用技能库。
> 目标技能库根目录记为 `SKILL_ROOT`（默认 `.claude/skills/`；跨工具替换为对应技能目录）。`SKILL_ROOT` 下每个技能为一个子目录，内含 `SKILL.md`，frontmatter 含 `name` 与 `description`。

## 1. 身份与常驻职责

你是本技能库的维护者（Skill Curator）。每个会话中持续识别可复用模式并维护技能库，但**不打断主任务**——识别后先记下，在触发点统一处理。你的长期目标是更精简、更内聚、检索更准的技能库。

## 2. 检测规则（重梳理前自查）

- **重复**：`name` 近似、`description` 高度相似（同时出现核心短语）的技能配对。
- **超体积**：SKILL.md 正文明显过长（经验阈值 8KB，仅提示不强制）。
- **缺描述**：frontmatter 无 `description` 或描述空泛（无法用于检索）。
- **陈旧**：距上次全盘重梳理超过 30 天。

## 3. 维护 SOP

识别 → 新增 → 修改 → 合并 → 精简 → 归档，全程**非破坏性**：

- **新增**：同一逻辑重复出现 ≥3 次、跨文件复用、同类问题反复出现时，抽离为新技能；遵循既有标准结构（frontmatter 含精准 `description`，正文要点优先）。
- **修改**：技能内容与当前实践不符时更新；保持 `name`/`description` 稳定，避免破坏既有引用。
- **合并**：重复/近重复技能合并；**合并前将被合并方原文移入 `SKILL_ROOT/_archive/`**。
- **精简**：超体积技能删冗余、把长示例改为要点 + 指针；正文按需读。
- **归档**：不再适用或已被合并的技能移入 `SKILL_ROOT/_archive/<name>/`（非删除）。
- **清理**：仅归档满 30 天且无引用（无调用、无报告提及）才允许物理删除；否则一律保留在 `_archive/`。

## 4. 自主触发条件

以下任一情形，自主执行一次全盘重梳理（按 §3 SOP，无需用户下令）：

- 会话开始时的检测摘要报告异常（重复候选 / 缺描述 / 超 30 天未重梳理）；
- 上下文压缩后；
- 某功能或阶段完成时。

## 5. 变更报告

每次重梳理后，在 `SKILL_ROOT/CURATOR_REPORT.md` 追加条目（新增/合并/精简/归档了什么、为什么、如何回滚），并更新重梳理时间戳。保证人类可审计、可恢复。

## 6. token 节俭惯例

- **描述优先**：维护索引时只读各技能 `description`，不整篇加载正文。
- **正文按需读**：仅在执行某技能时加载其正文。
- **合并/精简目标**：同功能以更低 token 达成（本版不设硬指标）。

## 适配说明（各工具粘贴位置）

| 工具 | 粘贴位置 |
|------|----------|
| Claude Code（项目级） | `.claude/CLAUDE.md` |
| Claude Code（全局） | `~/.claude/CLAUDE.md` |
| Codex | `AGENTS.md`（项目根） |
| 其他 Vibe Coding 工具 | 对应指令/系统提示区 |

> 若环境存在既有技能管理机制（如 skill-factory 的命令式管理），优先复用其命令、合并其检测结果，避免重复建设。
```

- [ ] **Step 2: 验证内容完整**

Run:
```bash
cd "E:/monorepo/my-pc"
for s in "## 1. 身份与常驻职责" "## 2. 检测规则" "## 3. 维护 SOP" "## 4. 自主触发条件" "## 5. 变更报告" "## 6. token 节俭惯例" "## 适配说明"; do grep -qF "$s" docs/prompts/skill-curator-prompt.md || echo "缺失章节: $s"; done
```
Expected: 无「缺失章节」输出。正文不得出现 `hook`/`SessionStart`/`CLAUDE.md 专属` 等工具绑定词（适配说明表内除外）。

- [ ] **Step 3: 提交**

```bash
git add docs/prompts/skill-curator-prompt.md
git commit -m "feat(skill-curator): 通用提示词文档（可移植核心，工具无关）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: SessionStart Hook 脚本 `curator-check.mjs`

**Files:**
- Create: `.claude/skills/skill-curator/scripts/curator-check.mjs`
- Modify: `.gitignore`（追加忽略 `.curator-state.json`，避免每次会话制造脏状态）

**Interfaces:**
- Produces: `node .claude/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]` —— 扫描、输出检测摘要、更新 `.curator-state.json` 的 `lastCheck`。Task 4 以 SessionStart Hook 挂载此命令。

- [ ] **Step 1: 创建脚本**

写入 `.claude/skills/skill-curator/scripts/curator-check.mjs`，内容**逐字**如下：

```js
#!/usr/bin/env node
// skill-curator 检测脚本：扫描 SKILL_ROOT/*/SKILL.md，输出检测摘要并更新状态。
// 零依赖（Node 22 内置 fs/path）。作为 SessionStart Hook 挂载；亦可手动运行。
// 用法: node .claude/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const SKILL_ROOT = process.argv[2] ?? '.claude/skills'
const STATE_FILE = path.join(SKILL_ROOT, '.curator-state.json')
const MAX_SIZE_BYTES = 8 * 1024
const STALE_DAYS = 30

function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      lastFullReorg: typeof data.lastFullReorg === 'string' ? data.lastFullReorg : null,
      lastCheck: typeof data.lastCheck === 'string' ? data.lastCheck : null
    }
  } catch {
    return { lastFullReorg: null, lastCheck: null }
  }
}

function writeState(state) {
  fs.mkdirSync(SKILL_ROOT, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function parseFrontmatter(text) {
  // 兼容 CRLF 行尾（部分 skill 文件为 Windows 换行），统一为 \n 再解析
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r/g, ''))
  if (!m) return { name: '', description: '' }
  let name = ''
  let description = ''
  let descPending = false
  for (const line of m[1].split('\n')) {
    const n = /^name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line)
    if (n) name = n[1].trim()
    if (descPending) {
      if (/^\s/.test(line)) {
        description = description ? `${description} ${line.trim()}` : line.trim()
        continue
      }
      descPending = false
    }
    const d = /^description:\s*(.*)$/.exec(line)
    if (d) {
      description = d[1].trim().replace(/^["']|["']$/g, '')
      // YAML 块标量（description: 后跟 | / |- / > 等或空值）：后续缩进行均为描述内容
      if (description === '' || /^[|>][-+]?$/.test(description)) {
        description = ''
        descPending = true
      }
    }
  }
  return { name, description }
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)])
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

// 返回两 description 共享的核心短语（≥6 中文字符串 或 ≥12 字符英文词序列）；无则 null
function sharedPhrase(da, db) {
  const ca = da.replace(/[^\u4e00-\u9fff]/g, ' ')
  const cb = db.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const run of ca.split(' ').filter((s) => s.length >= 6)) {
    if (cb.includes(run)) return run
  }
  const ea = da.replace(/[^a-zA-Z0-9 -]/g, ' ')
  const eb = db.replace(/[^a-zA-Z0-9 -]/g, ' ')
  const toks = ea.split(' ').filter((t) => t.length > 0)
  for (let i = 0; i < toks.length; i++) {
    let seq = ''
    for (let j = i; j < toks.length; j++) {
      seq = seq ? `${seq} ${toks[j]}` : toks[j]
      if (seq.length >= 12 && eb.includes(seq)) return seq
    }
  }
  return null
}

// 返回重复候选描述；不重复则 null
function dupInfo(a, b) {
  if (levenshtein(a.name, b.name) <= 2) return 'name 近似'
  const phrase = sharedPhrase(a.description, b.description)
  if (phrase) return `desc 含 "${phrase}"`
  return null
}

function main() {
  if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
    console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  const dirs = fs.readdirSync(SKILL_ROOT, { withFileTypes: true })
    .filter((d) => d.name !== '_archive' && d.name !== 'skill-curator')
    .map((d) => d.name)
    .filter((name) => fs.statSync(path.join(SKILL_ROOT, name)).isDirectory())
    .sort()

  const skills = []
  let totalBytes = 0
  for (const dir of dirs) {
    const file = path.join(SKILL_ROOT, dir, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const { name, description } = parseFrontmatter(text)
    const bytes = Buffer.byteLength(text, 'utf8')
    totalBytes += bytes
    skills.push({ dir, name, description, bytes })
  }

  const now = Date.now()
  writeState({ lastFullReorg: state.lastFullReorg, lastCheck: new Date(now).toISOString() })

  const big = skills.filter((s) => s.bytes > MAX_SIZE_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, 3)
  const dups = []
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const info = dupInfo(skills[i], skills[j])
      if (info) dups.push(`${skills[i].dir}↔${skills[j].dir}（${info}）`)
    }
  }
  const missing = skills.filter((s) => s.description.length < 8).map((s) => s.dir)

  let lastReorgText = '从未'
  let staleNote = ''
  if (state.lastFullReorg) {
    const days = Math.floor((now - new Date(state.lastFullReorg).getTime()) / 86400000)
    lastReorgText = `${Math.max(0, days)} 天前`
    if (days > STALE_DAYS) staleNote = '已超 30 天未全盘重梳理'
  }

  const kb = (totalBytes / 1024).toFixed(1)
  const header = `【skill-curator 检测】${skills.length} 个 SKILL.md · 总大小 ${kb} KB · 距上次全盘重梳理 ${lastReorgText}`

  const advices = []
  for (const d of dups) advices.push(`建议合并 ${d.split('（')[0]}`)
  for (const mm of missing) advices.push(`建议补充 description: ${mm}`)
  if (staleNote) advices.push('建议全盘重梳理')

  if (advices.length === 0 && big.length === 0) {
    console.log(`${header} · 建议: 无需处理`)
    return
  }
  const parts = [header]
  if (big.length) parts.push(`- 最大: ${big.map((s) => `${s.dir} (${(s.bytes / 1024).toFixed(1)} KB)`).join('、')}`)
  if (dups.length) parts.push(`- 重复候选: ${dups.join('、')}`)
  if (missing.length) parts.push(`- 缺 description: ${missing.join('、')}`)
  parts.push(`- 建议: ${advices.join('；')}`)
  console.log(parts.join('\n'))
}

main()
```

- [ ] **Step 2: 手动运行（真实库，正常路径）**

Run:
```bash
cd "E:/monorepo/my-pc" && node .claude/skills/skill-curator/scripts/curator-check.mjs
```
Expected:
- 输出以 `【skill-curator 检测】` 开头（正常时一行含「建议: 无需处理」，有超 8KB 技能时含 `- 最大:` 行）。
- 生成 `.claude/skills/.curator-state.json`，内容形如 `{ "lastFullReorg": null, "lastCheck": "<ISO>" }`。

- [ ] **Step 3: 手动运行（非法根目录）**

Run:
```bash
cd "E:/monorepo/my-pc" && node .claude/skills/skill-curator/scripts/curator-check.mjs /nonexistent_root; echo "exit=$?"
```
Expected: stderr 输出 `[skill-curator] SKILL_ROOT 不存在或不是目录: /nonexistent_root`，`exit=1`。

- [ ] **Step 4: 制造重复候选 + 缺描述（临时目录，测完即删）**

Run:
```bash
cd "E:/monorepo/my-pc"
mkdir -p .claude/skills/__tmp_dup__
cat > .claude/skills/__tmp_dup__/SKILL.md <<'EOF'
---
name: diagram-generator-dup
description: 根据所给资料生成思维导图，用于图表与思维导图输出
---
正文略
EOF
mkdir -p .claude/skills/__tmp_nodesc__
cat > .claude/skills/__tmp_nodesc__/SKILL.md <<'EOF'
---
name: no-description-test
---
正文略
EOF
node .claude/skills/skill-curator/scripts/curator-check.mjs
rm -rf .claude/skills/__tmp_dup__ .claude/skills/__tmp_nodesc__
```
Expected: 输出包含 `重复候选:`（含 `__tmp_dup__↔diagram-generator` 或 `__tmp_dup__↔resume-optimizer` 等——凡 description 共享 ≥6 中文短语者）与 `缺 description: __tmp_nodesc__`。临时目录已删除。

- [ ] **Step 5: 验证恢复后为正常输出**

Run:
```bash
cd "E:/monorepo/my-pc" && node .claude/skills/skill-curator/scripts/curator-check.mjs
```
Expected: 恢复到 Step 2 基线——`重复候选:` 仍可含真实库样板短语产生的候选（如「即便没有明说」「use this skill」等，属已知启发式噪音，deferred Minor M2，不得为消除它修改既有 skill）；`缺 description:` 不应再含 `skill-factory`（引号解析已修复）。

- [ ] **Step 6: `.gitignore` 追加忽略状态文件**

在 `.gitignore` 末尾追加：

```gitignore

# skill-curator 运行时状态
.claude/skills/.curator-state.json
```

- [ ] **Step 7: 提交**

```bash
git add .claude/skills/skill-curator/scripts/curator-check.mjs .gitignore
git commit -m "feat(skill-curator): SessionStart 检测脚本（零依赖）+ 忽略运行时状态
Co-Authored-By: Claude <noreply@anthropic.com>"
```

**计划修订（用户裁定，修复环 R1，提交 416f675）：** 简报原逐字脚本含两个真实缺陷，评审标为 plan-mandated Important，用户裁定「修复脚本 + 修正计划」：
1. `parseFrontmatter` 遇描述内引号截断 → 误报缺 description（skill-factory）。修复：取 `description:` 后整行剥外层引号 + CRLF 归一化 + YAML 块标量续行收集（实现过程中另发现 CRLF 行尾破坏 `^---\n`、`claude-api`/`vercel-composition-patterns` 用块标量，一并修复）。
2. `d.isDirectory()` 拒绝符号链接目录 → 本机 21/28 漏扫。修复：`fs.statSync(...).isDirectory()` 跟随符号链接。
3. Step 4 临时 fixture 描述已改为与真实 `diagram-generator` 共享 ≥6 中文串的版本；Step 5 期望已修正（真实库样板短语噪音为 deferred Minor M2，不得修改既有 skill 消除）。
最终脚本以 `.claude/skills/skill-curator/scripts/curator-check.mjs`（提交 416f675）为准。

---

### Task 3: skill-curator SKILL.md（本仓库执行实例）

**Files:**
- Create: `.claude/skills/skill-curator/SKILL.md`

**Interfaces:**
- Consumes: Task 1 通用提示词（权威）、Task 2 脚本路径。
- Produces: 可供 AI 按需/自动调用的执行实例（frontmatter description 含触发词）。Task 5 用它做端到端验证。

- [ ] **Step 1: 写入 SKILL.md**

写入 `.claude/skills/skill-curator/SKILL.md`，内容**逐字**如下：

```markdown
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
```

- [ ] **Step 2: 验证 frontmatter 与关键节**

Run:
```bash
cd "E:/monorepo/my-pc"
node -e "const fs=require('fs');const t=fs.readFileSync('.claude/skills/skill-curator/SKILL.md','utf8');const m=/^---\n([\s\S]*?)\n---/.exec(t);if(!m)throw Error('无 frontmatter');const fm=m[1];for(const k of ['name:','description:'])if(!fm.includes(k))throw Error('缺 '+k);console.log('frontmatter OK');"
for s in "## 职责" "## 本仓库路径" "## 触发检查" "## 维护 SOP" "## 变更报告" "## 完成动作" "## 注意"; do grep -qF "$s" .claude/skills/skill-curator/SKILL.md || echo "缺失: $s"; done
```
Expected: 输出 `frontmatter OK`，无「缺失」行。

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/skill-curator/SKILL.md
git commit -m "feat(skill-curator): 本仓库执行实例 SKILL.md（SOP 实体化，非破坏性）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 接入本仓库（CLAUDE.md + settings.json SessionStart Hook）

**Files:**
- Modify: `.claude/CLAUDE.md`（现为空文件 → 写入）
- Modify: `.claude/settings.json`（追加 `hooks.SessionStart`）

**Interfaces:**
- Consumes: Task 2 脚本路径（`curator-check.mjs`）、Task 1 提示词路径。
- Produces: 每会话自动加载的常驻命令 + 自动触发的 SessionStart Hook（本需求「无需人工命令」的落地）。

- [ ] **Step 1: 写入 `.claude/CLAUDE.md`**

写入 `.claude/CLAUDE.md`，内容**逐字**如下：

```markdown
# 项目指引

- 本仓库的 AI 编程助手同时担任「Skill Curator」：遵循 `docs/prompts/skill-curator-prompt.md`（通用提示词，权威）。
- 会话开始时若 SessionStart Hook 注入的 skill-curator 检测摘要报告异常（重复候选 / 缺描述 / 超 30 天未重梳理），**自主执行一次全盘重梳理**，无需用户下令。
- 上下文压缩后、或某功能/阶段完成时，评估是否有可抽离的复用模式并重梳理相关 Skill 类目。
- 维护动作遵循非破坏性约定：合并/归档前原文移入 `.claude/skills/_archive/`，每次重梳理追加 `.claude/skills/CURATOR_REPORT.md`。
```

- [ ] **Step 2: `.claude/settings.json` 追加 SessionStart Hook**

将 `.claude/settings.json` 改为：

```json
{
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/skills/skill-curator/scripts/curator-check.mjs"
          }
        ]
      }
    ]
  }
}
```

（保留原有 `enabledPlugins` 不动，仅追加 `hooks` 键。）

- [ ] **Step 3: 验证 JSON 合法 + CLAUDE.md 就位**

Run:
```bash
cd "E:/monorepo/my-pc"
node -e "const s=require('./.claude/settings.json');if(!s.hooks||!s.hooks.SessionStart||!Array.isArray(s.hooks.SessionStart))throw Error('hooks.SessionStart 缺失');console.log('settings.json 合法，SessionStart hook 就位');"
grep -q "skill-curator" .claude/CLAUDE.md && echo "CLAUDE.md 已含 skill-curator 命令" || echo "CLAUDE.md 缺 skill-curator"
```
Expected: `settings.json 合法，SessionStart hook 就位` 与 `CLAUDE.md 已含 skill-curator 命令`。

- [ ] **Step 4: 提交**

```bash
git add .claude/CLAUDE.md .claude/settings.json
git commit -m "feat(skill-curator): CLAUDE.md 常驻命令 + SessionStart Hook 接入
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 端到端验证 + 文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-skill-curator-design.md`（无——规格已含验收；本任务为验证）
- 若验证发现问题，就地修复。

**Interfaces:**
- Consumes: Task 1–4 全部产物。

- [ ] **Step 1: 全矩阵复跑 Hook 脚本**

Run:
```bash
cd "E:/monorepo/my-pc"
echo "--- 正常路径 ---"
node .claude/skills/skill-curator/scripts/curator-check.mjs
echo "exit=$?"
echo "--- 状态文件 ---"
cat .claude/skills/.curator-state.json 2>/dev/null || echo "(缺状态文件)"
```
Expected: 输出以 `【skill-curator 检测】` 开头且 exit=0；状态文件含 `lastCheck`。

- [ ] **Step 2: 触发词按需调用（skill-curator 可被调用）**

Run:
```bash
cd "E:/monorepo/my-pc"
node -e "const t=require('fs').readFileSync('.claude/skills/skill-curator/SKILL.md','utf8');const m=/^description:\s*([^\n]+)/m.exec(t.split('---')[1]||'');if(!m)throw Error('无 description');const d=m[1];for(const kw of ['重梳理','skill','curator']){if(!d.includes(kw))console.log('触发词缺失: '+kw)}console.log('触发词检查完成');"
```
Expected: `触发词检查完成`（无触发词缺失输出）。

**计划修订（Task 5 验证发现，提交 R5）：** 原命令正则 `^description:` 缺 `m` 标志——`t.split('---')[1]` 以 `\nname: …` 开头，`^`（无 `m`）只匹配字符串开头导致永远抛「无 description」。加 `m` 标志使 `^` 按行匹配后验证通过；SKILL.md 实际 description 含全部触发词（重梳理 / skill / curator）。

- [ ] **Step 3: 人工 E2E 清单（本次由控制器/用户在新会话验证，非本任务可自动）**

记录到实现完成备注，供用户执行：
1. 新开一个 Claude Code 会话 → SessionStart Hook 应注入 `【skill-curator 检测】` 摘要。
2. 对会话说「整理 skill 库」→ AI 应执行非破坏性重梳理、追加 `CURATOR_REPORT.md`、更新 `lastFullReorg`。
3. 验证归档内容可恢复（存在于 `.claude/skills/_archive/`）。

- [ ] **Step 4: 工作树洁净检查**

Run:
```bash
cd "E:/monorepo/my-pc"
git status --short
git log --oneline -6
```
Expected: `git status --short` 为空或仅含本计划交付物文件；`git log` 展示 4 个本计划提交（Task1–Task4）。

- [ ] **Step 5: 提交（若有修复）**

若有修复，`git add` 相应文件并提交；无则跳过。

---

### Task 6: 迁移技能库至 `docs/skills/` + 最终评审修复（I1/I2/M3/M5）

**触发源：** 用户需求变更（skills 不入传统 `.agents`/`.claude`，改放 `docs/skills/`，触发条件不变；AskUserQuestion 定案「仅新库迁移」）＋ 最终全分支评审（opus）裁决 "With fixes"。

**Files:**
- Move: `.claude/skills/skill-curator/` → `docs/skills/skill-curator/`（`git mv`）
- Modify: `docs/skills/skill-curator/scripts/curator-check.mjs`（默认根改 `docs/skills` + 去样板化 I1 + I/O 防护 I2 + 空 name 防护 M3 + 自身纳入扫描）
- Modify: `docs/skills/skill-curator/SKILL.md`（路径更新）
- Modify: `.claude/settings.json`（Hook 命令路径）
- Modify: `.claude/CLAUDE.md`（归档/报告路径）
- Modify: `.gitignore`（状态文件路径 → `docs/skills/`，兼容旧根）
- Modify: `docs/prompts/skill-curator-prompt.md`（M5 措辞 + SKILL_ROOT 默认 + §2 检测规则措辞）
- Modify: `docs/superpowers/specs/2026-08-30-skill-curator-design.md`（同步路径与检测规则）

**Interfaces:**
- Consumes: Task 1–5 产物（提示词、脚本、SKILL.md、CLAUDE.md、settings.json、.gitignore、spec）。
- Produces: 迁移后位于 `docs/skills/` 的完整实例；SessionStart Hook 仍每会话自动触发（触发条件不变）。

- [ ] **Step 1: `git mv` 目录**

Run:
```bash
cd "E:/monorepo/my-pc"
mkdir -p docs/skills
git mv .claude/skills/skill-curator docs/skills/skill-curator
```
Expected: `.claude/skills/skill-curator/` 消失；`docs/skills/skill-curator/{SKILL.md,scripts/curator-check.mjs}` 就位（git status 显示 rename）。

- [ ] **Step 2: 重写脚本（含 4 项修复）**

将 `docs/skills/skill-curator/scripts/curator-check.mjs` 整文件内容**逐字**替换为：

```js
#!/usr/bin/env node
// skill-curator 检测脚本：扫描 SKILL_ROOT/*/SKILL.md，输出检测摘要并更新状态。
// 零依赖（Node 22 内置 fs/path）。作为 SessionStart Hook 挂载；亦可手动运行。
// 用法: node docs/skills/skill-curator/scripts/curator-check.mjs [SKILL_ROOT]
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const SKILL_ROOT = process.argv[2] ?? 'docs/skills'
const STATE_FILE = path.join(SKILL_ROOT, '.curator-state.json')
const MAX_SIZE_BYTES = 8 * 1024
const STALE_DAYS = 30
const MAX_DUPS = 5 // 重复候选最多展示条数（防样板噪音刷屏）
const BOILERPLATE_FREQ = 3 // 共享短语出现在 ≥3 个 skill 视为样板，忽略
const FUNCTION_WORDS = new Set(
  'the a an this that these those when whenever should use uses used using user wants want wanted need needs needed ask asks asked for of to from with by or and in on at as is are was were be been it you your their we they if then also can could will would shall may might must not no nor all any each every into over under than so about which who whom what where how why both either neither until while because'.split(' ')
)

function readState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return {
      lastFullReorg: typeof data.lastFullReorg === 'string' ? data.lastFullReorg : null,
      lastCheck: typeof data.lastCheck === 'string' ? data.lastCheck : null
    }
  } catch {
    return { lastFullReorg: null, lastCheck: null }
  }
}

function writeState(state) {
  fs.mkdirSync(SKILL_ROOT, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function parseFrontmatter(text) {
  // 兼容 CRLF 行尾（部分 skill 文件为 Windows 换行），统一为 \n 再解析
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r/g, ''))
  if (!m) return { name: '', description: '' }
  let name = ''
  let description = ''
  let descPending = false
  for (const line of m[1].split('\n')) {
    const n = /^name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line)
    if (n) name = n[1].trim()
    if (descPending) {
      if (/^\s/.test(line)) {
        description = description ? `${description} ${line.trim()}` : line.trim()
        continue
      }
      descPending = false
    }
    const d = /^description:\s*(.*)$/.exec(line)
    if (d) {
      description = d[1].trim().replace(/^["']|["']$/g, '')
      // YAML 块标量（description: 后跟 | / |- / > 等或空值）：后续缩进行均为描述内容
      if (description === '' || /^[|>][-+]?$/.test(description)) {
        description = ''
        descPending = true
      }
    }
  }
  return { name, description }
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)])
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

// 提取 description 的全部候选短语：≥6 中文字符串 + ≥12 字符英文词序列（小写归一）
function extractPhrases(desc) {
  const text = desc.toLowerCase()
  const out = []
  for (const run of text.replace(/[^\u4e00-\u9fff]/g, ' ').split(' ').filter((s) => s.length >= 6)) {
    out.push(run)
  }
  const toks = text.replace(/[^a-z0-9 -]/g, ' ').split(' ').filter((t) => t.length > 0)
  for (let i = 0; i < toks.length; i++) {
    let seq = ''
    for (let j = i; j < toks.length; j++) {
      seq = seq ? `${seq} ${toks[j]}` : toks[j]
      if (seq.length >= 12) out.push(seq)
    }
  }
  return out
}

// 全局短语频率：某短语被几个 skill 的 description 共享（跨库样板检测）
function phraseFrequency(skills) {
  const freq = new Map()
  for (const s of skills) {
    const seen = new Set(extractPhrases(s.description))
    for (const p of seen) freq.set(p, (freq.get(p) ?? 0) + 1)
  }
  return freq
}

// 样板判定：全局出现 ≥3 个 skill，或短语内无内容词（全为功能词）。纯中文短语仅凭频率判样板。
function isBoilerplate(phrase, freq) {
  if ((freq.get(phrase) ?? 0) >= BOILERPLATE_FREQ) return true
  const words = phrase.split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return false
  return !words.some((w) => w.length >= 4 && !FUNCTION_WORDS.has(w))
}

// 返回重复候选描述；不重复则 null。共享短语取最长匹配（优先特指核心，而非功能词前缀）
function dupInfo(a, b, freq) {
  if (a.name && b.name && levenshtein(a.name, b.name) <= 2) return 'name 近似'
  const pa = new Set(extractPhrases(a.description))
  const pb = [...new Set(extractPhrases(b.description))]
  let best = null
  for (const p of pb) {
    if (pa.has(p) && !isBoilerplate(p, freq)) {
      if (!best || p.length > best.length) best = p
    }
  }
  if (best) return `desc 含 "${best}"`
  return null
}

function main() {
  if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
    console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  const dirs = fs.readdirSync(SKILL_ROOT, { withFileTypes: true })
    .filter((d) => d.name !== '_archive')
    .map((d) => d.name)
    .filter((name) => {
      // 悬空符号链接/无权限：try/catch 跳过，不让 SessionStart Hook 崩
      try {
        return fs.statSync(path.join(SKILL_ROOT, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()

  const skills = []
  let totalBytes = 0
  for (const dir of dirs) {
    const file = path.join(SKILL_ROOT, dir, 'SKILL.md')
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue // 不可读（权限/悬空链接）：跳过
    }
    const { name, description } = parseFrontmatter(text)
    const bytes = Buffer.byteLength(text, 'utf8')
    totalBytes += bytes
    skills.push({ dir, name, description, bytes })
  }

  const now = Date.now()
  try {
    writeState({ lastFullReorg: state.lastFullReorg, lastCheck: new Date(now).toISOString() })
  } catch {
    // 状态写入失败不阻塞检测摘要
  }

  const big = skills.filter((s) => s.bytes > MAX_SIZE_BYTES).sort((a, b) => b.bytes - a.bytes).slice(0, 3)
  const freq = phraseFrequency(skills)
  const dups = []
  outer:
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const info = dupInfo(skills[i], skills[j], freq)
      if (info) {
        dups.push(`${skills[i].dir}↔${skills[j].dir}（${info}）`)
        if (dups.length >= MAX_DUPS) break outer
      }
    }
  }
  const missing = skills.filter((s) => s.description.length < 8).map((s) => s.dir)

  let lastReorgText = '从未'
  let staleNote = ''
  if (state.lastFullReorg) {
    const days = Math.floor((now - new Date(state.lastFullReorg).getTime()) / 86400000)
    lastReorgText = `${Math.max(0, days)} 天前`
    if (days > STALE_DAYS) staleNote = '已超 30 天未全盘重梳理'
  }

  const kb = (totalBytes / 1024).toFixed(1)
  const header = `【skill-curator 检测】${skills.length} 个 SKILL.md · 总大小 ${kb} KB · 距上次全盘重梳理 ${lastReorgText}`

  const advices = []
  for (const d of dups) advices.push(`建议合并 ${d.split('（')[0]}`)
  for (const mm of missing) advices.push(`建议补充 description: ${mm}`)
  if (staleNote) advices.push('建议全盘重梳理')

  if (advices.length === 0 && big.length === 0) {
    console.log(`${header} · 建议: 无需处理`)
    return
  }
  const parts = [header]
  if (big.length) parts.push(`- 最大: ${big.map((s) => `${s.dir} (${(s.bytes / 1024).toFixed(1)} KB)`).join('、')}`)
  if (dups.length) parts.push(`- 重复候选: ${dups.join('、')}`)
  if (missing.length) parts.push(`- 缺 description: ${missing.join('、')}`)
  parts.push(`- 建议: ${advices.join('；')}`)
  console.log(parts.join('\n'))
}

main()
```

修复说明（对照旧版 416f675 逐字脚本）：
1. **I1 去样板化**：新增 `extractPhrases`（小写归一 + 枚举全部候选短语）/ `phraseFrequency`（全局频率）/ `isBoilerplate`（≥3 个 skill 共享 或 无内容词）/ `dupInfo` 取最长共享短语；主循环加 `MAX_DUPS = 5` 上限。效果：真实库重复候选 50 → ~13（评审已验证）。
2. **I2 I/O 防护**：dirs 过滤与逐文件 `readFileSync` 均 try/catch 跳过；`writeState` try/catch 不阻塞摘要。
3. **M3 空 name 防护**：`dupInfo` 加 `a.name && b.name &&`。
4. **自身纳入扫描**：移除 `d.name !== 'skill-curator'`（docs 库初始仅自身时摘要报「1 个 SKILL.md」）。

- [ ] **Step 3: 更新 SKILL.md 路径（docs/skills）**

`docs/skills/skill-curator/SKILL.md` 做如下替换：
1. 「你是本仓库 `.claude/skills/` 技能库的维护者」→「你是本仓库 `docs/skills/` 技能库的维护者」
2. 本仓库路径四行 → `docs/skills/` 对应路径（`SKILL_ROOT` = `docs/skills/`；状态 = `docs/skills/.curator-state.json`；报告 = `docs/skills/CURATOR_REPORT.md`；归档 = `docs/skills/_archive/`）
3. 触发检查命令 → `node docs/skills/skill-curator/scripts/curator-check.mjs`
4. 注意节「自身也是 `.claude/skills/` 下的一个 skill，接受自身治理（Hook 扫描已排除 `skill-curator` 与 `_archive/`）」→「自身也是 `docs/skills/` 下的一个 skill，接受自身治理（Hook 扫描已纳入自身、仅排除 `_archive/`）。既有 28 个 skill 仍位于 `.claude/skills/`（Claude 原生发现），不属于本库扫描范围。」

- [ ] **Step 4: 更新 settings.json / CLAUDE.md / .gitignore**

- `.claude/settings.json` 的 `hooks.SessionStart[0].hooks[0].command` → `node docs/skills/skill-curator/scripts/curator-check.mjs`
- `.claude/CLAUDE.md` 末行 → 「维护动作遵循非破坏性约定：合并/归档前原文移入 `docs/skills/_archive/`，每次重梳理追加 `docs/skills/CURATOR_REPORT.md`。」
- `.gitignore` 末尾 → 
```gitignore
# skill-curator 运行时状态
docs/skills/.curator-state.json
# 兼容：手动/验证对旧库根 .claude/skills 运行检测产生的状态
.claude/skills/.curator-state.json
```

- [ ] **Step 5: 更新提示词 `docs/prompts/skill-curator-prompt.md`**

1. 第 3 行 blockquote（M5 措辞，去工具名）→
`> 用途：将本提示词粘贴进任意 AI 编程助手的指令文件，即可让该助手以「Skill Curator」身份常驻维护一个可复用技能库（各工具的具体粘贴位置见文末「适配说明」）。`
2. 第 4 行（SKILL_ROOT 默认）→
`> 目标技能库根目录记为 \`SKILL_ROOT\`（默认 \`docs/skills/\`，作为文档资产存放、可读可审计；跨工具/跨仓库可替换为其他目录）。\`SKILL_ROOT\` 下每个技能为一个子目录，内含 \`SKILL.md\`，frontmatter 含 \`name\` 与 \`description\`。`
3. §2 重复 bullet → 「`name` 近似、`description` 高度相似（同时出现**非样板**核心短语——共享短语被 ≥3 个技能共用即视为样板）的技能配对。」

- [ ] **Step 6: 同步 spec `docs/superpowers/specs/2026-08-30-skill-curator-design.md`**

- §4 架构图：`skill-curator/` 路径 `.claude/skills/` → `docs/skills/`（图内两处）。
- §5：SKILL_ROOT 默认 `.claude/skills/` → `docs/skills/`。
- §6：「扫描」排除项改为仅 `_archive/`（自身纳入扫描）；脚本路径 `.claude/skills/skill-curator/scripts/curator-check.mjs` → `docs/skills/...`；detection 规则「重复候选」追加去样板化（共享短语被 ≥3 个 skill 共用视为样板忽略；候选上限 5）。
- §7：SKILL.md 路径 → `docs/skills/skill-curator/SKILL.md`；SKILL_ROOT 改 `docs/skills/`；「接受自身治理」措辞同步（自身纳入扫描）。
- §8：CLAUDE.md 示例中 `.claude/skills/_archive/`、`.claude/skills/CURATOR_REPORT.md` → `docs/skills/` 对应。
- §9：「skill-curator 自身也是 `.claude/skills/` 下的一个 skill」→ `docs/skills/`；补一句「既有 28 个留在 `.claude/skills/`（Claude 原生发现），不在 curator 扫描范围」。
- §10 交付物清单表：原 `.claude/skills/skill-curator/` 行改注「由 `.claude/skills/skill-curator/` 迁入 `docs/skills/skill-curator/`」；「不改动」条目追加「既有 28 个 skill 位置与内容均不动」。
- §11 验收：归档路径 → `docs/skills/_archive/`。

- [ ] **Step 7: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
echo "--- 1. 默认根（docs/skills）正常路径 ---"
node docs/skills/skill-curator/scripts/curator-check.mjs; echo "exit=$?"
echo "--- 2. 去样板化验收：对旧库根 .claude/skills ---"
node docs/skills/skill-curator/scripts/curator-check.mjs .claude/skills
echo "--- 3. 无残留旧路径引用 ---"
grep -rn "claude/skills/skill-curator" docs .claude || echo "无残留"
echo "--- 4. settings.json 合法 + hook 指向 docs ---"
node -e "const s=require('./.claude/settings.json');const c=s.hooks.SessionStart[0].hooks[0].command;if(!c.includes('docs/skills'))throw Error('hook 未指向 docs/skills');console.log('OK: '+c)"
echo "--- 5. git status ---"
git status --short
```
Expected:
1. 输出以 `【skill-curator 检测】1 个 SKILL.md` 开头 · 建议: 无需处理 · exit=0；`docs/skills/.curator-state.json` 生成。
2. 重复候选条数明显低于旧版 50（无「即便没有明说」「use this skill」「when the user」「for creating」等样板族）。
3. 输出「无残留」。
4. `OK: node docs/skills/skill-curator/scripts/curator-check.mjs`。
5. 仅含本任务交付物改动；`.claude/skills/skill-curator` 不再出现在 tracked 列表。

- [ ] **Step 8: 提交**

```bash
git add -A docs/skills .claude/settings.json .claude/CLAUDE.md .gitignore docs/prompts/skill-curator-prompt.md docs/superpowers/specs/2026-08-30-skill-curator-design.md
git commit -m "feat(skill-curator): 技能库迁移至 docs/skills（不入 .claude/.agents）+ 最终评审修复（去样板化/I-O 防护/空 name 防护/提示词措辞）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

**计划修订（用户需求变更 + 最终评审，Task 6，提交 cf18f19 后）：** 用户新指令「上述需求生成的 skills 不入传统 `.agents`/`.claude` 目录，改放 `docs/`，触发条件不变」；AskUserQuestion 定案「仅新库迁移（既有 28 个留 `.claude/skills/` 不动）+ 目标 `docs/skills/`」。最终全分支评审（opus）裁决 "With fixes"：I1（M2 去样板化 50→~13，FIX-BEFORE-MERGE）、I2（M1 未防护 I/O，FIX-BEFORE-MERGE）、M3（空 name 近似，FIX-BEFORE-MERGE）、M5（提示词 intro 工具名越界）——均并入 Task 6 一次性落地。Global Constraints 相应修订（库根 `docs/skills/`、自身纳入扫描）。

---

### Task 7a: 通用提示词融入「代码复用优化专家」模型

**触发源：** 用户需求变更 2——提供「项目代码复用优化专家」完整提示词，要求结合进 skill-curator（优化/完善/补充）；AskUserQuestion 定案「SKILL.md + 表索引」。

**Files:**
- Modify: `docs/prompts/skill-curator-prompt.md`（整文件重写）

**Interfaces:**
- Consumes: Task 1 提示词、Task 6 迁移后路径。
- Produces: 拓宽后的通用提示词（Skill 定义拓宽 / 纳入排除标准 / 状态机 / 复用优先 / 每轮输出流程 / 特殊指令 / 表索引格式）。Task 7b 据此更新 SKILL.md 实例与 SKILL-LIBRARY.md。

- [ ] **Step 1: 整文件重写提示词**

将 `docs/prompts/skill-curator-prompt.md` 整文件内容**逐字**替换为：

```markdown
# AI 编程助手通用提示词：动态提取 & 维护可复用 Skill（Skill Curator · 代码复用优化专家）

> 用途：将本提示词粘贴进任意 AI 编程助手的指令文件，即可让该助手以「Skill Curator / 代码复用优化专家」身份常驻维护一个可复用技能库（各工具的具体粘贴位置见文末「适配说明」）。
> 目标技能库根目录记为 `SKILL_ROOT`（默认 `docs/skills/`，作为文档资产存放、可读可审计；跨工具/跨仓库可替换为其他目录）。每个技能为 `SKILL_ROOT/<name>/SKILL.md`；`SKILL_ROOT/SKILL-LIBRARY.md` 为全库索引表（格式见 §5）。

## 1. 身份与常驻职责

你是本技能库的维护者（Skill Curator），同时是本项目的**代码复用优化专家**。持续识别、提取、维护库内高复用独立 Skill（可复用功能/逻辑单元），并确保开发时优先复用而非重写。

**Skill 定义**：独立、可复用、内聚的功能逻辑块，可以是：
- **AI 指令类**：面向编程助手的操作指南（`SKILL.md` 正文 + frontmatter）；
- **代码级可复用单元**：工具函数、通用业务逻辑、组件模板、通用处理流程、校验规则、封装工具类。

Skill 具备自包含能力，不绑定当前业务上下文，可跨场景直接复用调用。每个 Skill 落为一个 `SKILL_ROOT/<name>/SKILL.md`（正文含 输入参数/输出结果/使用约束/示例调用/状态）；代码级单元的实际实现留在原处，文档指向其位置与接口，不复制代码入库。目标是避免重复编写相同逻辑，降低 token 消耗，提升开发效率。

**不打断主任务**——识别后先记下，在触发点统一处理。

## 2. 检测与纳入/排除规则

**库质量自查（重梳理/每轮维护前）**
- **重复**：`name` 近似、`description` 高度相似（同时出现**非样板**核心短语——共享短语被 ≥3 个技能共用即视为样板；纯功能词短语亦视为样板）的技能配对。
- **超体积**：SKILL.md 正文明显过长（经验阈值 8KB，仅提示不强制）。
- **缺描述**：frontmatter 无 `description` 或描述空泛（无法用于检索）。
- **陈旧**：距上次全盘重梳理超过 30 天。

**纳入标准（满足任意 2 条即纳入 Skill 库）**
1. 该逻辑已出现 ≥2 次重复实现，或预判未来业务会多次用到；
2. 逻辑内聚独立，与当前页面/业务耦合低，可剥离单独使用；
3. 逻辑复杂度较高，每次重写消耗大量 token、易引入 bug；
4. 通用工具方法 / 通用校验 / 通用处理流程 / 基础组件模板 / 通用配置处理。

**排除标准（不纳入）**：强绑定当前业务上下文、一次性业务逻辑、仅当前场景使用的临时代码。

## 3. 维护 SOP（识别 → 新增 → 修改 → 合并 → 精简 → 归档，全程非破坏性）

- **新增**：满足 §2 纳入标准时抽离为新 Skill（frontmatter 含精准 `description`；正文含 输入/输出/约束/示例/状态）；同步 `SKILL-LIBRARY.md` 分配递增 Skill ID（SK-001…）。
- **修改**：与当前实践不符时更新；保持 `name`/`description` 稳定，避免破坏既有引用；同步索引表对应行。
- **合并**：重复/近重复 Skill 合并；**合并前将被合并方原文移入 `SKILL_ROOT/_archive/`**；索引表对应行状态标「已废弃」。
- **精简**：超体积 Skill 删冗余、长示例改要点 + 指针；正文按需读。
- **归档**：不再适用或已被合并的 Skill 移入 `SKILL_ROOT/_archive/<name>/`（非删除）。
- **状态机**：每行状态 ∈ {生效 | 待优化 | 已废弃}；「待优化」标记后续迭代点；「已废弃」保留记录不删除。
- **清理**：仅归档满 30 天且无引用（无调用、无报告提及）才允许物理删除；否则一律保留在 `_archive/`。

## 4. 开发执行约束（最重要）

① 后续所有编码任务，**优先检索【项目Skill库】**；若当前需求存在匹配的生效 Skill，**直接复用该 Skill 完成功能，禁止重新编写相同逻辑**，只写业务适配层代码，最大限度节省 token。
② 若现有 Skill 不能完全满足当前需求：优先判断是「调用现有 Skill 做少量适配」还是「更新已有 Skill / 新增 Skill」；完成编码后同步更新 Skill 库。
③ 若当前需求没有匹配 Skill：完整实现功能；实现完成后评估该逻辑是否可抽象为新 Skill，满足纳入标准就新增。
④ **不要过度抽象**：不要为提取 Skill 强行拆分简单一次性逻辑，避免库臃肿；只提取真正会复用的逻辑。

## 5. 每轮输出流程（固定顺序）

1. 先处理用户本次实际开发需求，输出代码、修改方案；
2. 完成代码处理后，扫描本次新增/变更代码，执行 Skill 识别、新增、修改、废弃；
3. 输出更新后的完整【项目Skill库】索引表（格式见下）；
4. 简短说明本次 Skill 变更摘要（新增/修改/废弃各哪些；若无变更写「本轮无新增/变更Skill」）。

**【项目Skill库】索引表格式**（维护于 `SKILL_ROOT/SKILL-LIBRARY.md`）：

| Skill ID | Skill名称 | 能力描述 | 输入参数 | 输出/返回结果 | 使用约束&边界 | 示例调用方式 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-001 | … | 清晰描述该 Skill 能干什么 | 罗列需传入的参数 | 返回值/产出效果 | 限制条件、异常边界、不能处理的场景 | 伪代码/简短调用示例 | 生效 |

> 库较大时仅列生效行、已废弃行标注即可；保持行精简要（描述优先）。

## 6. 特殊指令

- 当用户提供已有项目代码片段/完整代码：先解析代码，第一轮就完成初始 Skill 提取，生成初始 Skill 库。
- 当用户提出新业务需求：先看 Skill 库，优先复用 Skill，做完再更新库。
- 当用户明确提示「重新梳理Skill库」：基于全部上下文与全部代码，重新评审所有 Skill，删除冗余、合并重复、优化描述参数边界，输出整理后的 Skill 库。

## 7. 自主触发条件

以下任一情形，自主执行一次全盘重梳理（按 §3 SOP，无需用户下令）：
- 会话开始时的检测摘要报告异常（重复候选 / 缺描述 / 超 30 天未重梳理）；
- 上下文压缩后；
- 某功能或阶段完成时（含每轮代码处理后的增量扫描）。

## 8. 变更报告

每次重梳理后，在 `SKILL_ROOT/CURATOR_REPORT.md` 追加条目（新增/合并/精简/归档了什么、为什么、如何回滚），并更新重梳理时间戳。保证人类可审计、可恢复。

## 9. token 节俭惯例

- **描述优先**：索引表即描述——维护/输出索引时只读各 Skill 的 description 与表格行，不整篇加载正文。
- **正文按需读**：仅在执行某 Skill 时加载其正文。
- **合并/精简目标**：同功能以更低 token 达成（本版不设硬指标）。

## 适配说明（各工具粘贴位置）

| 工具 | 粘贴位置 |
|------|----------|
| Claude Code（项目级） | `.claude/CLAUDE.md` |
| Claude Code（全局） | `~/.claude/CLAUDE.md` |
| Codex | `AGENTS.md`（项目根） |
| 其他 Vibe Coding 工具 | 对应指令/系统提示区 |

> 若环境存在既有技能管理机制（如 skill-factory 的命令式管理），优先复用其命令、合并其检测结果，避免重复建设。
```

- [ ] **Step 2: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
for s in "Skill 定义" "纳入标准" "排除标准" "开发执行约束" "每轮输出流程" "特殊指令" "重新梳理Skill库" "SKILL-LIBRARY" "状态机" "适配说明"; do grep -qF "$s" docs/prompts/skill-curator-prompt.md || echo "缺失: $s"; done
echo "--- 工具名越界检查 ---"
grep -n "Claude Code\|CLAUDE.md\|Codex\|AGENTS.md" docs/prompts/skill-curator-prompt.md
```
Expected: 无「缺失」行；工具名仅出现在「适配说明」表及该节内。

- [ ] **Step 3: 提交**

```bash
git add docs/prompts/skill-curator-prompt.md
git commit -m "feat(skill-curator): 通用提示词融入「代码复用优化专家」模型（Skill 定义拓宽/纳入排除/状态机/复用优先/每轮流程/表索引/特殊指令）
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7b: 仓库实例落地 + SKILL-LIBRARY.md + 脚本加固 + spec 同步

**触发源：** 用户需求变更 2 定案「SKILL.md + 表索引」＋ 最终评审 optional 加固建议（FUNCTION_WORDS 扩充 / 顶层 I/O 防护 / doc-脚本对齐）。

**Files:**
- Modify: `docs/skills/skill-curator/SKILL.md`
- Create: `docs/skills/SKILL-LIBRARY.md`
- Modify: `.claude/CLAUDE.md`
- Modify: `docs/skills/skill-curator/scripts/curator-check.mjs`（两处小改）
- Modify: `docs/superpowers/specs/2026-08-30-skill-curator-design.md`

**Interfaces:**
- Consumes: Task 7a 提示词、Task 6 迁移产物。
- Produces: 仓库实例含表索引与复用优先常驻命令；加固后脚本；同步后的 spec。

- [ ] **Step 1: SKILL.md 更新**

`docs/skills/skill-curator/SKILL.md`：
1. frontmatter description 触发词追加：把「用户说"重梳理 skills / 整理 skill 库 / curator"」改为「用户说"重梳理 skills / 整理 skill 库 / 重新梳理Skill库 / 代码复用优化 / curator"」。
2. 职责节补一句：「你同时担任本项目的代码复用优化专家：除维护 SKILL.md 指令类 Skill 外，持续识别代码级可复用单元（工具函数/组件模板/校验规则/通用流程等），以 SKILL.md 文档 + 【项目Skill库】索引表统一管理。」
3. 新增「本仓库约定」节：
```
## 本仓库约定

- 每个 Skill = `docs/skills/<name>/SKILL.md`（frontmatter 含 name/description；正文含 输入参数/输出结果/使用约束/示例调用/状态 章节）。
- 代码级可复用单元同样落 SKILL.md 文档；实际实现留在 `src/` 等原处，文档指向其位置与接口（不复制代码入库）。
- 全库索引表 = `docs/skills/SKILL-LIBRARY.md`（8 列：Skill ID / Skill名称 / 能力描述 / 输入参数 / 输出/返回结果 / 使用约束&边界 / 示例调用方式 / 状态）。Skill ID 递增（SK-001…）；状态 ∈ {生效 | 待优化 | 已废弃}。
```
4. 触发检查节补：运行后同步核对 `docs/skills/SKILL-LIBRARY.md` 与 `docs/skills/*/SKILL.md` 是否一致。
5. 新增「开发执行约束（复用优先）」节（源自通用提示词 §4）：
```
## 开发执行约束（复用优先）

- 编码前先检索【项目Skill库】：有匹配生效 Skill 直接复用，禁止重写相同逻辑，只写业务适配层。
- 不满足时优先「少量适配」>「更新已有 Skill」>「新增 Skill」；完成编码后同步更新库。
- 不要过度抽象：不为提取而拆分简单一次性逻辑。
```
6. 新增「每轮输出流程」节（源自通用提示词 §5）：处理需求 → 扫变更代码 → 更新库 → 输出完整【项目Skill库】表 → 变更摘要（无变更写「本轮无新增/变更Skill」）。
7. 注意节补：状态「已废弃」= 保留记录不删除（非破坏性）。

- [ ] **Step 2: 创建 `docs/skills/SKILL-LIBRARY.md`**

写入：
```markdown
# 📚 项目Skill库（动态维护，随开发迭代更新）

> 说明：Skill 库为当前项目可复用逻辑集合，后续开发遇到对应场景直接调用对应 Skill，禁止重复实现；状态分为【生效｜待优化｜已废弃】。每轮代码处理后在 `docs/skills/CURATOR_REPORT.md` 记录变更。

| Skill ID | Skill名称 | 能力描述 | 输入参数 | 输出/返回结果 | 使用约束&边界 | 示例调用方式 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-001 | skill-curator | 维护本仓库 Skill 库的自适应管家：检测/新增/修改/合并/精简/归档可复用 Skill，输出索引表并强制复用优先 | SKILL_ROOT 路径、检测摘要、待评估的代码或 Skill | 更新后的 Skill 库、检测摘要、CURATOR_REPORT.md | 非破坏性（归档可恢复）；不触碰 `src/`、`.claude/skills/skill-factory/`、既有 28 个 skill | 说「整理 skill 库」或「重新梳理Skill库」 | 生效 |

> 新增分配递增 Skill ID；修改直接更新对应行；废弃改状态保留记录；待优化标记迭代点。
```

- [ ] **Step 3: CLAUDE.md 追加复用优先行**

`.claude/CLAUDE.md` 追加一行：
`- 开发遵循复用优先：编码前先检索 \`docs/skills/SKILL-LIBRARY.md\`，有匹配生效 Skill 直接复用、禁止重写相同逻辑；每轮代码处理后增量更新 Skill 库。`

- [ ] **Step 4: 脚本加固（两处小改）**

`docs/skills/skill-curator/scripts/curator-check.mjs`：
1. `FUNCTION_WORDS` 字符串末尾（`because` 后）追加 ` skill user users request want wants`：
   `'…until while because skill user users request want wants'`（其余功能词不动；**不加 create**，保留 skill-creator↔skill-development 的「create a skill」真实信号）。
2. `main()` 顶层 I/O 防护：把
```js
  if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
    console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  const dirs = fs.readdirSync(SKILL_ROOT, { withFileTypes: true })
```
改为
```js
  let dirs
  try {
    if (!fs.existsSync(SKILL_ROOT) || !fs.statSync(SKILL_ROOT).isDirectory()) {
      console.error(`[skill-curator] SKILL_ROOT 不存在或不是目录: ${SKILL_ROOT}`)
      process.exit(1)
    }
    dirs = fs.readdirSync(SKILL_ROOT, { withFileTypes: true })
  } catch {
    console.error(`[skill-curator] 无法读取 SKILL_ROOT: ${SKILL_ROOT}`)
    process.exit(1)
  }
  const state = readState()
  dirs = dirs
```
（后续 `.filter`/`.map`/`.filter`/`.sort` 链不动。）

- [ ] **Step 5: spec 同步**

`docs/superpowers/specs/2026-08-30-skill-curator-design.md`：
- §5 通用提示词内容：标注已融入「代码复用优化专家」模型（Skill 定义拓宽 / 纳入排除标准 / 状态机 / 复用优先 / 每轮输出流程 / 特殊指令 / 表索引）。
- §7 SKILL.md：补「本仓库约定 / 开发执行约束 / 每轮输出流程」节与触发词（重新梳理Skill库 / 代码复用优化）。
- §5 或 §7 补索引表约定：`SKILL_ROOT/SKILL-LIBRARY.md` 8 列表格式（Skill ID 递增 / 状态 ∈ 生效|待优化|已废弃）。
- §8 CLAUDE.md：示例补复用优先行。
- §9：补「代码级可复用单元」共存说明。
- §10 交付物清单：新增行 `docs/skills/SKILL-LIBRARY.md`（索引表种子，含 SK-001）。
- §11 验收：追加「对用户说『重新梳理Skill库』→ 全盘重梳理并输出整理后 Skill 库」「每轮代码处理后输出完整【项目Skill库】表」两条。

- [ ] **Step 6: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
echo "--- 1. 默认根正常路径 ---"
node docs/skills/skill-curator/scripts/curator-check.mjs; echo "exit=$?"
echo "--- 2. 脚本加固验收：旧库根 .claude/skills ---"
node docs/skills/skill-curator/scripts/curator-check.mjs .claude/skills
echo "--- 3. 索引表存在且含 SK-001 ---"
grep -q "SK-001" docs/skills/SKILL-LIBRARY.md && echo "SKILL-LIBRARY.md OK"
echo "--- 4. SKILL.md 触发词 ---"
grep -q "重新梳理Skill库" docs/skills/skill-curator/SKILL.md && echo "触发词 OK"
echo "--- 5. git status ---"
git status --short
```
Expected:
1. `【skill-curator 检测】1 个 SKILL.md` · 建议: 无需处理 · exit=0。
2. 输出不再含「use this skill whenever」「when users request」等残留模板族（FUNCTION_WORDS 加固生效）；重复候选 ≤ 旧版 16。
3. `SKILL-LIBRARY.md OK`。
4. `触发词 OK`。
5. 仅含本任务交付物改动。

- [ ] **Step 7: 提交**

```bash
git add docs/skills/skill-curator/SKILL.md docs/skills/SKILL-LIBRARY.md .claude/CLAUDE.md docs/skills/skill-curator/scripts/curator-check.mjs docs/superpowers/specs/2026-08-30-skill-curator-design.md
git commit -m "feat(skill-curator): 仓库实例落地「代码复用优化专家」模型（SKILL-LIBRARY.md 索引表/复用优先/触发词）+ 脚本加固（功能词扩充/顶层 I-O 防护）+ spec 同步
Co-Authored-By: Claude <noreply@anthropic.com>"
```

**计划修订（用户需求变更 2 + 最终评审加固，Task 7a/7b）：** 用户提供「项目代码复用优化专家」完整提示词，要求结合进 skill-curator（优化/完善/补充）；AskUserQuestion 定案「SKILL.md + 表索引」——代码级可复用单元也落 SKILL.md 文档，【项目Skill库】8 列表格为统一索引与每轮输出，Hook/归档/状态机制与触发条件不变。最终全分支评审（终态，Ready to merge: Yes）的三条 optional 建议并入 Task 7b（FUNCTION_WORDS 加 skill/user/users/request/want/wants、顶层 I/O try/catch、prompt §2 纯功能词说明——后者已在 Task 7a 新提示词 §2 内置）。Global Constraints 已同步（Skill 库形态 = SKILL.md + 表索引）。

---

## Self-Review 记录

**1. 规格覆盖**：spec §5 通用提示词六节 → Task 1 全文；§6 Hook 脚本（扫描/状态/输出格式/检测规则）→ Task 2；§7 SKILL.md → Task 3；§8 CLAUDE.md + §9 与 skill-factory 共存 → Task 3 注意节 + Task 4；§10 交付物清单 → Task1–4 全覆盖；§11 验收 → Task 5 验证；§12 非破坏性 → 脚本无删除逻辑 + SOP 归档约定 + `.gitignore` 忽略状态文件。全数覆盖。

**2. 占位符扫描**：每个文件均含逐字完整内容；测试命令含精确期望输出。无 TBD/TODO。

**3. 类型一致性**：`curator-check.mjs` 输出格式、`.curator-state.json` schema、`CURATOR_REPORT.md` 模板在 Task 2/3/4 及 spec 间一致；`SKILL_ROOT` 默认值一致；Hook 命令路径与脚本实际路径一致。

**4. 已知偏差**：spec §10 交付物清单未列 `.gitignore`，但 `.curator-state.json` 若被提交会制造每次会话的脏工作树（违反 §11「git status 只含本计划交付物」），故 Task 2 追加忽略条目——有意为之。

**5. Task 6（迁移 + 最终评审修复）**：用户需求变更（库根 `docs/skills/`，既有 28 个不动，触发条件不变）＋ 最终评审 "With fixes"（I1 去样板化 / I2 I/O 防护 / M3 空 name / M5 措辞）落地；Global Constraints 已同步（库根、自身纳入扫描）。

**6. Task 7a/7b（融入代码复用优化专家模型）**：用户需求变更 2（提供「项目代码复用优化专家」提示词，定案 SKILL.md + 表索引）落地——通用提示词拓宽（Skill 定义/纳入排除/状态机/复用优先/每轮流程/特殊指令/表索引）+ 仓库实例（SKILL-LIBRARY.md 索引表种子 + 触发词 + 复用优先常驻命令）+ 脚本加固（FUNCTION_WORDS 扩充 / 顶层 I/O 防护）。Global Constraints 已同步（Skill 库形态）。
