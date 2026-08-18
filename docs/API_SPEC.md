# IPC API 规范

定义 main 与 renderer 之间全部跨进程接口契约。所有类型定义落在 `src/shared/types.ts`，作为唯一真相源，main / preload / renderer 三方共用。

## 1. 通用约定

### 1.1 通道命名

`域名:动作`（kebab-case 动作），如 `system:getCpu`、`file:scan`。所有通道在主进程 `ipc/` 下**白名单注册**，未注册通道不响应。

### 1.2 返回与错误

成功返回纯数据；失败统一抛 `AppError`。preload 侧 `invoke()` 统一捕获并转成 `IpcResult`：

```ts
// src/shared/types.ts
export type ErrorCode =
  | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'PERMISSION_DENIED'
  | 'INTERNAL' | 'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'CANCELLED';

export interface AppErrorShape { code: ErrorCode; message: string }

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorShape };
```

renderer 只拿 `IpcResult<T>`，不接触原始异常。

### 1.3 长任务与事件推送

长任务（如 `file:scan`）用「事件推进度 + Promise 收结果」：
- 主进程 `webContents.send('<channel>:progress', payload)` 推进度。
- preload 以 `api.on('<channel>:progress', cb)` 订阅，返回退订函数。
- 最终结果由 `invoke` 的 Promise resolve。

## 2. 应用与设置域

### `app:getVersion` → `string`
返回应用版本号。

### `app:ping` → `'pong'`
连通性自检。

### `settings:get` → `Settings`
```ts
interface Settings {
  aiBackend: 'openai-compatible' | 'anthropic' | 'none';
  aiBaseUrl: string;      // openai-compatible 时使用
  aiApiKey: string;       // 脱敏返回（仅标记是否已配置，不返回明文）
  aiModel: string;
  largeFileThresholdMB: number; // 默认 100
}
```

### `settings:set(patch: Partial<Settings>)` → `Settings`
部分更新设置，返回更新后的完整设置。

## 3. 系统信息域（system）

```ts
interface SystemOverview {
  os: OsInfo;
  cpu: { model: string; cores: number; loadPercent: number };
  memory: { total: number; used: number; free: number; usedPercent: number };
}

interface OsInfo { platform: string; distro: string; release: string; arch: string }
interface CpuInfo { model: string; cores: number; speedGHz: number; loadPercent: number; perCore: number[] }
interface MemoryInfo { total: number; used: number; free: number; active: number; swapTotal: number; usedPercent: number }
interface DiskInfo { device: string; mount: string; fsType: string; total: number; used: number; usedPercent: number }
interface NetworkInterface { iface: string; ip4: string; mac: string; dhcp: boolean; subnet: string; isDefault: boolean; dns: string[] }
interface ProcessInfo { pid: number; name: string; cpuPercent: number; memBytes: number; user?: string }
interface PortProcess { port: number; pid: number; name: string; protocol: 'tcp' | 'udp' }
```

| 通道 | 参数 | 返回 |
|------|------|------|
| `system:getOverview` | — | `SystemOverview` |
| `system:getCpu` | — | `CpuInfo` |
| `system:getMemory` | — | `MemoryInfo` |
| `system:getDisks` | — | `DiskInfo[]` |
| `system:getNetwork` | — | `NetworkInterface[]` |
| `system:getProcesses` | — | `ProcessInfo[]` |
| `system:getPortProcess` | `{ port: number }` | `PortProcess \| null` |

> 单位约定：内存 / 磁盘字节数用 `number`（字节）。渲染层负责格式化。实时数据（CPU 占用）由渲染层轮询 `system:getOverview`。

## 4. 大文件域（file）

```ts
interface ScanOptions { roots: string[]; minSizeMB: number }
interface FileEntry {
  path: string; name: string; size: number; ext: string;
  category: string; birthtime: number; mtime: number;
}
interface ScanProgress { current: number; total: number; currentPath: string } // total: 0 = 不定进度（扫描前无法预知总数）
interface ScanResult { totalSize: number; skipped: number; durationMs: number }
interface FileStats { byCategory: Record<string, { count: number; size: number }>; totalFiles: number; totalSize: number }
interface SearchQuery { keyword?: string; category?: string; minSizeMB?: number; maxSizeMB?: number; page: number; pageSize: number }
interface FileSearchResult { items: FileEntry[]; total: number }
interface ScanPresets { home: string; drives: string[] } // home 用户主目录；drives 盘符挂载点
// getByCategory 不实现：分类筛选由 file:search 的 category 覆盖
```

