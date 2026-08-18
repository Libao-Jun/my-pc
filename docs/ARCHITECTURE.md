# 架构设计

本文描述 my-pc 的整体架构、进程模型、分层、模块划分、数据流与关键设计决策。

## 1. 进程模型

Electron 应用分三块，职责严格分离：

| 进程 | 运行环境 | 职责 | 权限 |
|------|---------|------|------|
| **main（主进程）** | Node.js | 应用生命周期、窗口管理、系统能力、SQLite、IPC 处理器 | 完整 Node 权限 |
| **preload（预加载）** | 受限 Node | 通过 `contextBridge` 暴露类型化 API，无业务逻辑 | 仅 `ipcRenderer`、`contextBridge` |
| **renderer（渲染进程）** | 浏览器 | React UI，只调用 `window.api` | 无 Node 权限 |

**强制安全配置**（`BrowserWindow` webPreferences）：
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox` 按需开启；preload 只用 `contextBridge` 暴露白名单方法。

## 2. 分层架构

主进程内部分层（对应 `.ai-rules/backend-rules.md` 的三层思想）：

```
ipc/        ← 控制器层：解析通道名与参数，转调 service，统一错误
services/   ← 服务层：业务逻辑（采集、扫描、屏蔽、优化、生成）
db/         ← 数据访问层：node:sqlite 连接、迁移、repository
ai/         ← 横向能力：可选 LLM 后端适配（被 resume/diagram service 依赖）
```

依赖方向单向：`ipc → services → db / ai`，禁止反向依赖与跨层越级调用。

## 3. 模块划分

### 3.1 功能域模块（5 个）

| 模块 | service | ipc 处理器 | 页面 | 详细设计 |
|------|---------|-----------|------|---------|
| 系统信息 | `system.service.ts` | `system.ipc.ts` | `pages/SystemMonitor` | `modules/system-monitor.md` |
| 大文件 | `file.service.ts` | `file.ipc.ts` | `pages/FileManager` | `modules/large-file-manager.md` |
| 广告屏蔽 | `adblock.service.ts` | `adblock.ipc.ts` | `pages/AdBlocker` | `modules/ad-blocker.md` |
| 简历优化 | `resume.service.ts` | `resume.ipc.ts` | `pages/ResumeOptimizer` | `modules/resume-optimizer.md` |
| 图表生成 | `diagram.service.ts` | `diagram.ipc.ts` | `pages/DiagramGenerator` | `modules/diagram-generator.md` |

### 3.2 公共基础设施（横向）

- **类型契约**（`src/shared/types.ts`）：IPC 通道名、请求 / 响应、Result 类型，三进程共用，是唯一「契约真相源」。
- **IPC 封装**（`preload/api.ts` + renderer 侧 `invoke()`）：统一错误处理、超时、序列化。
- **错误体系**（`src/shared/errors.ts`）：统一 `AppError(code, message)`，跨 IPC 边界只透传 `{ code, message }`。
- **AI 适配层**（`main/ai/`）：见 §5.1。

## 4. 数据流

### 4.1 同步查询（系统信息、搜索）

```
renderer 组件 → store 调用 window.api.system.getCpu()
  → preload invoke('system:getCpu')
  → ipcMain.handle → system.service → systeminformation/os
  → 纯数据返回（可序列化）→ 组件渲染
```

### 4.2 长任务（大文件扫描）

```
renderer 发起 file:scan
  → ipcMain.handle 启动扫描（后台线程 / 分片让出事件循环）
  → 进度经 webContents.send('file:scan:progress', {current,total}) 推送
  → 完成后 handle resolve 汇总结果
  → 结果写入 SQLite 索引
```

关键点：长任务不阻塞主进程；进度走「事件推送」，最终结果走「Promise resolve」；渲染层订阅进度事件更新进度条。

### 4.3 可选 AI 调用（简历优化、图表生成）

```
resume/diagram service → ai/ 适配层
  ├─ 已配置后端 → 调用 LLM，返回结构化结果
  └─ 未配置 → 本地规则 / 模板兜底
