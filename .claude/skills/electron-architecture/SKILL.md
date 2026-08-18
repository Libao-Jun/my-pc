---
name: electron-architecture
description: my-pc 的 Electron 工程结构、IPC、数据层架构约定。当要搭建或修改 Electron 主进程、preload、渲染进程、进程间通信（IPC）、SQLite 数据访问层，或新增任何功能模块时，优先参考本技能。
---

# Electron 架构约定

my-pc 采用 Electron 三层结构：**主进程（main）/ 预加载（preload）/ 渲染进程（renderer）**。这是所有功能模块的骨架，任何新功能都要遵循。

## 三层职责

- **main**：应用生命周期、系统能力（文件、网络、进程、系统信息）、SQLite 数据访问、IPC 处理器注册。
- **preload**：通过 `contextBridge.exposeInMainWorld` 暴露类型化的 API，是渲染层与主进程之间唯一的桥梁。
- **renderer**：React UI，只通过 `window.<api>` 调用，不直接接触 Node 原生模块。

## IPC 安全约定

- `BrowserWindow` 的 `webPreferences` 必须 `contextIsolation: true`、`nodeIntegration: false`、`sandbox` 按需开启。
- 主进程用 `ipcMain.handle('domain:action', handler)` 注册；preload 用 `ipcRenderer.invoke('domain:action', ...)` 调用并 `exposeInMainWorld`。
- 通道名用 `域名:动作` 命名（如 `system:getCpu`、`file:scan`），避免裸字符串散落各处。
- 只传**可序列化数据**（纯对象/数组/原始类型），不传函数、Buffer、类实例。

## 数据访问层（SQLite）

- 用 Node 内置 `node:sqlite`（`DatabaseSync`），封装成 data-access 层（对应 `.ai-rules/backend-rules.md` 三层架构中的「数据访问层」）。
- 每个功能域一个 repository 模块（如 `system-repository.ts`、`file-repository.ts`），统一管理建表、查询、索引。
- 数据库操作只发生在主进程，渲染层通过 IPC 间接读写。

## 目录约定

```
src/
├── main/        # 主进程：窗口、IPC、系统能力、数据访问
│   ├── ipc/     # ipcMain.handle 处理器，按功能域分包
│   └── db/      # SQLite 连接与 repository
├── preload/     # contextBridge 暴露的类型化 API
└── renderer/    # React 应用（组件/页面/状态）
```

## 与规则文件的关系

- 通用编码规范见 `.ai-rules/`（global / frontend / backend）与 `.claude/rules.md`；本技能只约定 Electron 特有的结构、IPC、数据层。
- 开发某功能域时，同时加载对应的领域技能（如 `system-monitor`、`large-file-manager`）。
