---
name: diagram-generator
description: 根据所给资料生成思维导图、流程图、审批流程图（Mermaid）。当用户要「根据资料/文档画思维导图、流程图、审批流程、把一段文字变成图表、梳理业务流程」时使用，即便没有明说「图表生成」。
---

# 图表生成（思维导图 / 流程图 / 审批流）

从用户提供的资料中抽取结构，判定图表类型，输出 **Mermaid** 语法，供 React 渲染层（自研受限渲染器 `shared/mermaid.ts`）展示。

## 类型判定

- **思维导图（mindmap）**：资料呈「主题 → 多层子主题」的层级 / 分类关系，无先后与判断。
- **流程图（flowchart）**：有先后顺序、条件判断、分支 / 循环的步骤。
- **审批流程**：多人 / 多角色按顺序流转的签核场景（提交 → 审批 → 会签 / 或签 → 结束），本质是带角色的流程图。

判定依据是「关系的性质」：层级 → mindmap，顺序 + 判断 → flowchart，角色流转 → 审批流。

## 生成流程

1. 通读资料，抽取核心实体与关系。
2. 判定图表类型（见上）。
3. 用 Mermaid 语法输出；语法速查见 `references/mermaid-snippets.md`。
4. 复杂资料先给一个总览结构，再逐分支细化，避免一次塞入过多节点。

## 集成约定

- 渲染层用**自研受限渲染器**（`src/shared/mermaid.ts` 为唯一语法真相源）：只支持 `mindmap` 缩进树与 `flowchart TD/LR` 的 `A-->B` / `A--标签-->B`、`{}` 判断节点、`(( ))` 根节点；`MermaidPreview` 解析 + 布局 + 纯 SVG，零第三方库。
- 主进程 `diagram.service` 在返回前用同一 `parseMermaid` 校验 AI 输出；不合规或 AI 失败 → `localGenerate` 本地模板兜底，`diagram:generate` 永不 reject。
- 输出同时给「Mermaid 源码」和「渲染结果」，源码可复制、二次编辑。
