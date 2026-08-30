# Skill 库维护报告（CURATOR_REPORT）

> 维护动作遵循非破坏性约定：合并/归档前原文移入 `docs/skills/_archive/`；每次重梳理追加本节记录。

## 2026-08-30 — 新增 SK-002 watermark-layout

**触发**：修复「布局 + 旋转重叠」系列缺陷（含用户报告的长混合文本 ≥10° 合并、图片/PDF/视频三路径）。

**变更**：`docs/skills/SKILL-LIBRARY.md` 新增 SK-002（状态：生效）。记录复用不变量，防止后续重写或重犯：
- 四项间距条件（同行/同列/跨行跨列/对角带垂直间距），保证任意文本长度 × -45°~45° 无重叠；
- 文本宽估算陷阱：`字符数×0.6` 对混合 CJK+ASCII 低估 ~24%（CJK≈1.0em/字）；PDF 用 `font.widthOfTextAtSize` 精确测量，`estimateTextWidth` 作无测量环境兜底默认；
- 单一真相源 `src/shared/watermark.ts` 四路共用；SAT 重叠判定；`scripts/verify-watermark.ts` 为回归基准。

**验证**：穷举 4560 例（6 页型 × 4 布局 × -45°~45° 19 角 × 文本宽 40~1200）0 重叠；`node scripts/verify-watermark.ts` → `ALL_WATERMARK_LAYOUT_TESTS_PASSED`；双 typecheck 零错误。

## 2026-08-30 — SK-002 重构为「文本对齐栅格」（行错位式废弃）

**触发**：用户报告「一页六行/八行 + 长文本（16 字≈640px）旋转时文本一直重叠、字号过大也重叠」。检测结论：旧行错位式在几何上 0 重叠（SAT），但真实缺陷是 **行数崩塌**——行距 `sy ≥ 文本宽×sinθ`，640px 文本 45° 时 sy≈475 → 一页只剩 2~3 行；超大字号时行距被文本高顶爆、行溢出页外。用户感知为「重叠」。

**变更**：`src/shared/watermark.ts` 的 `computeWatermarkPlacements` 重构为**文本对齐栅格**（SK-002 行同步重写）：
- 行 = 沿文本垂直方向 v 的带，`V = max(textH·1.05, min(H/(N·cosθ), (页v跨度−textH)/(N−1)))`，与文本长度彻底解耦；
- 列 = 沿文本方向 u，`U = max(textW·1.6, V)`；每行按自身与页面交弦布列，保证每行 ≥1 文本落页；
- `vFit` 预留文本高边界避免 ±89° 行贴页切线被跳过；cosθ→0 时用 v 跨度夹紧防 V 爆炸；
- `scripts/verify-watermark.ts`：删除旧「行错位方向」测试，新增「任意角度可见带数 = N」扫描（4 页型×4 布局×±89°~±45°×3 文本宽）、超大字号优雅降级、±89°/超长文本无重叠用例；基线带数测试显式 `rotation:0`。

**验证**：穷举 6048 例（6 页型 × 4 布局 × -89°~89° 21 角 × 文本宽 40~2000）真实实现 0 重叠；0° 与旧算法逐点一致（无回归）；`ALL_WATERMARK_LAYOUT_TESTS_PASSED`；双 typecheck 零错误。消费方 API 与页面坐标不变，四路零改动。

## 2026-08-30 — 修复「预览效果 vs 处理输出不一致」（图片/PDF/视频三类型）

**触发**：用户报告「水印效果预览效果和开始处理后下载后的不一致」，并补充「图片、PDF 和视频的预览效果和开始处理处理后的效果必须一致」。

**检测**（缩放不变性实证 0.000px）：图片/视频路径预览与输出共用 `drawWatermarkOn` 且布局算法严格缩放不变，本就一致；**不一致仅存在于 PDF 路径**，四源：
1. 字体：预览用 `config.fontFamily`（默认 YaHei），输出恒内嵌 **simhei**（`msyh.ttc`/`simsun.ttc` 的 TTC 经 fontkit 内嵌失败，已实证 `this.font.layout is not a function`）→ 字形不同；
2. 文本宽：预览 canvas 测 YaHei vs 输出 simhei `widthOfTextAtSize` → 列距 U 不同；
3. 文本高：预览 `max(actualBoundingBoxAscent+Descent, 1.2em)` vs 输出 `1.4em` → 密排/大字号时行距 V 不同；
4. 旋转方向：pdfjs 实证 `degrees(45)` 的 Tm 矩阵 `[0.7071 0.7071 -0.7071 0.7071]` 基线指向右上 = y-up 逆时针；canvas `rotate(+θ)` 在 y-down 为顺时针 → **同一 rotation 值倾斜方向镜像**。

**变更**：
- `watermark.service.ts`：`rotate: degrees(-config.rotation)`（正角=顺时针，与 canvas 及图片/视频统一）；
- `watermarkRenderer.ts` `drawWatermarkOn`：textHeight 统一 `fontSize*1.4`（弃用 actualBoundingBox 取高）→ 三类型行距语义一致；
- `watermarkPreview.ts` PDF 分支：`fontFamily:'SimHei'` 绘制（对齐输出恒内嵌 simhei）；
- `scripts/verify-watermark.ts`：新增缩放不变性回归（4 分辨率 × 3 缩放比 × 2 文本宽，断言锚点数一致且偏差 <0.5px）。

**验证**：`ALL_WATERMARK_LAYOUT_TESTS_PASSED`；双 typecheck 零错误。已知边缘：PDF 页含 `/Rotate` 元数据时预览（pdfjs 应用旋转显示）与输出（pdf-lib 未旋转空间绘制）仍不一致，留待后续处理。
