// 跨进程共享的水印模型与布局算法 —— 单一真相源（渲染层 canvas / 主进程 pdf-lib / 视频水印 PNG 共用）。
// 纯 TS、无任何运行时导入，保证 Node 验证脚本可直接执行。

export type WatermarkLayout = 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'
export type WatermarkHAlign = 'left' | 'center' | 'right'
export type WatermarkVAlign = 'top' | 'middle' | 'bottom'
export type WatermarkPageScope = 'all' | 'odd' | 'even'

export interface WatermarkConfig {
  text: string
  fontFamily: string
  fontSize: number
  opacity: number
  rotation: number
  layout: WatermarkLayout
  hAlign: WatermarkHAlign
  vAlign: WatermarkVAlign
  pageScope: WatermarkPageScope
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: '机密',
  fontFamily: 'Microsoft YaHei',
  fontSize: 40,
  opacity: 0.3,
  rotation: -45,
  layout: 'multi3',
  hAlign: 'center',
  vAlign: 'middle',
  pageScope: 'all'
}

export interface WatermarkPlacement {
  x: number
  y: number
}

function positionAnchor(w: number, h: number, config: WatermarkConfig): WatermarkPlacement {
  const m = Math.min(w, h) * 0.06
  const x = config.hAlign === 'left' ? m : config.hAlign === 'right' ? w - m : w / 2
  const y = config.vAlign === 'top' ? m : config.vAlign === 'bottom' ? h - m : h / 2
  return { x, y }
}

// 文本宽度估算（无测量环境时的回退默认，如纯 Node 校验脚本 / 未传 textWidth 的调用方）：
// CJK 等全角字符 ≈1.0em、空格 ≈0.35em、其余半角（数字/字母/标点）≈0.6em。
// 若统一按「字符数×0.6」估算，混合中英文长文本会严重低估（CJK 约占 1.0em），
// 导致旋转布局按窄文本排布、实际更宽 → 相邻行沿阅读方向重叠合并。
export function estimateTextWidth(text: string, fontSize: number): number {
  let ems = 0
  for (const ch of text) {
    if (ch === ' ') ems += 0.35
    else if (/[^\x00-\x7F]/.test(ch)) ems += 1.0
    else ems += 0.6
  }
  return ems * fontSize
}

// 坐标系约定：y 轴向下（canvas 惯例）；PDF 消费方在绘制时自行翻转 y。
export function computeWatermarkPlacements(
  width: number,
  height: number,
  config: WatermarkConfig,
  textWidth = estimateTextWidth(config.text, config.fontSize),
  textHeight = config.fontSize * 1.4
): WatermarkPlacement[] {
  if (config.layout === 'single') return [positionAnchor(width, height, config)]

  const n = Number(config.layout.replace('multi', ''))
  if (!Number.isFinite(n) || n < 1) return [positionAnchor(width, height, config)]

  const theta = (config.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  // 文本旋转后的世界包围盒（水平/垂直投影尺寸）。间距必须容纳它，
  // 否则旋转 ≠0 时相邻行文本沿阅读方向被拉近（间距 sy/|sinθ| < textWidth），行合并成连续斜线。
  const rotatedW = textWidth * cos + textHeight * sin
  const SAFETY = 1.05
  // 行距：容纳「未旋转时的文本高」（密排小页 0° 也可能重叠）与「旋转后沿阅读方向相邻行的文本长」
  const sy = Math.max(height / n, textHeight * SAFETY, textWidth * sin * SAFETY)
  // 列距四项，任一不足即产生重叠：
  //  ① 同行沿向 ≥ 文本宽（0° 时文本水平互不压） ② ≥ 行距（低行距兜底）
  //  ③ 旋转后水平投影 ≥ 包围盒 ④ 相邻对角带垂直向间距 = sx·|sinθ| 须 ≥ 文本高。
  //     第 ④ 项缺失时（如小页 8 行 + 低旋转角 + 短/长文本），行错位后跨列的
  //     相邻文本沿阅读方向残差 < 文本宽 → 几百对文本重叠成行，历史缺陷复现。
  const sx = Math.max(textWidth * 1.6, sy, rotatedW * SAFETY, sin > 1e-6 ? (textHeight / sin) * SAFETY : 0)
  const tan = Math.tan(theta)
  // 带符号 tan：让相邻行错位方向跟随文字倾斜方向（旋转 -45° 时斜线带与文字同向，经典防伪水印外观）
  const dx = Math.abs(tan) > 1e-6 ? sy / tan : 0
  // 行位移 r·dx 使各行横向偏移：列数须覆盖「页宽 + 两侧最大位移」，保证旋转布局仍铺满页面
  const halfCols = Math.ceil((width + 2 * (n - 1) * Math.abs(dx)) / sx / 2) + 1

  const out: WatermarkPlacement[] = []
  for (let r = 0; r < n; r++) {
    const y = sy / 2 + r * sy
    for (let c = -halfCols; c <= halfCols; c++) {
      out.push({ x: width / 2 + c * sx + r * dx, y })
    }
  }
  return out
}
