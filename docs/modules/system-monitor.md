# 模块设计：系统信息（system-monitor）

对应需求 1：查看电脑的基本信息、网络信息、进程信息与端口占用。

## 1. 需求

- 查看 CPU、内存、硬盘、操作系统、版本号、总 / 已用容量。
- 查看网络：IP、网关、子网掩码、DNS、MAC、DHCP 状态、接口、状态、类型。
- 查看进程：运行中进程、内存占用；按端口反查占用进程。

## 2. 设计

### 2.1 采集方案

主进程 `services/system.service.ts` 承担全部采集：

- **`os` 内置模块**：主机名、架构、平台、内存总量（`os.totalmem` / `freemem`）。
- **`systeminformation` 库**：CPU 详情与实时负载、磁盘分区、网络接口、进程列表（见 `../skills/` 中的 API 速查，实现细节遵循 `system-monitor` 技能）。

### 2.2 端口反查

`systeminformation` 不给「端口 → 进程」，用命令兜底：

```
netstat -ano | findstr :<port>
```

解析出 PID 后，用 `si.processes()` 或 `tasklist /FI "PID eq <pid>"` 关联进程名。实现封装成 `resolvePort(port): Promise<PortProcess | null>`，屏蔽平台差异。

## 3. IPC 接口

见 `docs/API_SPEC.md` §3：`system:getOverview` / `getCpu` / `getMemory` / `getDisks` / `getNetwork` / `getProcesses` / `getPortProcess`。

实时数据（CPU 负载）由渲染层轮询 `system:getOverview`（默认 2s 间隔，可在设置调整）。

## 4. 数据

本模块**只读**，不落库。采集结果序列化后直接返回渲染层。

## 5. UI

页面 `pages/SystemMonitor/`：`SystemOverviewPage` + `CpuPanel` / `MemoryPanel` / `DiskPanel` / `NetworkPanel` / `ProcessPanel` / `PortLookup`（见 `COMPONENT_LIBRARY.md` §3.1）。

## 6. 关键实现要点

- 采集只在主进程，渲染层不 import `systeminformation` / `os`。
- 进程列表可能很大（数百条），支持按 CPU / 内存排序、分页或虚拟滚动。
- 数值统一字节（`number`），渲染层用 `formatBytes` 格式化。
- `netstat` 命令只拼 `findstr :<port>`，端口参数用 `parseInt` 校验（1–65535），防注入。

## 7. 验收标准

- [ ] 概览页正确展示 OS / CPU / 内存 / 磁盘总容量与已用容量。
- [ ] 网络面板列出每块网卡的 IP / MAC / DNS / DHCP 状态。
- [ ] 进程面板展示运行中进程及内存占用，可排序。
- [ ] 输入一个已占用端口，能反查到对应进程名与 PID；未占用端口返回空态。
