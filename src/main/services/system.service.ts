import os from 'node:os'
import { getServers } from 'node:dns'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as si from 'systeminformation'
import { AppError } from '@shared/errors'
import type {
  CpuInfo,
  DiskInfo,
  MemoryInfo,
  NetworkInterface,
  OsInfo,
  PortProcess,
  ProcessInfo,
  SystemOverview
} from '@shared/types'

const execFileAsync = promisify(execFile)

async function getOsInfo(): Promise<OsInfo> {
  const info = await si.osInfo()
  return {
    platform: os.platform(),
    distro: info.distro || os.type(),
    release: info.release || os.release(),
    arch: os.arch()
  }
}

export async function getOverview(): Promise<SystemOverview> {
  const [osInfo, cpu, load, mem] = await Promise.all([
    getOsInfo(),
    si.cpu(),
    si.currentLoad(),
    si.mem()
  ])
  const used = mem.used
  const usedPercent = mem.total > 0 ? Math.round((used / mem.total) * 100) : 0
  return {
    os: osInfo,
    cpu: {
      model: cpu.brand || cpu.model || '',
      cores: cpu.cores,
      loadPercent: Math.round(load.currentLoad ?? 0)
    },
    memory: {
      total: mem.total,
      used,
      free: mem.free,
      usedPercent
    }
  }
}

export async function getCpu(): Promise<CpuInfo> {
  const [cpu, load] = await Promise.all([si.cpu(), si.currentLoad()])
  return {
    model: cpu.brand || cpu.model || '',
    cores: cpu.cores,
    speedGHz: cpu.speed ?? 0,
    loadPercent: Math.round(load.currentLoad ?? 0),
    perCore: (load.cpus ?? []).map((c) => Math.round(c.load ?? 0))
  }
}

export async function getMemory(): Promise<MemoryInfo> {
  const m = await si.mem()
  const usedPercent = m.total > 0 ? Math.round((m.used / m.total) * 100) : 0
  return {
    total: m.total,
    used: m.used,
    free: m.free,
    active: m.active,
    swapTotal: m.swaptotal,
    usedPercent
  }
}

export async function getDisks(): Promise<DiskInfo[]> {
  const sizes = await si.fsSize()
  return sizes
    .filter((fs) => fs.size > 0)
    .map((fs) => ({
      device: fs.fs,
      mount: fs.mount,
      fsType: fs.type,
      total: fs.size,
      used: fs.used,
      usedPercent: Math.round(fs.use ?? 0)
    }))
}

export async function getNetwork(): Promise<NetworkInterface[]> {
  const [interfaces, defIface] = await Promise.all([
    si.networkInterfaces(),
    si.networkInterfaceDefault()
  ])
  const dns = getServers()
  return interfaces
    .filter((i) => i.iface && !i.internal && (i.ip4 || i.mac))
    .map((i) => {
      const isDefault = i.iface === defIface || i.default
      return {
        iface: i.iface,
        ip4: i.ip4 || '',
        mac: i.mac || '',
        dhcp: i.dhcp,
        subnet: i.ip4subnet || '',
        isDefault,
        dns: isDefault ? dns : []
      }
    })
}

export async function getProcesses(): Promise<ProcessInfo[]> {
  const data = await si.processes()
  return data.list
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpuPercent: Math.round(p.cpu * 100) / 100,
      memBytes: p.mem,
      user: p.user
    }))
    .sort((a, b) => b.memBytes - a.memBytes)
}

export async function getPortProcess(port: number): Promise<PortProcess | null> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_ERROR', '端口号需为 1–65535 的整数')
  }

  if (process.platform === 'win32') {
    return resolvePortWindows(port)
  }
  return resolvePortUnix(port)
}

async function resolvePortWindows(port: number): Promise<PortProcess | null> {
  const { stdout } = await execFileAsync('netstat', ['-ano'])
  const suffix = `:${port}`
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4) continue
    const protocol = parts[0].toLowerCase()
    const local = parts[1]
    // 只匹配「本机监听地址」末尾的 :port，避免误命中远端地址恰为该端口的连接
    if (!local.endsWith(suffix)) continue
    const pid = Number.parseInt(parts[parts.length - 1], 10)
    if (!Number.isInteger(pid) || pid <= 0) continue
    return {
      port,
      pid,
      name: await resolvePidName(pid),
      protocol: protocol === 'udp' ? 'udp' : 'tcp'
    }
  }
  return null
}

async function resolvePortUnix(port: number): Promise<PortProcess | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-i',
      `tcp:${port}`,
      '-sTCP:LISTEN',
      '-P',
      '-n'
    ])
    const lines = stdout.split(/\r?\n/)
    if (lines.length < 2) return null
    const parts = lines[1].trim().split(/\s+/)
    return {
      port,
      pid: Number.parseInt(parts[1], 10),
      name: parts[0],
      protocol: 'tcp'
    }
  } catch {
    return null
  }
}

async function resolvePidName(pid: number): Promise<string> {
  try {
    const data = await si.processes()
    return data.list.find((p) => p.pid === pid)?.name ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
