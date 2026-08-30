// gifenc@1.0.3 未内置 TypeScript 类型，这里给出最小声明（仅覆盖本模块用到的 API）。
declare module 'gifenc' {
  export type GifPalette = number[][]
  export interface GifFrameOptions {
    palette?: GifPalette
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    repeat?: number
    dispose?: number
    first?: boolean
  }
  export interface GIFEncoderStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    writeHeader(): void
    reset(): void
    buffer: ArrayBuffer
    stream: unknown
  }
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: object): GifPalette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: string): Uint8Array
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GIFEncoderStream
}
