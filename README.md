# my-pc

一款基于 **Electron** 的桌面应用，面向个人电脑的「运维 + 效率」场景。统一管理系统信息、大文件、广告屏蔽、简历优化与图表生成。

- 技术栈：Electron 36 · React 18 · TypeScript 5（strict）· Vite / electron-vite · Zustand · CSS Modules
- 系统能力全部经主进程 + IPC 暴露，渲染层零 Node 权限（`contextIsolation: true`、`nodeIntegration: false`）
- 数据持久化使用 Node 内置 `node:sqlite`，零原生编译、无额外依赖

## 功能概览

| 功能域 | 说明 | 页面 |
|--------|------|------|
| 系统信息 | CPU / 内存 / 硬盘 / 操作系统 / 网络 / 进程 / 端口占用反查 | `SystemMonitor` |
| 大文件管理 | 扫描、分类、SQLite 索引、搜索本机大文件（视频 / 图片 / 文档等） | `FileManager` |
| 广告屏蔽 | 基于 hosts 域名的软件广告与个性化推荐屏蔽，可备份 / 恢复 | `AdBlocker` |
| 简历优化 | 基于 STAR 原则优化技能 / 工作经历 / 项目经历，导入导出 | `ResumeOptimizer` |
| 图表生成 | 根据资料生成思维导图 / 流程图 / 审批流程（AI 优先、本地兜底） | `DiagramGenerator` |
| 设置 | AI 后端配置（OpenAI 兼容 / Anthropic）、大文件阈值等 | `Settings` |

> 简历优化与图表生成默认本地处理，联网 AI 能力作为**可选后端**：已配置 → AI 生成；未配置 / 失败 / 输出不合规 → 确定性本地模板兜底，UI 展示「AI / 本地」来源角标。

## 快速开始

**环境要求**：Node.js 20+（Electron 36 内置 Node 22）

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（HMR）
npm run typecheck  # 类型检查（node + web 两端，本项目的验证门）
npm run build      # 构建产物到 out/
npm run dist       # 打包 Windows 安装包到 release/
```

## 技术选型

| 类别 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | Electron 36+ | 跨平台、生态成熟，内置 Node 22 |
| 构建 | electron-vite | main / preload / renderer 统一 Vite 构建，HMR |
| 前端 | React 18 + TypeScript 5 | 组件化、类型安全（strict，无 `any`） |
| 状态管理 | Zustand | 轻量、无样板代码 |
| 样式 | CSS Modules + 设计令牌 | 作用域隔离、可控 |
| 数据库 | `node:sqlite`（Node 内置） | 零原生编译、同步 API、免依赖 |
| 系统信息 | systeminformation | CPU / 磁盘 / 网络 / 进程一站式 |
| 图表渲染 | 自研受限渲染器（`shared/mermaid.ts`，零依赖） | 文本转图、语法可控 |
| AI 后端（可选） | OpenAI 兼容 / Anthropic | 简历优化与图表生成的核心能力 |

## 架构

```
┌─────────────────────────── renderer（React + Zustand + CSS Modules）┐
│  页面：系统信息 / 大文件 / 广告屏蔽 / 简历 / 图表 / 设置              │
└───────────────────────────────┬─────────────────────────────────────┘
                    contextBridge (window.api) —— 类型化 IPC 契约
┌───────────────────────────────┴─────────────────────────────────────┐
│  preload：暴露类型化 api，无业务逻辑                                  │
└───────────────────────────────┬─────────────────────────────────────┘
                        ipcRenderer.invoke('domain:action')
┌───────────────────────────────┴─────────────────────────────────────┐
│  main（主进程）                                                       │
│   ├─ ipc/        路由到各功能域处理器                                  │
│   ├─ services/   业务逻辑（system / file / adblock / resume / diagram）│
│   ├─ ai/         可选 LLM 后端适配层（openai-compatible / anthropic） │
│   └─ db/         node:sqlite   连接 + 迁移 + repository              │
└──────────────────────────────────────────────────────────────────────┘
```

**目录结构**：

```
my-pc/
├── src/
│   ├── main/                  # 主进程：窗口、IPC、系统能力、数据访问
│   ├── preload/               # contextBridge 类型化 API
│   ├── renderer/              # React 应用（pages / components / stores / styles）
│   └── shared/                # 跨进程共享类型与纯逻辑（IPC 契约、mermaid 解析器）
├── docs/                      # 完整解决方案文档（详见「文档导航」）
├── .claude/  .ai-rules/       # 项目技能与编码规则
├── electron-builder.yml       # 打包配置（NSIS x64）
└── electron.vite.config.ts    # main / preload / renderer 三段构建
```

关键约定：IPC 契约（`src/shared/types.ts`）是三方共用的**唯一真相源**；所有系统能力经主进程暴露，渲染层无 Node 访问。

## 打包发布

```bash
npm run dist   # = electron-vite build && electron-builder
```

产物：`release/my-pc Setup <版本>.exe`（NSIS x64，约 84 MB，含最终构建）。安装为向导式、可选手动选择安装目录（按当前用户安装）。

操作步骤（详细版见 `docs/PACKAGING.md`）：

```bash
npm run typecheck                  # 1. 类型检查（验证门）
npm run build && npm run start     # 2. 编译并预览，确认无误
npm run dist                       # 3. 打包安装包到 release/
```

产物名中的版本号来自 `package.json` 的 `version` 字段；`electron-builder.yml` 可调整 `appId` / `productName` 等打包参数。

## AI 后端配置（可选）

在「设置」页配置：

- 后端类型：OpenAI 兼容 / Anthropic
- Base URL、API Key（仅存本机，读取时脱敏）、模型名

配置完成后在「简历优化」「图表生成」中生效；未配置时自动走本地模板兜底，功能完全可用。

## 文档导航

| 文档 | 内容 |
|------|------|
| `docs/README.md` | 总体方案、技术选型、分阶段实施路线图 |
| `docs/ARCHITECTURE.md` | 进程模型、分层、模块、数据流、关键决策 |
| `docs/API_SPEC.md` | 全部 IPC 接口契约 |
| `docs/DATABASE.md` | SQLite 表结构与迁移 |
| `docs/COMPONENT_LIBRARY.md` | React 组件清单与 Props |
| `docs/CODING_STANDARDS.md` | 编码标准、命名、Git 工作流 |
| `docs/PACKAGING.md` | 安装包生成原理、完整打包步骤、常见问题 |
| `docs/modules/*.md` | 6 个功能模块的详细设计（含 AI 集成层） |

## License

MIT
