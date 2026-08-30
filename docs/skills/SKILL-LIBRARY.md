# 📚 项目Skill库（动态维护，随开发迭代更新）

> 说明：Skill 库为当前项目可复用逻辑集合，后续开发遇到对应场景直接调用对应 Skill，禁止重复实现；状态分为【生效｜待优化｜已废弃】。每轮代码处理后在 `docs/skills/CURATOR_REPORT.md` 记录变更。

| Skill ID | Skill名称 | 能力描述 | 输入参数 | 输出/返回结果 | 使用约束&边界 | 示例调用方式 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-001 | skill-curator | 维护本仓库 Skill 库的自适应管家：检测/新增/修改/合并/精简/归档可复用 Skill，输出索引表并强制复用优先 | SKILL_ROOT 路径、检测摘要、待评估的代码或 Skill | 更新后的 Skill 库、检测摘要、CURATOR_REPORT.md | 非破坏性（归档可恢复）；不触碰 `src/`、`.claude/skills/skill-factory/`、既有 28 个 skill | 说「整理 skill 库」或「重新梳理Skill库」 | 生效 |
| SK-002 | watermark-layout | 多行水印平铺算法（`computeWatermarkPlacements`）：**文本对齐栅格**（2026-08-30 重构，取代行错位式）。行 = 沿文本垂直方向 v 的带，列 = 沿文本方向 u 的列。带距 `V = max(textH·1.05, min(H/(N·cosθ), (页v跨度−textH)/(N−1)))`（与文本长度解耦），列距 `U = max(textW·1.6, V)`。保证：任意文本长度 × 任意角度（-89°~89°）0 重叠（同行沿向分离 ≥ textW、跨行垂直分离 ≥ textH）；N 行在任何角度可见（物理放不下时优雅降级不超 N、不崩溃）；0° 与旧算法逐点一致（V=H/N、U=max(textW·1.6,V)）。每行按自身与页面的交弦布列（保证每行至少 1 文本落页）。单一真相源供 canvas/PDF/视频/预览四路共用。文本宽禁止按「字符数×0.6」估算（CJK≈1.0em，混合文本低估 ~24% 致合并），PDF 用 `font.widthOfTextAtSize` 精确测量、无测量环境用 `estimateTextWidth`。**预览与真实输出一致性契约**（2026-08-30 修复「预览≠输出」后固化）：textHeight 全路径统一 1.4em（canvas 不再按 actualBoundingBox 取高）；PDF 输出恒内嵌 SimHei（msyh.ttc 等 TTC 经 fontkit 内嵌失败回退 simhei）→ PDF 预览必须用 `fontFamily:'SimHei'` 绘制；pdf-lib `degrees(+θ)` 在 y-up 空间为逆时针（Tm 基线向量 (cosθ,sinθ) 指向右上），须 `degrees(-rotation)` 才与 canvas `rotate(+θ)` 顺时针语义一致；布局算法严格缩放不变（预览等比缩小原件须同步缩放 fontSize 与 textWidth/textHeight） | width, height, config, textWidth?, textHeight? | WatermarkPlacement[]（页面坐标） | 纯 TS 无运行时导入；重叠验证用 SAT 穷举 6048 例（6 页型×4 布局×21 角×12 文本宽）；缩放不变性回归在 `scripts/verify-watermark.ts`；`scripts/verify-watermark.ts` 为回归基准 | `computeWatermarkPlacements(W, H, cfg, tw, th)` | 生效 |

> 新增分配递增 Skill ID；修改直接更新对应行；废弃改状态保留记录；待优化标记迭代点。
