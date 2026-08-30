# 模块设计：水印保护（watermark）

对应需求 6：给图片、PDF、视频添加可定制的防伪文字水印。

## 1. 需求

- 可定制：水印文本、字体、字号、不透明度、旋转角度、布局（单行 / 一页两行/三行/六行/八行）、文本位置（单行）、是否应用于全部页面（PDF）。
- 图片 / PDF 批量；视频单文件。
- 输出另存为 `原名.水印.ext`，**保持原格式**（`.jpg`→`.jpg`、`.jpeg`→`.jpeg` 逐字一致）。

## 2. 设计

- 布局算法单一真相源：`src/shared/watermark.ts` 的 `computeWatermarkPlacements`（canvas / pdf-lib / 视频水印 PNG 共用）。
- 图片：渲染层 canvas 管线（`src/renderer/src/utils/watermarkRenderer.ts`），png/jpg/jpeg/webp 用 `toBlob`，bmp 手写编码器，gif 用 `gifenc` 输出静态帧。
- PDF：主进程 `pdf-lib`，嵌入系统 CJK 字体（simhei→msyh→simsun 候选），`applyToAllPages` 控制全部页 / 仅首页。
- 视频：主进程 ffmpeg，透明水印 PNG 覆盖层 + overlay，音频 `-c:a copy`，进度按 `time=` 解析。

## 3. IPC 接口

见 `API_SPEC.md` §watermark：`pickFiles` / `readBinary` / `writeFile` / `applyPdf` / `getVideoInfo` / `applyVideo` / `cancelVideo`。

## 4. 数据

无持久化（不建表）；会话内队列存于 `watermarkStore`。

## 5. UI

页面 `pages/Watermark/`：`WatermarkPage` + `WatermarkConfigForm` / `WatermarkPreview` / `WatermarkQueue`。

## 6. 关键实现要点

- 输出路径 `watermarkOutputPath` 主进程统一去重（`原名.水印(1).ext`）。
- 水印颜色固定 `#808080`；透明度 0.05–1；旋转 -90~90。
- 视频覆盖层 PNG 由渲染层按视频分辨率生成（`renderWatermarkPng`），与图片管线共用 `drawWatermarkOn`。
- ffmpeg 依赖 `ffmpeg-static`，打包时 `asarUnpack: node_modules/ffmpeg-static/**`。
- 国内网络直连 GitHub Releases 超时，全新机器安装 ffmpeg-static 需走镜像：`FFMPEG_BINARIES_URL=https://npmmirror.com/mirrors/ffmpeg-static npm install`。

## 7. 验收标准

- [x] 图片批量加水印，输出保持原格式，单行 / 多行布局正确。
- [x] PDF 多页水印，`applyToAllPages` 生效，中文正常。
- [x] 视频水印叠加正确、音频保留、进度可取消。
- [x] `npm run typecheck` 通过。
