import { ipcMain } from 'electron'
import {
  getCpu,
  getDisks,
  getMemory,
  getNetwork,
  getOverview,
  getPortProcess,
  getProcesses
} from '../services/system.service'

export function registerSystemIpc(): void {
  ipcMain.handle('system:getOverview', () => getOverview())
  ipcMain.handle('system:getCpu', () => getCpu())
  ipcMain.handle('system:getMemory', () => getMemory())
  ipcMain.handle('system:getDisks', () => getDisks())
  ipcMain.handle('system:getNetwork', () => getNetwork())
  ipcMain.handle('system:getProcesses', () => getProcesses())
  ipcMain.handle('system:getPortProcess', (_event, arg: { port: number }) => {
    return getPortProcess(arg?.port ?? NaN)
  })
}
