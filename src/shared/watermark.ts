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
// 返回的是「页面左上角为原点」的坐标，直接供 canvas / pdf-lib / 视频 PNG 绘制。
//
// 布局算法：文本对齐栅格（自 5d3a766 的行错位式重写）。
//   - 行 = 沿「文本垂直方向」排布的带：带距 V 只依赖「文本高 × 页高/N」，与文本长度彻底解耦。
//   - 列 = 沿「文本方向」排布：列距 U ≥ 文本宽 × 1.6。
//   - 由此，任意文本长度 × 任意旋转角，几何上永不重叠（同行沿向分离 ≥ 文本宽，
//     跨行垂直分离 ≥ 文本高），一页 N 行在任何角度都可见（文本大到物理放不下时优雅降级）。
//   - 0° 时 V=页高/N、U=max(文本宽×1.6, V)，与旧算法逐点一致，零回归。
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
  const cosA = Math.abs(Math.cos(theta))
  // 文本方向单位向量 u（带符号，决定倾斜方向）与其垂直方向 v（旋转 +90°）。
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const vx = -uy
  const vy = ux
  // 以页面中心为原点，计算四角在 v 轴上的投影，得到页面垂直跨度 → 行距的可用范围。
  const corners: [number, number][] = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [-width / 2, height / 2],
    [width / 2, height / 2]
  ]
  const vVals = corners.map(([x, y]) => x * vx + y * vy)
  const vMin = Math.min(...vVals)
  const vMax = Math.max(...vVals)
  const vCenter = (vMin + vMax) / 2
  // 带距 V：夹紧在 [文本高×1.05（保证不重叠）, (页面垂直跨度-文本高)/(n-1)（保证 N 行全部跨页）] 之间。
  // 目标 H/(n·cosθ) 使一页 N 行（0° 即 H/N）；当 cosθ→0（近 90°）该值爆炸时用跨度上界兜底，
  // 否则行会全部跑到页外。文本高超过可用跨度时（超大字号）取文本高×1.05，放不下的行被跳过。
  const vFit = (vMax - vMin - textHeight) / Math.max(n - 1, 1)
  const V = Math.max(textHeight * 1.05, Math.min(height / (n * Math.max(cosA, 1e-4)), vFit))
  // 沿文本列距：0° 时 = max(文本宽×1.6, V)，与旧算法 sx 逐项一致。
  const U = Math.max(textWidth * 1.6, V)

  const out: WatermarkPlacement[] = []
  for (let k = 0; k < n; k++) {
    const vPos = vCenter + (k - (n - 1) / 2) * V
    // 该行直线（v=vPos）与页面矩形的交点区间 t（沿 u 方向参数，即 u 坐标）。
    // 每个轴约束：vPos·v轴 + t·u轴 ∈ [-半跨度, 半跨度]。
    let tLo = -Infinity
    let tHi = Infinity
    const clampT = (vComp: number, uComp: number, half: number): boolean => {
      if (Math.abs(uComp) > 1e-9) {
        const lo = (-half - vPos * vComp) / uComp
        const hi = (half - vPos * vComp) / uComp
        tLo = Math.max(tLo, Math.min(lo, hi))
        tHi = Math.min(tHi, Math.max(lo, hi))
      } else if (Math.abs(vPos * vComp) > half + 1e-9) {
        return false // 该轴方向分量≈0 且直线在该轴上越界 → 行不跨页
      }
      return true
    }
    if (!clampT(vx, ux, width / 2)) continue
    if (!clampT(vy, uy, height / 2)) continue
    if (tHi < tLo) continue // 行不跨页（文本过大，物理放不下）→ 跳过，避免页外多余文本
    const uMid = (tLo + tHi) / 2
    const uHalf = (tHi - tLo) / 2
    // 列：以该行弦中点为中心向两侧铺，保证每行至少 1 个文本落在页面内（短文本 + 陡角也不丢行）。
    const cMax = Math.ceil(uHalf / U)
    for (let c = -cMax; c <= cMax; c++) {
      const u = uMid + c * U
      out.push({ x: u * ux + vPos * vx + width / 2, y: u * uy + vPos * vy + height / 2 })
    }
  }
  return out
}
