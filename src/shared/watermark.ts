// 跨进程共享的水印模型与布局算法 —— 单一真相源（渲染层 canvas / 主进程 pdf-lib / 视频水印 PNG 共用）。
// 纯 TS、无任何运行时导入，保证 Node 验证脚本可直接执行。

export type WatermarkPosition =
  | 'center'
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type WatermarkLayout = 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'

export interface WatermarkConfig {
  text: string
  fontFamily: string
  fontSize: number
  opacity: number
  rotation: number
  layout: WatermarkLayout
  position: WatermarkPosition
  applyToAllPages: boolean
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: '机密',
  fontFamily: 'Microsoft YaHei',
  fontSize: 40,
  opacity: 0.3,
  rotation: -45,
  layout: 'multi3',
  position: 'center',
  applyToAllPages: true
}

export interface WatermarkPlacement {
  x: number
  y: number
}

function positionAnchor(w: number, h: number, position: WatermarkPosition): WatermarkPlacement {
  const m = Math.min(w, h) * 0.06
  switch (position) {
    case 'top-left': return { x: m, y: m }
    case 'top-center': return { x: w / 2, y: m }
    case 'top-right': return { x: w - m, y: m }
    case 'center-left': return { x: m, y: h / 2 }
    case 'center-right': return { x: w - m, y: h / 2 }
    case 'bottom-left': return { x: m, y: h - m }
    case 'bottom-center': return { x: w / 2, y: h - m }
    case 'bottom-right': return { x: w - m, y: h - m }
    default: return { x: w / 2, y: h / 2 }
  }
}

// 坐标系约定：y 轴向下（canvas 惯例）；PDF 消费方在绘制时自行翻转 y。
export function computeWatermarkPlacements(
  width: number,
  height: number,
  config: WatermarkConfig,
  textWidth = 0
): WatermarkPlacement[] {
  if (config.layout === 'single') return [positionAnchor(width, height, config.position)]

  const n = Number(config.layout.replace('multi', ''))
  if (!Number.isFinite(n) || n < 1) return [positionAnchor(width, height, config.position)]

  const theta = (config.rotation * Math.PI) / 180
  const sy = height / n
  const sx = Math.max(textWidth * 1.6, sy)
  const tan = Math.abs(Math.tan(theta))
  const dx = tan > 1e-6 ? sy / tan : 0
  const halfCols = Math.ceil(width / sx / 2) + 1

  const out: WatermarkPlacement[] = []
  for (let r = 0; r < n; r++) {
    const y = sy / 2 + r * sy
    for (let c = -halfCols; c <= halfCols; c++) {
      out.push({ x: width / 2 + c * sx + r * dx, y })
    }
  }
  return out
}
