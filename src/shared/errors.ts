import type { AppErrorShape, ErrorCode } from './types'

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message }
  }
}
