# Skill 库维护报告（CURATOR_REPORT）

> 维护动作遵循非破坏性约定：合并/归档前原文移入 `docs/skills/_archive/`；每次重梳理追加本节记录。

## 2026-08-30 — 新增 SK-002 watermark-layout

**触发**：修复「布局 + 旋转重叠」系列缺陷（含用户报告的长混合文本 ≥10° 合并、图片/PDF/视频三路径）。

**变更**：`docs/skills/SKILL-LIBRARY.md` 新增 SK-002（状态：生效）。记录复用不变量，防止后续重写或重犯：
- 四项间距条件（同行/同列/跨行跨列/对角带垂直间距），保证任意文本长度 × -45°~45° 无重叠；
- 文本宽估算陷阱：`字符数×0.6` 对混合 CJK+ASCII 低估 ~24%（CJK≈1.0em/字）；PDF 用 `font.widthOfTextAtSize` 精确测量，`estimateTextWidth` 作无测量环境兜底默认；
- 单一真相源 `src/shared/watermark.ts` 四路共用；SAT 重叠判定；`scripts/verify-watermark.ts` 为回归基准。

**验证**：穷举 4560 例（6 页型 × 4 布局 × -45°~45° 19 角 × 文本宽 40~1200）0 重叠；`node scripts/verify-watermark.ts` → `ALL_WATERMARK_LAYOUT_TESTS_PASSED`；双 typecheck 零错误。