| 通道 | 参数 | 返回 |
|------|------|------|
| `file:scan` | `ScanOptions` | `ScanResult` |
| `file:search` | `SearchQuery` | `FileSearchResult` |
| `file:getStats` | — | `FileStats` |
| `file:getScanPresets` | — | `ScanPresets` |
| `file:pickDirectory` | — | `string \| null` |

事件：`file:scan:progress` → `ScanProgress`；`file:scan:cancel`（无参，取消当前扫描）。

## 5. 广告屏蔽域（adblock）

```ts
interface AdblockRule {
  id: string; software: string;     // 所属软件分组，如「搜狗输入法」
  domain: string;                   // 屏蔽域名（小写，字面域名，不支持通配符）
  category: 'ad' | 'recommend';     // 广告 or 个性化推荐
  enabled: boolean;
}
interface AdblockStatus {
  applied: boolean;                 // hosts 中是否存在托管段
  ruleCount: number;
  enabledCount: number;
  lastAppliedAt: number | null;     // 最新备份时间（毫秒）
  elevated: boolean;                // 当前进程是否具备管理员权限
}
interface Backup { id: string; createdAt: number; ruleCount: number }
interface ApplyResult { written: number; backupId: string; needsFlushDns: boolean }
```

| 通道 | 参数 | 返回 |
|------|------|------|
| `adblock:getRules` | — | `AdblockRule[]` |
| `adblock:addRule` | `Omit<AdblockRule,'id'>` | `AdblockRule` |
| `adblock:updateRule` | `{ id: string; patch: Partial<AdblockRule> }` | `AdblockRule` |
| `adblock:removeRule` | `{ id: string }` | `void` |
| `adblock:apply` | — | `ApplyResult` |
| `adblock:restore` | `{ backupId?: string }` | `void` |
| `adblock:getStatus` | — | `AdblockStatus` |
| `adblock:listBackups` | — | `Backup[]` |
| `adblock:relaunchElevated` | — | `void` |

> `adblock:relaunchElevated` 为**单向事件**（`ipcRenderer.send`，不返回结果）：以管理员身份重启应用。由非管理员状态下写入失败（`PERMISSION_DENIED`）后的引导弹窗触发。

## 6. 简历优化域（resume）

```ts
interface Resume {
  basics: { name: string; title: string; summary: string };
  skills: SkillItem[];        // { name, level, years, note }
  experience: ExperienceItem[]; // { company, title, start, end, bullets: string[] }
  projects: ProjectItem[];    // { name, role, start, end, description, bullets, tags }
}
interface OptimizeRequest { section: 'experience' | 'project' | 'skill'; input: string }
interface OptimizeResult { star: { situation: string; task: string; action: string; result: string } }
```

| 通道 | 参数 | 返回 |
|------|------|------|
| `resume:load` | — | `Resume \| null` |
| `resume:save` | `Resume` | `Resume` |
| `resume:optimize` | `OptimizeRequest` | `OptimizeResult` |

> `resume:optimize` 走 AI 适配层：已配置后端 → LLM 结构化改写；未配置 / 失败 → 本地 STAR 模板兜底（见 `modules/resume-optimizer.md`）。

## 7. 图表生成域（diagram）

```ts
interface DiagramRequest { source: string; type?: 'mindmap' | 'flowchart' | 'approval' }
interface DiagramResult { type: 'mindmap' | 'flowchart' | 'approval'; mermaid: string }
```

| 通道 | 参数 | 返回 |
|------|------|------|
| `diagram:generate` | `DiagramRequest` | `DiagramResult` |

> 图表渲染在**渲染层**完成（`mermaid.render()`），主进程只负责「资料 → 结构抽取 → Mermaid 源码」。AI 能力同样走适配层 + 本地兜底。

## 8. 错误码语义

| code | 含义 | 触发场景 |
|------|------|---------|
| `NOT_FOUND` | 资源不存在 | 端口无占用进程、简历未初始化、`adblock:restore` 无可用备份 |
| `VALIDATION_ERROR` | 参数非法 | 端口号越界、域名格式错误 |
| `PERMISSION_DENIED` | 权限不足 | hosts 写入无管理员权限 |
| `AI_UNAVAILABLE` | 未配置 AI 后端 | 未配置 key 且无本地兜底命中 |
| `AI_TIMEOUT` | AI 调用超时 | 请求超时 |
| `CANCELLED` | 已取消 | 用户取消扫描 |
| `INTERNAL` | 其他内部错误 | 兜底 |

## 9. 类型安全落地

- `src/shared/types.ts`：导出全部接口与 `IpcResult`、`ErrorCode`。
- preload 用映射表把「通道名 → 参数 / 返回类型」固化成 `window.api` 的方法签名，杜绝字符串手误。
- renderer 侧封装 `invoke<T>(channel, payload): Promise<IpcResult<T>>`，统一错误分支。
