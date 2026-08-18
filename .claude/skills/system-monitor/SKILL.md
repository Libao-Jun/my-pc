---
name: system-monitor
description: 实现电脑基本信息采集（CPU、内存、硬盘、操作系统、网络、进程、端口占用）。当用户要查看或开发「系统信息、硬件信息、磁盘容量、网络接口、IP/DNS/MAC、运行中进程、按端口反查占用进程」等功能时使用，即便没有明说「系统监控」。
---

# 系统信息采集

为 my-pc 的「系统信息」功能域提供统一的采集与暴露约定。所有采集逻辑运行在 Electron **主进程**，通过 IPC 暴露给渲染层，渲染进程不直接调用 Node 原生模块。

## 采集方案选型

- **`os` 内置模块**：优先用于轻量、无外部依赖的场景（CPU 架构、内存总量、主机名、临时目录、运行时长）。
- **`systeminformation` 库**：用于需要详细数据的场景（CPU 实时占用率、每个磁盘分区、每块网卡的 IP/MAC/DNS/DHCP 状态、每个进程的详情）。这是推荐的主力方案，`npm i systeminformation`。

选择原则：能用 `os` 满足的简单字段不引入额外依赖；需要「分项 / 实时 / 每接口」维度时用 `systeminformation`。

## 关键采集点

- **CPU**：`si.cpu()` 取型号/核心数，`si.currentLoad()` 取实时占用率。
- **内存**：`os.totalmem()` / `os.freemem()` 取总量与剩余；`si.mem()` 取更细的 used / active / swap。
- **硬盘**：`si.diskLayout()`（物理盘）+ `si.fsSize()`（各分区挂载、总容量 / 已用 / 可用）。
- **操作系统**：`os.version()` / `os.platform()` / `os.arch()`，配合 `si.osInfo()` 取发行版名。
- **网络**：`si.networkInterfaces()` 取每块网卡的 IP、MAC、DHCP、子网掩码；`si.networkInterfaceDefault()` 取默认网关接口；DNS 用 `si.dns` 或读取网卡的 `dhcp` 字段。
- **进程**：`si.processes()` 取运行中进程列表（pid、名称、内存占用）。
- **端口反查**：`si.processes()` 里进程的监听信息不足时，用 `netstat -ano`（Windows）解析「端口 → PID」映射，再关联到进程名。

## IPC 暴露约定

主进程用 `ipcMain.handle('system:getXxx', ...)` 注册处理器；preload 用 `contextBridge.exposeInMainWorld('systemApi', {...})` 暴露；渲染层通过 `window.systemApi.getXxx()` 调用。禁止把原始 `si` 对象直接抛给渲染层，只传序列化后的纯数据。

## 参考

具体 API 签名见 `references/systeminformation.md`。
