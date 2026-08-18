import { registerAdblockIpc } from './adblock.ipc'
import { registerAiIpc } from './ai.ipc'
import { registerAppIpc } from './app.ipc'
import { registerDiagramIpc } from './diagram.ipc'
import { registerFileIpc } from './file.ipc'
import { registerResumeIpc } from './resume.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerSystemIpc } from './system.ipc'

export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerResumeIpc()
  registerDiagramIpc()
  registerAiIpc()
  registerSystemIpc()
  registerFileIpc()
  registerAdblockIpc()
}
