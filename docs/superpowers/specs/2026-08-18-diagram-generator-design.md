# 阶段 6 设计：图表生成模块 + 收尾（完整交付）

> 对应 README §141-145 阶段 6 · 图表生成模块 + 收尾（目标：完整交付）。
> 前置：阶段 4 AI 集成层已落地（`ai/complete()` 主进程内部接口），阶段 5 简历优化是 `complete()` 的第一个消费方；本模块是第二个。

## 1. 目标

- 提供「资料 → 结构抽取 → Mermaid 生成与渲染」：思维导图 / 流程图 / 审批流三类。
- 完成「图表生成」页面：源码输入 + 类型选择 + 生成，渲染预览与 Mermaid 源码均可查看 / 复制。
- **AI 优先、本地兜底**：已配置后端 → LLM 生成 Mermaid；未配置 / 失败 / 语法不合规 → 本地模板重排。
- **收尾**：electron-builder 打包产出可分发的 Windows 安装包；补全 `docs/` 并更新技能与规则。
- 验收：全部 5 个功能域可用，产出可分发的安装包。

## 2. 已确认的设计决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | Mermaid 渲染方案 | **自研受限渲染器**，零新依赖（`mermaid` 库未安装，且「无新依赖」为硬约束） |
| 2 | 支持语法范围 | 仅支持受限子集：`mindmap` 缩进树；`flowchart TD/LR` 的 `A-->B`、`A--标签-->B`、`{}` 判断节点、`(( ))` 根节点 |
| 3 | 语法单一真相源 | 解析器放 `src/shared/mermaid.ts`（纯 TS，node+web 共用）：主进程校验 + 渲染层解析共用同一实现 |
| 4 | 本地兜底策略 | `localGenerate` 按规则抽结构 + 模板拼 Mermaid，确定性输出；AI 输出不符合受限语法 → 同样降级本地 |
| 5 | 结果增补 | `DiagramResult` 加 `source: 'ai' \| 'local'`（镜像阶段 5 `OptimizeResult` 先例，UI 展示「AI 生成 / 本地模板」角标） |
| 6 | 打包发布 | 本阶段加 electron-builder（devDependency）+ `electron-builder.yml` + `dist` 脚本，产出 Windows 安装包；图标用默认（无图标资源，记 deferred minor） |
| 7 | 图表历史 | **不做**（YAGNI）：无 `diagrams` 表、无历史回看；验收标准不覆盖 |

## 3. 架构

### 3.1 文件结构

```
src/shared/mermaid.ts                            新增：受限 Mermaid 语法解析器（纯 TS，node+web 共用）
src/shared/types.ts                              修改：DiagramRequest/DiagramResult/DiagramApi + WindowApi.diagram
src/main/services/diagram.service.ts             新增：generate / classifyType / localGenerate / validateMermaid
src/main/ipc/diagram.ipc.ts                      新增：注册 diagram:generate
src/main/ipc/index.ts                            修改：注册 diagram 域
src/preload/index.ts                             修改：暴露 window.api.diagram.generate
src/renderer/src/stores/diagramStore.ts          新增：zustand store（result/loading/error/generate）
src/renderer/src/pages/DiagramGenerator/DiagramGeneratorPage.tsx 新增
src/renderer/src/pages/DiagramGenerator/MermaidPreview.tsx      新增（共享解析器 → 布局 → 纯 SVG）
src/renderer/src/pages/DiagramGenerator/MermaidCodeView.tsx     新增（源码 + 复制）
src/renderer/src/pages/DiagramGenerator/*.module.css            新增
src/renderer/src/App.tsx                         修改：加第六路分支「图表」
src/renderer/src/components/layout/SideNav.tsx   修改：PageId + NAV_ITEMS 加「图表」
electron-builder.yml                             新增：打包配置
package.json                                     修改：+electron-builder devDep、+dist 脚本
```

### 3.2 数据模型（沿用 `API_SPEC §7`，增补 source）

```ts
interface DiagramRequest { source: string; type?: 'mindmap' | 'flowchart' | 'approval' }
interface DiagramResult { type: 'mindmap' | 'flowchart' | 'approval'; mermaid: string; source: 'ai' | 'local' }
// 注：source 是对 API_SPEC §7 DiagramResult 的增补，用于 UI 展示「AI 生成 / 本地模板」角标（镜像 OptimizeResult）。
```

