# AGENTS.md — my-pc 标准规约

所有 AI 代理（Claude Code、Codex 等）在本仓库工作的统一入口。写代码前先读本文件，按需加载对应技能与规则。

## 项目概览

- **项目**：my-pc — 基于 Electron 的桌面应用，管理电脑基本信息、进程、网络、大文件，并提供广告屏蔽、简历优化、图表生成等能力。
- **技术栈**：Electron · React · TypeScript · Node.js · SQLite
- **规划**：`project-plan.md`

## 核心约定（精简）

1. TypeScript 严格模式，禁用 `any`（除非必要）。
2. 前端：函数组件 + Hooks，Props 定义接口，样式用 CSS Modules。
3. 后端：控制器 → 服务 → 数据访问 三层架构，接口参数校验（Zod），统一错误类。
4. Electron：`contextIsolation: true`、`nodeIntegration: false`，IPC 走 `contextBridge` + `invoke`，只传可序列化数据。
5. 数据库操作统一走 SQLite 数据访问层（`better-sqlite3`）。

## 目录与文档指针

- `.claude/rules.md` — Claude Code 行为规则
- `.ai-rules/global-rules.md` / `frontend-rules.md` / `backend-rules.md` — 详细开发规则
- `docs/` — 架构设计、API 规范、编码标准、组件库（规划中）
- `project-plan.md` — 项目需求与技术栈

## 项目技能清单（`.claude/skills/`）

| 技能 | 触发场景 |
|------|---------|
| `electron-architecture` | 涉及 Electron 结构、IPC、数据层的任何开发（基础技能，优先加载） |
| `system-monitor` | 系统信息：CPU / 内存 / 硬盘 / OS / 网络 / 进程 / 端口占用 |
| `large-file-manager` | 大文件扫描、分类、搜索 |
| `ad-blocker` | 软件广告 / 个性化推荐屏蔽（hosts） |
| `resume-optimizer` | STAR 原则简历优化 |
| `diagram-generator` | 思维导图 / 流程图 / 审批流程图（Mermaid） |

## 工作流

理解需求 → 分析现有结构 → 方案确认 → 编码 → 自检 → 更新文档。
复杂功能先输出设计方案，关键决策需用户确认。
