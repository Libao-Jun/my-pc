# systeminformation 关键 API 速查

> 安装：`npm i systeminformation`（在主进程调用）。所有方法返回 Promise。

| 方法 | 返回值要点 | 典型用途 |
|------|-----------|---------|
| `si.cpu()` | manufacturer / brand, cores, speed | CPU 型号与核心数 |
| `si.currentLoad()` | currentLoad, avgLoad, cpus[] | 实时 / 平均负载 |
| `si.mem()` | total, free, used, active, swap* | 内存详情 |
| `si.diskLayout()` | device, type, size, name | 物理硬盘清单 |
| `si.fsSize()` | fs, type, size, used, use% | 各分区容量 / 占用率 |
| `si.osInfo()` | distro, release, codename, arch | 操作系统版本 |
| `si.networkInterfaces()` | iface, ip4, mac, dhcp, subnet | 网卡 IP / MAC / DHCP |
| `si.networkInterfaceDefault()` | 默认接口名 | 定位默认网卡 / 网关 |
| `dns.getServers()`（`node:dns`） | DNS 服务器列表 | 当前 DNS（v5 已移除 `si.dns`，改用 Node 内置 `node:dns`） |
| `si.processes()` | list[]: pid, name, mem | 进程列表 |
| `si.processLoad(pid)` | cpu / mem 占用 | 单进程资源 |

## 端口 → 进程反查（Windows）

`systeminformation` 不直接给「端口 → 进程」映射，用系统命令兜底：执行 `netstat -ano` 后在 JS 内解析，只匹配**本机监听地址**（`local` 列）末尾的 `:port`，避免误命中「远端地址恰好为该端口」的连接；最后一列为 PID，再用 `si.processes()` 关联进程名。端口参数需 `Number.isInteger` 且 1–65535 校验，防注入。
