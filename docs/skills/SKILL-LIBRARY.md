# 📚 项目Skill库（动态维护，随开发迭代更新）

> 说明：Skill 库为当前项目可复用逻辑集合，后续开发遇到对应场景直接调用对应 Skill，禁止重复实现；状态分为【生效｜待优化｜已废弃】。每轮代码处理后在 `docs/skills/CURATOR_REPORT.md` 记录变更。

| Skill ID | Skill名称 | 能力描述 | 输入参数 | 输出/返回结果 | 使用约束&边界 | 示例调用方式 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-001 | skill-curator | 维护本仓库 Skill 库的自适应管家：检测/新增/修改/合并/精简/归档可复用 Skill，输出索引表并强制复用优先 | SKILL_ROOT 路径、检测摘要、待评估的代码或 Skill | 更新后的 Skill 库、检测摘要、CURATOR_REPORT.md | 非破坏性（归档可恢复）；不触碰 `src/`、`.claude/skills/skill-factory/`、既有 28 个 skill | 说「整理 skill 库」或「重新梳理Skill库」 | 生效 |
| SK-002 | watermark-layout | 多行水印平铺算法（`computeWatermarkPlacements`）：任意文本长度 × 任意旋转角保证无重叠、斜线带不与文本合并。单一真相源供 canvas/PDF/视频/预览四路共用。关键不变量：①同行沿向 `sx·|cosθ|` 或垂直 `sx·|sinθ|` ≥ 文本宽/高；②同列相邻行沿向 `sy/|sinθ|` ≥ 文本宽；③跨行跨列垂直 `sx·|sinθ|` ≥ 文本高；④文本宽禁止按「字符数×0.6」估算（CJK≈1.0em，混合文本会低估 ~24% 致合并），PDF 用 `font.widthOfTextAtSize` 精确测量、无测量环境用 `estimateTextWidth` | width, height, config, textWidth?, textHeight? | WatermarkPlacement[] | 纯 TS 无运行时导入；重叠验证用 SAT；`scripts/verify-watermark.ts` 为回归基准 | `computeWatermarkPlacements(W, H, cfg, tw, th)` | 生效 |

> 新增分配递增 Skill ID；修改直接更新对应行；废弃改状态保留记录；待优化标记迭代点。
