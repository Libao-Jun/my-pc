# 阶段 5 设计：简历优化模块（STAR 闭环）

> 对应 README §135-138 阶段 5 · 简历优化模块（目标：STAR 闭环）。
> 前置：阶段 4 AI 集成层已落地（`ai/complete()` 主进程内部接口 + `ai:test` IPC）。本模块是 `complete()` 的第一个消费方。

## 1. 目标

- 提供完整的个人简历编辑器：基本信息 / 技能 / 工作经历 / 项目经历。
- 提供 **STAR 闭环**：单条平淡描述 → 优化成「情境 / 任务 / 行动 / 结果」四段 → 用户确认回填，不自动覆盖。
- **AI 优先、本地兜底**：已配置后端 → LLM 结构化改写；未配置 / 失败 → 本地规则切分（不编造，缺量化处标注待补充）。
- 支持导出 Markdown、导入 / 导出 JSON。
- 验收：输入平淡经历，输出结构化 STAR 描述。

## 2. 已确认的设计决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 优化交互粒度 | **单条改写**：对某一条经历 / 项目 bullet、某一条技能 note 点「优化」，返回该条的 STAR 四段，确认后回填替换 |
| 2 | 导入导出范围 | **导出 Markdown + 导入 / 导出 JSON**；不做 Markdown 导入（有损解析） |
| 3 | 保存语义 | **显式保存**：编辑只在内存 store，页面「保存」按钮统一落库；dirty 时按钮高亮 |
| 4 | 本地兜底策略 | **方案 A**：规则按信号词切分四段；结果段缺量化信号 → 产出「`[待补充量化数据]`」占位提示，**不编造** |
| 5 | 优化结果确认 | 展示四段 + 「AI 优化 / 本地模板」角标 → 用户「确认回填」才替换原条，不自动覆盖 |
| 6 | skill 的 STAR 形状 | skills 也走统一四段（S=使用场景，T=承担事项，A=具体做法，R=可验证说明 / 效果），UI 一套卡片覆盖三类 |
| 7 | AI 结构化输出 | 复用 Phase 4 `complete(prompt, schema?)` 纯文本契约：service 传 `JsonSchema` 让模型按 JSON 返回，service 自行 `JSON.parse` |

## 3. 架构

### 3.1 文件结构

```
src/main/db/repositories/resume.repository.ts        新增：resumes 表读写（upsert 单行 default）
src/main/services/resume.service.ts                  新增：optimize / localOptimize / buildMarkdown / import 校验
src/main/db/migrations.ts                            修改：+1 迁移建 resumes 表
src/main/ipc/resume.ipc.ts                           新增：注册 resume:load/save/optimize/export/import
src/main/ipc/index.ts                                修改：注册 resume 域
src/preload/index.ts                                 修改：暴露 window.api.resume.*
src/shared/types.ts                                  修改：Resume/SkillItem/ExperienceItem/ProjectItem/OptimizeRequest/OptimizeResult/schema
src/renderer/src/pages/ResumeOptimizer/ResumeOptimizerPage.tsx 新增
src/renderer/src/pages/ResumeOptimizer/BasicsForm.tsx         新增
src/renderer/src/pages/ResumeOptimizer/SkillsEditor.tsx       新增
src/renderer/src/pages/ResumeOptimizer/ExperienceEditor.tsx   新增
src/renderer/src/pages/ResumeOptimizer/ProjectEditor.tsx      新增
src/renderer/src/pages/ResumeOptimizer/OptimizeModal.tsx      新增
src/renderer/src/pages/ResumeOptimizer/*.module.css           新增
src/renderer/src/stores/resumeStore.ts                新增：zustand store（内存态 + dirty）
src/renderer/src/App.tsx                              修改：加第五路分支「简历」
src/renderer/src/components/layout/SideNav.tsx        修改：PageId + NAV_ITEMS 加「简历」
```

### 3.2 数据模型（沿用 `API_SPEC §6`）

```ts
interface Resume {
  basics: { name: string; title: string; summary: string }
  skills: SkillItem[]          // { name, level, years, note }
  experience: ExperienceItem[] // { company, title, start, end, bullets: string[] }
  projects: ProjectItem[]      // { name, role, start, end, description, bullets, tags }
}

interface OptimizeRequest { section: 'experience' | 'project' | 'skill'; input: string }
interface OptimizeResult { star: { situation; task; action; result }; source: 'ai' | 'local' }
// 注：source 是对 API_SPEC §6 OptimizeResult 的增补，用于 UI 展示「AI 优化 / 本地模板」角标。
```

### 3.3 优化引擎（`resume.service.ts`）

`optimize(section, input)`：

1. 按 section 构造 prompt：
   - **experience / project**：单条 STAR 改写指令——把平淡描述改写成四段，行动用「我」开头的主动语态，结果尽量量化，缺失量化不编造。
   - **skill**：按 star-template 技能条目改写成可验证说明（在哪个项目 / 场景用过，效果如何）。
2. 传 `JsonSchema`（`name: 'starRewrite'`，`properties: { situation, task, action, result }` 均 string）→ `ai/complete(prompt, schema)` → `JSON.parse`。
3. **捕获任何 AI 错误**（`AI_NOT_CONFIGURED` / `AI_TIMEOUT` / `AI_API_ERROR` / `AI_UNAVAILABLE`）→ 本地兜底 `localOptimize`。
4. 返回 `OptimizeResult { star, source }`。

