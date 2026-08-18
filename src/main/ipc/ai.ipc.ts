import { ipcMain } from 'electron'
import { test } from '../ai/adapter'

export function registerAiIpc(): void {
  // 仅测试连接暴露给渲染层；complete 是主进程内部接口，不建 IPC 通道（YAGNI）
  ipcMain.handle('ai:test', () => test())
}