### 3.3 受限 Mermaid 语法（`src/shared/mermaid.ts` 单一真相源）

**支持语法（必须同时被 service 校验与渲染层解析接受）：**

- **mindmap**：缩进树。
  ```
  mindmap
    root((主题))
      分支A
        子A1
  ```
- **flowchart / approval**：节点声明 + 边。
  ```
  flowchart TD
    A[开始] --> B{是否通过?}
    B -- 是 --> C[通过处理]
    B -- 否 --> D[驳回处理]
    C --> E[结束]
    D --> E
  ```
  - 节点形式：`A[文本]`（矩形）、`A{文本}`（判断菱形）、`A((文本))`（根/圆角）。
  - 边形式：`A --> B`、`A -- 标签 --> B`。
  - 方向：`flowchart TD`（自上而下）或 `flowchart LR`（自左而右）。

**解析器接口**（纯函数，无 DOM）：

```ts
type DiagramNode = { id: string; text: string; kind: 'rect' | 'diamond' | 'circle' }
type DiagramEdge = { from: string; to: string; label?: string }
type ParsedMermaid =
  | { ok: true; type: 'mindmap'; root: DiagramNode; children: Record<string, DiagramNode[]> }
  | { ok: true; type: 'flowchart'; nodes: DiagramNode[]; edges: DiagramEdge[]; dir: 'TD' | 'LR' }
  | { ok: false; reason: string }
function parseMermaid(code: string): ParsedMermaid
```

主进程 `validateMermaid(type, code)` = `parseMermaid(code).ok`；渲染层 `MermaidPreview` 复用同一 `parseMermaid` 得到图结构再做布局。

### 3.4 生成引擎（`diagram.service.ts`）

`generate(source, type?)`：

1. **类型判定**：`type` 给定 → 校验取值；未给定 → `classifyType(source)`（层级/分类关系 → mindmap；先后顺序 + 条件判断/分支 → flowchart；多角色签核流转 → approval）。
2. **AI 优先**：按判定类型构造 prompt，要求**只输出合法受限语法 Mermaid 源码**（含语法示例）；调 `ai/complete(prompt)`（无 schema，返回原始文本）。
3. **校验 + 兜底**：`validateMermaid(type, aiMermaid)` 不过，或任何 AI 错误（`AI_NOT_CONFIGURED`/`AI_TIMEOUT`/`AI_API_ERROR`/`AI_UNAVAILABLE`）→ `localGenerate(source, type)`。
4. 返回 `DiagramResult { type, mermaid, source: 'ai' | 'local' }`。**永不 reject**。

`localGenerate(source, type)`（确定性）：
- mindmap：按换行/缩进/层级标题抽树（`→`、`-`、`1.`、空格缩进均视为层级信号）；无清晰层级 → 根 + 每行一个子节点。
- flowchart：按顺序抽取步骤（分号/句号/换行分隔），识别判断词（`如果`/`是否`/`判断`/`通过`/`失败`）造分支，默认串成线性链。
- approval：识别角色词（`提交`/`审批`/`复核`/`会签`/`驳回`/`通过`），按出现顺序串成 `flowchart LR` 带角色标签节点。
- **不编造**：无法抽取的判断/角色不虚构，退化为线性链；确定的标签保留。

### 3.5 渲染（`MermaidPreview.tsx`，自研，零库）

- 用 `parseMermaid` 得到图结构。
- **mindmap**：缩进树布局（每级垂直下探、同级横排），`(( ))` 根画椭圆。
- **flowchart/approval**：分层布局（BFS 按边序定层定 x、层内按节点序定 y；循环回边容忍为长折线），节点按 kind 画矩形/菱形/圆，边画直线/折线 + SVG marker 箭头，边标签放中点。
- 输出纯 SVG：按内容计算 bbox 设置 width/height，外层容器 `overflow: auto` 支持滚动。
- 解析失败（理论不应发生，防御性）：展示友好提示 + 该段源码仍可在 `MermaidCodeView` 复制。

### 3.6 UI（`pages/DiagramGenerator/`）

