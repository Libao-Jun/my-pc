# 模块设计：图表生成（diagram-generator）

> 状态：阶段 6 已落地（2026-08-18，见 §7）。核心裁定：**自研受限 Mermaid 渲染器**（零新依赖，`shared/mermaid.ts` 单一真相源）、AI 优先本地兜底、`diagram:generate` 永不 reject、不做图表历史表（YAGNI）。

对应需求 5：根据所给资料生成思维导图、流程图、审批流程。

## 1. 需求

- 根据资料生成思维导图、流程图、审批流程。

## 2. 设计

### 2.1 类型判定

`services/diagram.service.ts` 先判定图表类型（见 `diagram-generator` 技能）：

- **mindmap**：层级 / 分类关系（主题 → 子主题）。
- **flowchart**：先后顺序 + 条件判断 / 分支。
- **approval**：多角色签核流转（提交 → 审批 → 会签 / 或签 → 结束），本质是带角色的 flowchart。

### 2.2 生成

- 通读资料，抽取核心实体与关系。
- **AI 优先**：走 `ai/` 适配层，要求输出合法 Mermaid 源码。
- **本地兜底**：用 Mermaid 语法模板（`skills/diagram-generator/references/mermaid-snippets.md`）按结构拼接。
- 输出 `{ type, mermaid, source: 'ai' | 'local' }`。

### 2.3 渲染

渲染在**渲染层**：自研受限渲染器（`shared/mermaid.ts` 解析 + 布局 + 纯 SVG），零第三方库。主进程只负责「资料 → Mermaid 源码」。

## 3. IPC 接口

见 `API_SPEC.md` §7：`diagram:generate`。

## 4. 数据持久化（YAGNI：不做 diagrams 历史表）

阶段 6 明确不做图表历史（YAGNI），无 `diagrams` 表、无持久化通道；需要时按 DATABASE.md §2.6 补 v5 迁移。

## 5. UI

页面 `pages/DiagramGenerator/`：`DiagramGeneratorPage` + `textarea + 类型下拉（页面内联）` / `MermaidPreview` / `MermaidCodeView`。

## 6. 关键实现要点

- 复杂资料先出总览结构，再逐分支细化，避免一次塞入过多节点。
- 同时给「渲染结果」和「Mermaid 源码」，便于复制 / 二次编辑。
- AI 输出的 Mermaid 可能语法错误，渲染前做基本校验（括号配对、关键字），失败时降级为本地模板重排。
- 图表类型允许用户手动覆盖（资料歧义时）。

## 7. 验收标准

- [x] 输入一份层级资料，生成思维导图。
- [x] 输入含判断 / 顺序的流程，生成流程图。
- [x] 输入审批场景，生成带角色的审批流程图。
- [x] 渲染结果与源码均可查看 / 复制；AI 失败时本地兜底可用。
