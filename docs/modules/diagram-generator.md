# 模块设计：图表生成（diagram-generator）

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
- 输出 `{ type, mermaid }`。

### 2.3 渲染

渲染在**渲染层**：`mermaid.render()` 生成 SVG（集成约定见技能文档）。主进程只负责「资料 → Mermaid 源码」。

## 3. IPC 接口

见 `API_SPEC.md` §7：`diagram:generate`。

## 4. 数据

- `diagrams` 表（可选历史）：存 source / type / mermaid / created_at，支持「最近生成」回看。

## 5. UI

页面 `pages/DiagramGenerator/`：`DiagramGeneratorPage` + `SourceInput` / `MermaidPreview` / `MermaidCodeView`。

## 6. 关键实现要点

- 复杂资料先出总览结构，再逐分支细化，避免一次塞入过多节点。
- 同时给「渲染结果」和「Mermaid 源码」，便于复制 / 二次编辑。
- AI 输出的 Mermaid 可能语法错误，渲染前做基本校验（括号配对、关键字），失败时降级为本地模板重排。
- 图表类型允许用户手动覆盖（资料歧义时）。

## 7. 验收标准

- [ ] 输入一份层级资料，生成思维导图。
- [ ] 输入含判断 / 顺序的流程，生成流程图。
- [ ] 输入审批场景，生成带角色的审批流程图。
- [ ] 渲染结果与源码均可查看 / 复制；AI 失败时本地兜底可用。
