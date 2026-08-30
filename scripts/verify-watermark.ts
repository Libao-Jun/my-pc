import { computeWatermarkPlacements, DEFAULT_WATERMARK_CONFIG } from '../src/shared/watermark.ts'
import type { WatermarkConfig } from '../src/shared/watermark.ts'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg)
}

const base: WatermarkConfig = { ...DEFAULT_WATERMARK_CONFIG }

// single + center → 恰 1 个锚点，落在 (500, 300)
const single = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', position: 'center' }, 80)
assert(single.length === 1, 'single 应返回 1 个锚点，实际 ' + single.length)
assert(Math.abs(single[0].x - 500) < 1 && Math.abs(single[0].y - 300) < 1, 'single 居中锚点应落在 (500,300)')

// single + top-left → 锚点靠近左上
const tl = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', position: 'top-left' }, 80)
assert(tl[0].x < 200 && tl[0].y < 200, 'top-left 应在左上角')

// multi3 → 恰好 3 条 y 带，间距 = 600/3 = 200
const multi3 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi3' }, 80)
const ys3 = [...new Set(multi3.map((p) => Math.round(p.y)))].sort((a, b) => a - b)
assert(ys3.length === 3, 'multi3 应有 3 条 y 带，实际 ' + ys3.length)
assert(Math.abs(ys3[1] - ys3[0] - 200) <= 1, 'multi3 带间距应为 200')
assert(Math.abs(ys3[2] - ys3[1] - 200) <= 1, 'multi3 带间距应为 200')

// multi8 → 8 条带
const multi8 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi8' }, 80)
const ys8 = new Set(multi8.map((p) => Math.round(p.y)))
assert(ys8.size === 8, 'multi8 应有 8 条 y 带，实际 ' + ys8.size)

// multi2 / multi6 覆盖
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi2' }, 80).map((p) => Math.round(p.y))).size === 2, 'multi2 应为 2 条带')
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi6' }, 80).map((p) => Math.round(p.y))).size === 6, 'multi6 应为 6 条带')

console.log('ALL_WATERMARK_LAYOUT_TESTS_PASSED')
