import { computeWatermarkPlacements, DEFAULT_WATERMARK_CONFIG } from '../src/shared/watermark.ts'
import type { WatermarkConfig } from '../src/shared/watermark.ts'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg)
}

const base: WatermarkConfig = { ...DEFAULT_WATERMARK_CONFIG }

// single + center → 恰 1 个锚点，落在 (500, 300)
const single = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', hAlign: 'center', vAlign: 'middle' }, 80)
assert(single.length === 1, 'single 应返回 1 个锚点，实际 ' + single.length)
assert(Math.abs(single[0].x - 500) < 1 && Math.abs(single[0].y - 300) < 1, 'single 居中锚点应落在 (500,300)')

// single + top-left → 锚点靠近左上
const tl = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', hAlign: 'left', vAlign: 'top' }, 80)
assert(tl[0].x < 200 && tl[0].y < 200, 'top-left 应在左上角')

// multi3 → 恰好 3 条 y 带，间距 = 600/3 = 200
const multi3 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi3' }, 80)
const ys3 = [...new Set(multi3.map((p) => Math.round(p.y)))].sort((a, b) => a - b)
assert(ys3.length === 3, 'multi3 应有 3 条 y 带，实际 ' + ys3.length)
assert(Math.abs(ys3[1] - ys3[0] - 200) <= 1, 'multi3 带间距应为 200')
assert(Math.abs(ys3[2] - ys3[1] - 200) <= 1, 'multi3 带间距应为 200')

// 带符号 tan：旋转 -45°（默认）时 dx = sy/tan(-45°) = -sy = -200，相邻行应左移（斜线带跟随文字 / 方向）。
// 用 textWidth=200 使 sx=320 > |dx|=200，避免 sx=|dx| 时网格退化：左移时行1 的 c=0 锚点落在 x=300，
// 右移（abs）时该锚点落在 x=700（300 处无锚点），据此区分方向。
const dir = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi3' }, 200)
const row1Shifted = dir.some((p) => Math.abs(p.y - 300) < 1 && Math.abs(p.x - 300) <= 1)
assert(row1Shifted, '旋转 -45° 时行1 的 c=0 锚点应左移到 x=300（dx=-200，跟随文字 / 方向）')

// multi8 → 8 条带
const multi8 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi8' }, 80)
const ys8 = new Set(multi8.map((p) => Math.round(p.y)))
assert(ys8.size === 8, 'multi8 应有 8 条 y 带，实际 ' + ys8.size)

// multi2 / multi6 覆盖
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi2' }, 80).map((p) => Math.round(p.y))).size === 2, 'multi2 应为 2 条带')
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi6' }, 80).map((p) => Math.round(p.y))).size === 6, 'multi6 应为 6 条带')

// —— 回归：布局 + 旋转不得产生文本重叠 ——
// 旋转后的文本按宽 textW / 高 textH 的矩形，绕其中心旋转 rotation 度绘制；
// 用 SAT 判定任意两个矩形是否相交。历史缺陷：间距只按未旋转宽度计算，
// 旋转 ≠0 时相邻行文本沿阅读方向被拉近（间距 sy/|sinθ| < textW），行合并、重叠成连续斜线。
interface Rect { cx: number; cy: number; hw: number; hh: number; angle: number }
function rectCorners(r: Rect): [number, number][] {
  const cos = Math.cos(r.angle); const sin = Math.sin(r.angle)
  const dx = [r.hw, r.hw, -r.hw, -r.hw]; const dy = [r.hh, -r.hh, -r.hh, r.hh]
  return dx.map((x, i) => [r.cx + x * cos - dy[i] * sin, r.cy + x * sin + dy[i] * cos])
}
function rectsOverlap(a: Rect, b: Rect): boolean {
  const pa = rectCorners(a); const pb = rectCorners(b)
  const axes: [number, number][] = []
  for (const p of [pa, pb]) for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4; axes.push([p[j][0] - p[i][0], p[j][1] - p[i][1]])
  }
  for (const [ax, ay] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity
    for (const [x, y] of pa) { const v = x * ax + y * ay; amin = Math.min(amin, v); amax = Math.max(amax, v) }
    for (const [x, y] of pb) { const v = x * ax + y * ay; bmin = Math.min(bmin, v); bmax = Math.max(bmax, v) }
    if (amax < bmin || bmax < amin) return false
  }
  return true
}
function assertNoOverlap(W: number, H: number, layout: WatermarkConfig['layout'], rotation: number, textW: number, textH: number, label: string): void {
  const cfg: WatermarkConfig = { ...base, layout, rotation, hAlign: 'center', vAlign: 'middle' }
  const ps = computeWatermarkPlacements(W, H, cfg, textW, textH)
  const theta = (rotation * Math.PI) / 180
  const rects: Rect[] = ps.map((p) => ({ cx: p.x, cy: p.y, hw: textW / 2, hh: textH / 2, angle: theta }))
  let ov = 0
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i], rects[j])) ov++
  assert(ov === 0, `${label}：布局 ${layout} 旋转 ${rotation}° 文本重叠 ${ov} 对，应与所选行数一致且不重叠`)
}
// 长文本 + 旋转（历史缺陷触发场景：行合并成斜线）
assertNoOverlap(595, 842, 'multi6', 45, 320, 56, 'A4 六行 45° 长文本')
assertNoOverlap(595, 842, 'multi6', -45, 320, 56, 'A4 六行 -45° 长文本')
assertNoOverlap(595, 842, 'multi8', 45, 160, 56, 'A4 八行 45° 中长文本')
assertNoOverlap(1000, 600, 'multi8', 45, 120, 56, '画布八行 45° 中文本')
// 小页 + 密排（0° 也存在潜在垂直重叠）
assertNoOverlap(600, 400, 'multi8', 0, 240, 56, '小页八行 0° 长文本')
// 短文本 + 旋转（不应破坏原本正常场景）
assertNoOverlap(595, 842, 'multi6', 45, 80, 56, 'A4 六行 45° 短文本')

console.log('ALL_WATERMARK_LAYOUT_TESTS_PASSED')