```

## 5. 关键设计决策（ADR）

### 5.1 简历与图表的 AI 能力：可配置后端 + 本地兜底

**背景**：简历 STAR 改写与「资料转图表」本质需要语义理解，本地纯规则效果有限。

**状态**：已落地。阶段 4（2026-08-18）：`main/ai/adapter.ts` 提供 `complete(prompt, schema?)` + `test()`，未配置时抛 `AI_NOT_CONFIGURED`，由上层 service 走本地兜底（见 `docs/modules/ai-integration.md`）。阶段 5（2026-08-18）：`services/resume.service.ts` 的 `optimize()` 直接调用 `main/ai/adapter.ts` 的 `complete(prompt, schema?)`，AI 失败 / 未配置时走本地 STAR 规则兜底（见 `modules/resume-optimizer.md`）。图表模块（阶段 6）复用同一契约（`services/diagram.service.ts` 的 `generate()` 调用 `complete(prompt)`，AI 失败 / 未配置 / 受限语法校验不过时走本地模板兜底，见 `modules/diagram-generator.md`）。

**决策**：
- 引入 `main/ai/` 适配层，统一接口 `ai.complete(prompt, schema?)`。
- 后端可配置：OpenAI 兼容接口（自定义 baseURL + key）与 Anthropic，存于 SQLite `settings` 表。
- **未配置或调用失败时回退本地规则**（STAR 模板、Mermaid 语法模板），保证功能可用。
- AI 调用放在**主进程**（Node 侧直接发 HTTP，避免 CORS），渲染层只发 `resume:optimize` / `diagram:generate` 请求。

**取舍**：不内置特定模型厂商，保留用户自带 key 的自由；本地兜底保证离线可用。

### 5.2 系统信息采集：`os` + `systeminformation` 双源

- 简单字段用内置 `os`（免依赖）；分项 / 实时 / 每接口数据用 `systeminformation`。
- 端口反查在 `systeminformation` 能力不足时，用 `child_process` 执行 `netstat -ano`（Windows）兜底。
- 采集只在主进程，结果序列化后返回，渲染层不碰原生模块。

### 5.3 广告屏蔽：仅 hosts 域名层

- 只通过系统 hosts 文件把广告域名解析到 `0.0.0.0` / `127.0.0.1`。
- 明确不做软件注入、二进制篡改、内存修改。
- 每次修改前备份、支持一键回滚；需要管理员权限（详见 `modules/ad-blocker.md`）。

### 5.4 持久化：node:sqlite 同步 + repository

- 单机场景无并发压力，选同步 API 简化代码；所有写操作集中在主进程，避免跨进程竞争。
- 建表走版本化迁移（`db/migrations.ts`），repository 按功能域划分。

### 5.5 状态管理：Zustand + 服务端数据经 IPC

- 渲染层用 Zustand 管 UI 状态与「服务端数据缓存」；跨进程数据一律经 IPC 获取，不做本地副本同步。
- 高频更新（如 CPU 实时占用）由渲染层定时轮询对应 IPC 通道。

## 6. 安全模型

- 渲染层零 Node 权限，攻击面收敛到 `preload` 白名单 API。
- IPC 只接受可序列化数据，通道名走 `domain:action` 白名单注册。
- 系统命令（`netstat`）只拼固定参数，不拼接用户输入，防命令注入。
- 敏感配置（API key）存本机 SQLite，不上传、不写日志。
- hosts 写入前校验域名格式，防止写入任意内容污染系统文件。

## 7. 关键技术风险与对策

| 风险 | 对策 |
|------|------|
| 大目录扫描阻塞 / 卡顿 | 后台线程 + 分片让出事件循环 + 跳过系统目录 + 权限容错 |
| hosts 修改需管理员权限 | 提权引导 + 失败友好提示 + 备份回滚 |
| AI 调用不稳定 / 无网络 | 本地规则兜底 + 超时 + 错误降级 |
| `node:sqlite` 为实验性 API，接口可能变动 | 锁定 Electron 版本（Node 22.19），封装在 `db/` 层隔离影响 |
| 端口反查跨平台差异 | 主路径 `systeminformation`，Windows 用 `netstat` 兜底，抽象成统一接口 |