| 组件 | 用途 |
|------|------|
| `DiagramGeneratorPage` | 容器：资料 textarea + 类型下拉（自动/思维导图/流程图/审批流，下拉=手动覆盖）+「生成」按钮（loading 禁用）+ 结果区 |
| `MermaidPreview` | 渲染结果（自研 SVG） |
| `MermaidCodeView` | Mermaid 源码 + 复制按钮（`navigator.clipboard`，失败 fallback） |

**diagramStore（zustand）**：`result: DiagramResult | null` / `loading` / `error` / `generate(source, type)` / `clearError`。`generate` 直接透传 `window.api.diagram.generate({ source, type })`。

**导航接入**（沿用既有模式）：`SideNav` PageId 增 `'diagram'`、NAV_ITEMS 加 `{ id: 'diagram', label: '图表' }`；`App.tsx` 六路分支。

## 4. IPC 接口

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `diagram:generate` | renderer→main | `DiagramRequest` | `DiagramResult` | AI 优先，失败 / 未配置 / 语法不合规本地兜底 |

preload 增 `diagram` 域 `generate(req)`；渲染层沿用 `invoke<T>` + `IpcResult`。**无持久化通道**（不做历史表）。

## 5. 错误处理

- 复用现有 `ErrorCode`；渲染层沿用 store 模式直接显示 `error.message`（主进程抛中文）。
- `VALIDATION_ERROR`：`source` 为空 / 超长、`type` 越界。
- AI 四码 + `validateMermaid` 失败由 `diagram.service` catch 后走本地兜底，**不外泄到渲染层**（渲染层永远拿到 `source: 'local'` 的可用结果）。

## 6. 打包发布（收尾）

- `package.json`：`devDependencies` 加 `electron-builder`；scripts 加 `"dist": "electron-vite build && electron-builder"`。
- `electron-builder.yml`：
  ```yaml
  appId: com.mypc.app
  productName: my-pc
  directories: { output: release }
  files: ["out/**"]
  win:
    target:
      - target: nsis
        arch: [x64]
  ```
  （具体键值以实现时校验为准；`main` 字段已指向 `./out/main/index.js`。）
- 图标用默认 Electron 图标（无图标资源，记 deferred minor）。
- 验证：`npm run dist` 成功产出 `release/` 安装包；`electron-vite build` 产出 `out/`。

## 7. 文档 / 技能更新（收尾）

- `docs/API_SPEC.md` §7：`DiagramResult` 补 `source` 字段。
- `docs/modules/diagram-generator.md`：顶部加状态行；§7 验收标准勾选 `[x]`。
- `docs/ARCHITECTURE.md` §5.1：状态行补阶段 6（diagram 复用同一 AI 契约）。
- `docs/README.md`：阶段 6 标题加 `✅ 已落地` + 状态行。
- `docs/DATABASE.md` §2.6 `diagrams`：标注「未实现（YAGNI）」。
- `docs/COMPONENT_LIBRARY.md` §3.5：更新为实际组件（MermaidPreview 为自研渲染器）。
- `.claude/skills/diagram-generator/SKILL.md`：更新集成约定为「自研受限渲染器」口径（原「渲染层引入 mermaid 库」已不成立）；`references/mermaid-snippets.md` 收敛到受限语法子集。

## 8. 验收标准

- [ ] 输入一份层级资料，生成思维导图（预览 + 源码均可查看 / 复制）。
- [ ] 输入含判断 / 顺序的流程，生成流程图。
- [ ] 输入审批场景，生成带角色的审批流程图。
- [ ] 未配置 AI（或 AI 输出语法不合规）→ 本地兜底产出可用图表。
- [ ] `npm run typecheck` 通过（node + web）。
- [ ] `npm run dist` 产出 Windows 安装包。

## 9. 阶段外（明确不做）

- Mermaid 全语法支持（只支持受限子集，源码供用户复制去别处编辑）。
- 图表历史 / 最近生成回看（无 `diagrams` 表）。
- 拖拽 / 画布式编辑（只读预览 + 源码编辑）。
- 导出图片（PNG/SVG 下载）。
- 图表模板库 / 样式定制面板。
- 图标资源制作与签名。