`localOptimize(section, input)`（**方案 A**）：

- 按信号词规则把输入切分为四段：情境（背景 / 现状 / 由于…）、任务（负责 / 需要 / 目标）、行动（完成 / 实现 / 主导 / 重构 / 搭建 / 优化…）、结果（带来 / 使得 / 提升 / 降低 / 缩短…）。
- 结果段若不含量化信号（数字 / 百分比 / 时间 / 规模词），产出「`[待补充量化数据]`」占位，引导用户填数字。
- skill 分支：note 按四段拆（S=使用场景、T=承担事项、A=具体做法、R=可验证说明），缺场景 / 缺效果同样标注。
- **不编造**：切不到的原文归入行动段；明确的数字保留。

### 3.4 导入导出

- **导出 Markdown**：`buildMarkdown(resume)` 生成全文（基本信息 + 技能表 + 工作经历 STAR bullets + 项目经历）；主进程 `dialog.showSaveDialog`（默认 `简历.md`）+ `writeFile`。
- **导出 JSON**：`dialog.showSaveDialog`（默认 `resume.json`）+ `JSON.stringify(resume)` 写入。
- **导入 JSON**：`dialog.showOpenDialog`（过滤 `.json`）→ 读文件 → `JSON.parse` → 字段校验（结构 / 类型，非法抛 `VALIDATION_ERROR`）→ 返回 `Resume`；渲染层弹确认「将覆盖当前简历」→ 确认后 `resume:save`。

## 4. IPC 接口

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `resume:load` | renderer→main | — | `Resume \| null` | 无简历返回 null，页面用空模板 |
| `resume:save` | renderer→main | `Resume` | `Resume` | 整体替换 default 行 |
| `resume:optimize` | renderer→main | `OptimizeRequest` | `OptimizeResult` | AI 优先，失败 / 未配置本地兜底 |
| `resume:export` | renderer→main | `{ type: 'markdown' \| 'json' }` | `{ path: string } \| null` | 弹保存对话框 + 写文件；null=用户取消 |
| `resume:import` | renderer→main | — | `Resume \| null` | 弹打开对话框 + 读 JSON + 校验；null=用户取消 |

preload 增 `resume` 域五方法；渲染层沿用 `invoke<T>` + `IpcResult`。

## 5. 错误处理

- 复用现有 `ErrorCode`；渲染层沿用 store 模式直接显示 `error.message`（主进程抛中文）。
- `VALIDATION_ERROR`：导入 JSON 非法 / 缺字段。
- `NOT_FOUND`：语义上由 `resume:load` 返回 `null` 覆盖，不抛错误。
- AI 四码由 `resume.service` catch 后走本地兜底，**不外泄到渲染层**（渲染层永远拿到 `source: 'local'` 的可用结果）。

## 6. UI（页面 `pages/ResumeOptimizer/`）

| 组件 | 用途 |
|------|------|
| `ResumeOptimizerPage` | 容器：顶栏操作（导出 Markdown / 导出 JSON / 导入 JSON / 保存）+ Tab（基本信息 / 技能 / 工作经历 / 项目经历） |
| `BasicsForm` | 姓名 / 职位 / 一句话概述 |
| `SkillsEditor` | 技能列表：名称 / 熟练度 / 年限 / note，每条 note 旁「优化」 |
| `ExperienceEditor` | 工作经历：公司 / 职位 / 起止 / bullets（增删），每条 bullet 旁「优化」 |
| `ProjectEditor` | 项目经历：名称 / 角色 / 起止 / 描述 / bullets / 标签，每条 bullet 旁「优化」 |
| `OptimizeModal` | 单条优化弹层：预填当前条文字 →「优化」→ STAR 四段 + 「AI 优化 / 本地模板」角标 → [确认回填] 替换原条 / [重新优化] |

**resumeStore（zustand）**：`resume` / `dirty` / `load` / `save` / `optimize` / `updateBasics` / `addSkill` / `updateSkill` / `removeSkill` / `addExperience` / `updateExperience` / `removeExperience` / `addProject` / `updateProject` / `removeProject` / `optimizeItem` / `clearError`。显式保存：dirty 时「保存」高亮，保存成功 toast「已保存」并清 dirty。

**导航接入**（沿用 Task 6 模式）：`SideNav` PageId 增 `'resume'`、NAV_ITEMS 加 `{ id: 'resume', label: '简历' }`；`App.tsx` 五路分支。

## 7. 验收标准

- [ ] 可编辑并保存基本信息 / 技能 / 工作经历 / 项目经历；重启后简历仍在。
- [ ] 单条平淡描述 →「优化」→ 输出 STAR 四段（行动主动语态、结果尽量量化）→ 确认后回填替换。
- [ ] 未配置 AI（或 AI 失败）→ 本地兜底产出四段结构（缺量化处标「待补充量化数据」），可回填。
- [ ] 导出 Markdown 文件内容正确；导出 JSON 后可重新导入，数据一致。
- [ ] `npm run typecheck` 通过。

## 8. 阶段外（明确不做）

- Markdown 导入（有损解析，不做）。
- 整条经历批量改写（本次只做单条）。
- 技能熟练度雷达 / 图表展示。
- 简历模板 / 排版美化。
- `resume:optimize` 流式输出（Phase 4 未建 `ai:complete` IPC，阶段 5/6 需要时再建）。
