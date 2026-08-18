import { registerAdblockIpc } from './adblock.ipc'
import { registerAppIpc } from './app.ipc'
import { registerFileIpc } from './file.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerSystemIpc } from './system.ipc'

export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerSystemIpc()
  registerFileIpc()
  registerAdblockIpc()
}
