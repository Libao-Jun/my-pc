# 组件库文档

渲染层（React）组件清单。分「通用组件」与「页面级组件」两层。命名遵循 `PascalCase.tsx`，样式用 CSS Modules（`ComponentName.module.css`），导出用命名导出。

## 1. 通用组件（`src/renderer/src/components/`）

| 组件 | Props 要点 | 用途 |
|------|-----------|------|
| `InfoCard` | `title: string; children; footer?` | 信息卡片容器（系统概览、统计） |
| `InfoRow` | `label: string; value: ReactNode; copyable?` | 键值行，支持复制 |
| `DataTable` | `columns: Column[]; data: T[]; rowKey; onSort?; loading?` | 通用表格（进程 / 文件列表） |
| `SearchInput` | `value; onSearch; placeholder?` | 搜索框（防抖） |
| `ProgressBar` | `percent: number; label?` | 容量 / 占用率进度条 |
| `StatBadge` | `value; label; tone?` | 统计徽标（分类统计） |
| `Switch` | `checked; onChange; disabled?` | 开关（广告屏蔽规则） |
| `Tag` | `children; tone?` | 分类 / 标签 |
| `EmptyState` | `title?; description?; action?` | 空状态 |
| `ConfirmDialog` | `open; title; description; onConfirm; onCancel; confirmText?; danger?` | 确认弹窗（回滚 / 删除 / 提权重启） |
| `Modal` | `open; title; onClose; children` | 通用弹窗容器 |
| `Toast` | `useToast()` 触发 / `ToastHost` 渲染 | 轻提示（成功 / 失败 / info） |
| `Spinner` | `size?` | 加载中 |

**约定**：
- `Column` 泛型定义列（`key`, `title`, `render?`, `sortable?`, `width?`）。
- 数值格式化统一走 `utils/format.ts`（`formatBytes`、`formatPercent`、`formatDate`），不在组件里内联。

## 2. 布局与导航（`components/layout/`）

| 组件 | 用途 |
|------|------|
| `AppLayout` | 整体布局：左侧导航 + 内容区（已落地） |
| `SideNav` | 最小侧边导航（系统信息 / 大文件 / 广告屏蔽），高亮当前页（已落地） |
| `TitleBar` | 自定义标题栏（可选，含窗口控制） |

## 3. 页面级组件（`src/renderer/src/pages/<Module>/`）

### 3.1 系统信息（SystemMonitor）
| 组件 | 用途 |
|------|------|
| `SystemOverviewPage` | 概览页：OS / CPU / 内存 / 磁盘卡片 |
| `CpuPanel` | CPU 型号 + 核心 + 实时负载 |
| `MemoryPanel` | 内存总量 / 占用 / 进度条 |
| `DiskPanel` | 磁盘列表（分区、容量、占用率） |
| `NetworkPanel` | 网络接口表（IP / MAC / DNS / DHCP） |
| `ProcessPanel` | 进程表（排序、内存占用） |
| `PortLookup` | 端口反查（输入端口 → 占用进程） |

### 3.2 大文件（FileManager）

> 状态：阶段 2 已全部落地。

| 组件 | 用途 |
|------|------|
| `FileManagerPage` | 页面入口，组织扫描 / 列表 / 统计 |
| `ScanControl` | 扫描配置（目录、阈值）+ 开始 / 取消 + 进度 |
| `FileTable` | 文件列表（分类、大小、时间、排序） |
| `CategoryStats` | 分类统计（StatBadge 组合） |
| `FileSearchBar` | 搜索（文件名 / 路径 / 分类 / 大小范围） |

### 3.3 广告屏蔽（AdBlocker）

> 状态：阶段 3 已全部落地。

| 组件 | 用途 |
|------|------|
| `AdBlockerPage` | 页面入口 |
| `RuleGroupList` | 按软件分组展示规则（组级开关 + 每条独立开关，新增 / 编辑 / 删除） |
| `RuleEditor` | 新增 / 编辑规则（软件、域名、类别）——Modal 弹窗 |
| `ApplyBar` | 应用 / 恢复按钮 + 状态提示（含管理员横幅、DNS 提示、提权重启弹窗） |
| `BackupList` | hosts 备份记录列表（`listBackups` + 一键恢复） |

### 3.4 简历优化（ResumeOptimizer）
| 组件 | 用途 |
|------|------|
| `ResumeOptimizerPage` | 页面入口 |
| `BasicsForm` | 基本信息（姓名 / 职位 / 简介） |
| `SkillsEditor` | 技能列表编辑 |
| `ExperienceEditor` | 工作经历编辑 + STAR 优化按钮 |
| `ProjectEditor` | 项目经历编辑 + STAR 优化按钮 |
| `OptimizeResultCard` | 展示 STAR 四段结果（情境 / 任务 / 行动 / 结果） |

### 3.5 图表生成（DiagramGenerator）
| 组件 | 用途 |
|------|------|
| `DiagramGeneratorPage` | 页面入口 |
| `SourceInput` | 资料输入 + 图表类型选择 |
| `MermaidPreview` | Mermaid 源码渲染（`mermaid.render`） |
| `MermaidCodeView` | Mermaid 源码查看 / 复制 |

## 4. 状态管理（`src/renderer/src/stores/`）

用 Zustand 按功能域分 store：

| store | 关键状态 / action |
|-------|------------------|
| `systemStore` | `overview`, `loadOverview()`, 轮询定时器 |
| `fileStore` | `scanState`, `files`, `stats`, `startScan()`, `cancelScan()`, `search()` |
| `adblockStore` | `rules`, `status`, `load()`, `apply()`, `restore()` |
| `resumeStore` | `resume`, `load()`, `save()`, `optimize(section, text)` |
| `diagramStore` | `result`, `generate(source, type)` |
| `settingsStore` | `settings`, `load()`, `update(patch)` |

**约定**：跨进程数据一律经 `window.api` 获取后写入 store；store 不直接 import `ipcRenderer`。

## 5. 样式约定

- 设计令牌集中在 `styles/tokens.css`（颜色、间距、圆角、字号、阴影）。
- 组件样式用 CSS Modules；全局基础样式（reset、字体、滚动条）在 `styles/global.css`。
- 主题：先做浅色，令牌化后预留深色主题扩展位。
