# 模块设计：简历优化（resume-optimizer）

> 状态：阶段 5 已落地（2026-08-18，见 §7）。核心裁定：单条 STAR 改写（AI 优先 / 本地规则兜底不编造）、显式保存、导出 Markdown + 导入导出 JSON。

对应需求 4：基于 STAR 原则优化个人简历（技能 / 工作经历 / 项目经历）。

## 1. 需求

- 添加技能、工作经历、项目经历。
- 用 STAR 原则优化经历描述，突出量化成果。

## 2. 设计

### 2.1 数据模型

简历存 SQLite `resumes` 表（单条 `default`，`data` 列存 JSON 化的 `Resume`）。结构见 `API_SPEC.md` §6。

### 2.2 STAR 改写

`services/resume.service.ts` 的 `optimize(section, input)`：

- **AI 优先**：走 `ai/` 适配层，用 LLM 把平淡描述改写为「情境 / 任务 / 行动 / 结果」四段，要求结果量化。
- **本地兜底**：未配置后端或调用失败时，用 STAR 模板（`skills/resume-optimizer/references/star-template.md`）对输入做结构拆分，引导用户补全。
- **不编造**：缺失量化数据时，本地兜底返回提示项，让用户补充数字，而非凭空生成。

## 3. IPC 接口

见 `API_SPEC.md` §6：`resume:load` / `resume:save` / `resume:optimize` / `resume:export` / `resume:import`。

- `resume:export`：导出当前内存态简历为 Markdown / JSON（所见即所得）。
- `resume:import`：走主进程对话框读 JSON 并校验。
- `OptimizeResult` 注明含 `source` 字段（AI 改写 / 本地兜底）。

## 4. 数据

- `resumes` 表（JSON 存整份简历）。
- 导出格式：Markdown / JSON（后续增强）。

## 5. UI

页面 `pages/ResumeOptimizer/`：`ResumeOptimizerPage` + `BasicsForm` / `SkillsEditor` / `ExperienceEditor` / `ProjectEditor` / `OptimizeResultCard`。

## 6. 关键实现要点

- AI 调用放主进程（Node 直接发 HTTP，避免 CORS），渲染层只发 `resume:optimize`。
- `OptimizeResultCard` 展示四段结果，用户确认后回填到编辑区，不自动覆盖原文。
- 结果可整体保存（`resume:save`），支持导出 Markdown。
- API key 脱敏存储，不写日志。

## 7. 验收标准

- [x] 可编辑并保存技能 / 工作经历 / 项目经历。
- [x] 输入平淡经历，输出结构化 STAR 描述（四段齐全，行动用主动语态，结果尽量量化）。
- [x] 未配置 AI 后端时仍能走本地兜底产出结构。
- [x] 重启后简历仍在。
