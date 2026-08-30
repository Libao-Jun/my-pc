# 水印效果预览移入选择区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「水印效果预览」模块从配置表单下方移到右列选择按钮之下、文件列表之前，形成 选择→预览→处理 流程；预览数据源改为队列驱动（自动取首个文件 + 行内切换），队列为空时保留「上传原件」兜底。

**Architecture:** 纯渲染层改动。`watermarkStore` 增加 `previewPath` 状态；`WatermarkPreview` 改为双模式（队列目标推导 `queue.find(q=>q.path===previewPath) ?? queue[0] ?? null`，上传原件兜底）；`WatermarkQueue` 在 `.actions` 与 table 之间渲染预览并给每行加「预览」按钮 + 高亮；`WatermarkPage` 左列移除预览。后端/IPC/水印算法零改动。

**Tech Stack:** React · zustand · CSS Modules（沿用现有渲染层约定）。

## Global Constraints

- **只改 5 个渲染层文件**：`src/renderer/src/stores/watermarkStore.ts`、`src/renderer/src/pages/Watermark/WatermarkPage.tsx`、`src/renderer/src/pages/Watermark/WatermarkQueue.tsx`、`src/renderer/src/pages/Watermark/WatermarkPreview.tsx`、`src/renderer/src/pages/Watermark/WatermarkQueue.module.css`。
- **不改**：`src/shared/**`、`src/main/**`、`src/preload/**`、`src/renderer/src/utils/watermarkPreview.ts`（`renderOriginalPreview`/`inferPreviewType` 签名不动）、`src/renderer/src/utils/watermarkRenderer.ts`、处理管线（`run`/`processItem`）。
- 严格中文 UI 文案；提交消息以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。
- 验证命令：`node scripts/verify-watermark.ts`（期望 `ALL_WATERMARK_LAYOUT_TESTS_PASSED`，回归）与 `npm run typecheck`（node + web 零错误）。

---

### Task 1: 状态与布局迁移 —— store previewPath + 左列移除 + 预览挂载到选择按钮之下

**Files:**
- Modify: `src/renderer/src/stores/watermarkStore.ts`
- Modify: `src/renderer/src/pages/Watermark/WatermarkPage.tsx`
- Modify: `src/renderer/src/pages/Watermark/WatermarkQueue.tsx`

**Interfaces:**
- Consumes: 现 `WatermarkState`（config/queue/processing/videoProgress/error + 动作）。
- Produces: 新增 `previewPath: string | null` + `setPreviewPath(path: string | null)`；`WatermarkQueue` 在选择按钮之下渲染 `<WatermarkPreview />`。Task 2 依赖此状态与挂载位置。

- [ ] **Step 1: `watermarkStore.ts` 增加 `previewPath`**

在 `WatermarkState` 接口 `error: string | null` 之后追加两行：

```ts
  previewPath: string | null
  setPreviewPath: (path: string | null) => void
```

在 store 初值 `error: null,` 之后追加：

```ts
  previewPath: null,
```

在 `setConfig` 之后追加：

```ts
  setPreviewPath: (path) => set({ previewPath: path }),
```

将 `clearQueue` 改为同时重置预览目标：

```ts
  clearQueue: () => set({ queue: [], previewPath: null }),
```

（`addFiles`/`removeItem` 不改 `previewPath` —— 由预览组件推导兜底。）

- [ ] **Step 2: `WatermarkPage.tsx` 左列移除预览**

删除 `WatermarkPreview` 的 import 行与 `<WatermarkPreview />` 挂载，左列仅剩配置表单：

```tsx
import { WatermarkConfigForm } from './WatermarkConfigForm'
import { WatermarkQueue } from './WatermarkQueue'
import styles from './WatermarkPage.module.css'

export function WatermarkPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>水印保护</h1>
      <div className={styles.grid}>
        <div className={styles.left}>
          <WatermarkConfigForm />
        </div>
        <div className={styles.right}>
          <WatermarkQueue />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `WatermarkQueue.tsx` 在 `actions` 之后渲染预览**

在文件顶部 import `WatermarkPreview`：

```tsx
import { WatermarkPreview } from './WatermarkPreview'
```

在 `.actions` 关闭 `</div>` 之后、`{error && ...}` 之前插入：

```tsx
      <WatermarkPreview />
```

（新顺序：`.actions` → `<WatermarkPreview/>` → `error` → `table` → `.footer`。此时组件仍为上传模式，功能不变，仅位置迁移。）

- [ ] **Step 4: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
node scripts/verify-watermark.ts
npm run typecheck
```
Expected: `ALL_WATERMARK_LAYOUT_TESTS_PASSED`；typecheck 零错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/stores/watermarkStore.ts src/renderer/src/pages/Watermark/WatermarkPage.tsx src/renderer/src/pages/Watermark/WatermarkQueue.tsx
git commit -m "feat(watermark): 预览移入选择区 —— store 增 previewPath / 左列移除预览 / 队列在选择按钮下挂载预览
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 预览双模式 + 队列行预览切换 + 样式

**Files:**
- Modify: `src/renderer/src/pages/Watermark/WatermarkPreview.tsx`
- Modify: `src/renderer/src/pages/Watermark/WatermarkQueue.tsx`
- Modify: `src/renderer/src/pages/Watermark/WatermarkQueue.module.css`

**Interfaces:**
- Consumes: Task 1 的 `previewPath`/`setPreviewPath` 与 `WatermarkPreview` 挂载位置；现 `renderOriginalPreview(canvas, path, type, config, api, isCancelled?)`。
- Produces: 预览组件队列驱动（自动取首个文件）+ 空队列上传兜底；文件行「预览」按钮切换目标 + 高亮「预览中」。

- [ ] **Step 1: 重写 `WatermarkPreview.tsx` 为双模式**

完整替换文件内容：

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { inferPreviewType, renderOriginalPreview } from '@renderer/utils/watermarkPreview'
import type { PreviewApi } from '@renderer/utils/watermarkPreview'
import type { WatermarkFileType } from '@shared/types'
import styles from './WatermarkPreview.module.css'

interface Original {
  path: string
  name: string
  type: WatermarkFileType
}

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const queue = useWatermarkStore((s) => s.queue)
  const previewPath = useWatermarkStore((s) => s.previewPath)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [original, setOriginal] = useState<Original | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const api: PreviewApi = useMemo(
    () => ({
      readBinary: async (path) => window.api.watermark.readBinary(path),
      getVideoInfo: async (path) => window.api.watermark.getVideoInfo(path),
      extractVideoFrame: async (p) => window.api.watermark.extractVideoFrame(p)
    }),
    []
  )

  // 有效预览目标：队列显式选中 → 队列首个 → 上传原件（兜底）→ null
  const queueTarget = useMemo(
    () => queue.find((q) => q.path === previewPath) ?? queue[0] ?? null,
    [queue, previewPath]
  )
  const target = queueTarget ?? original
  const isQueueMode = queueTarget !== null

  const upload = async (): Promise<void> => {
    const r = await window.api.watermark.pickOriginal()
    if (!r.ok) {
      setError(r.error.message)
      setNote('')
      return
    }
    const path = r.data
    if (!path) return
    const type = inferPreviewType(path)
    if (!type) {
      setError('不支持的文件类型')
      setNote('')
      return
    }
    setOriginal({ path, name: path.split(/[\\/]/).pop() ?? path, type })
    setNote('')
    setError(null)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !target) return
    let cancelled = false
    setError(null)
    renderOriginalPreview(canvas, target.path, target.type, config, api, () => cancelled)
      .then((n) => {
        if (!cancelled) setNote(n)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '预览失败')
      })
    return () => {
      cancelled = true
    }
  }, [target?.path, target?.type, config, api])

  const displayName = queueTarget ? queueTarget.name : original?.name ?? ''

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      {!target ? (
        <div className={styles.empty}>
          <p>请上传原件以预览水印效果</p>
          <button type="button" onClick={() => void upload()}>
            上传原件（图片 / PDF / 视频）
          </button>
        </div>
      ) : (
        <>
          <div className={styles.meta}>
            <span className={styles.name} title={target.path}>
              {displayName}
            </span>
            {!isQueueMode && (
              <>
                <button type="button" onClick={() => void upload()}>
                  更换原件
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOriginal(null)
                    setNote('')
                    setError(null)
                  }}
                >
                  清除
                </button>
              </>
            )}
          </div>
          <canvas ref={canvasRef} className={styles.canvas} />
          {note && <p className={styles.note}>{note}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  )
}
```

（队列模式：`renderOriginalPreview` 用 `target.path`/`target.type`；队列项 type 来自 store，无需 `inferPreviewType`。上传兜底逻辑与修复轮一致。）

- [ ] **Step 2: `WatermarkQueue.tsx` 行内「预览」按钮 + 高亮**

从 store 读取 `previewPath`/`setPreviewPath`（在现有 `useWatermarkStore` 调用区追加两行）：

```tsx
  const previewPath = useWatermarkStore((s) => s.previewPath)
  const setPreviewPath = useWatermarkStore((s) => s.setPreviewPath)
```

在 `done`/`failed` 计算之后追加有效目标推导：

```tsx
  const activePath = queue.find((q) => q.path === previewPath)?.path ?? queue[0]?.path ?? null
```

将 `<tbody>` 中的行渲染改为（`<tr>` 加高亮 class，末单元格加「预览」按钮/「预览中」标签）：

```tsx
        <tbody>
          {queue.map((item) => (
            <tr key={item.path} className={activePath === item.path ? styles.active : undefined}>
              <td className={styles.name}>{item.name}</td>
              <td>{TYPE_LABEL[item.type]}</td>
              <td>{STATUS_LABEL[item.status]}</td>
              <td className={styles.out}>
                {item.outputPath ?? item.error ?? ''}
              </td>
              <td>
                {activePath === item.path ? (
                  <span className={styles.previewing}>预览中</span>
                ) : (
                  <button
                    type="button"
                    className={styles.previewBtn}
                    disabled={processing}
                    onClick={() => setPreviewPath(item.path)}
                  >
                    预览
                  </button>
                )}
                <button
                  type="button"
                  className={styles.remove}
                  disabled={processing}
                  onClick={() => removeItem(item.path)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {queue.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                尚未选择文件（图片 / PDF 可批量，视频单文件）
              </td>
            </tr>
          )}
        </tbody>
```

- [ ] **Step 3: `WatermarkQueue.module.css` 追加样式**

在 `.actions` 规则之后追加预览区容器；在 `.remove` 规则附近追加行高亮、预览按钮、「预览中」标签：

```css
.previewArea {
  margin-bottom: 10px;
}
.active {
  background: #eef4ff;
}
.previewing {
  font-size: 12px;
  color: #2563eb;
  margin-right: 8px;
}
.previewBtn {
  margin-right: 8px;
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.previewBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

> 说明：`.previewArea` 在本任务预留（Task 1 已挂载预览但未套容器 class —— 如需收紧可一并包裹，见 Step 4 备注）。若 Step 1 挂载处已直接使用裸 `<WatermarkPreview/>`，可将第 3 步 `.previewArea` 的 margin 应用到预览组件自身（`WatermarkPreview.module.css` 的 `.preview`）或在此处给挂载点包一层 `<div className={styles.previewArea}>`。

- [ ] **Step 4: 挂载点包 `.previewArea` 容器**

`WatermarkQueue.tsx` 中把 `<WatermarkPreview />`（Task 1 Step 3 挂载的裸组件）改为外包一层容器以应用间距：

```tsx
      <div className={styles.previewArea}>
        <WatermarkPreview />
      </div>
```

（此步必做，与 Step 3 的 `.previewArea` 样式同提交生效；Task 1 中的裸挂载此时改为本写法。）

- [ ] **Step 5: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
node scripts/verify-watermark.ts
npm run typecheck
```
Expected: `ALL_WATERMARK_LAYOUT_TESTS_PASSED`；typecheck（node + web）零错误。

- [ ] **Step 6: 手动 E2E（本步需人审）**

在 `npm run dev` 中验证：
1. 添加图片/PDF/视频 → 预览区自动显示队列首个文件 + 实时水印；
2. 点击某行「预览」→ 切换预览目标，该行高亮「预览中」；
3. 移除被预览行 → 自动回退预览队列其余首个；清空队列 → 显示「上传原件」兜底，上传后预览；
4. 配置变更（文本/字号/透明度/布局/对齐/应用范围）实时刷新预览；
5. 多页 PDF 预览首页标注「预览为首页」；视频标注「预览为前几秒帧」；
6. 处理流程（开始处理/取消视频/清空）不受预览影响。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/pages/Watermark/WatermarkPreview.tsx src/renderer/src/pages/Watermark/WatermarkQueue.tsx src/renderer/src/pages/Watermark/WatermarkQueue.module.css
git commit -m "feat(watermark): 预览双模式（队列驱动+上传兜底）& 队列行「预览」切换与高亮
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** —— 逐条对照 spec：
- §4.1 previewPath/setPreviewPath/clearQueue 重置 → Task 1 Step 1 ✓
- §4.2 布局（左列移除 + queue 插入预览）→ Task 1 Step 2/3 ✓
- §4.3 双模式与目标推导 → Task 2 Step 1 ✓（`queue.find(q=>q.path===previewPath) ?? queue[0] ?? null` 逐字一致；队列模式隐藏上传按钮、空态「上传原件」）
- §4.4 行内「预览」按钮 + 高亮 → Task 2 Step 2 ✓
- §4.5 样式 → Task 2 Step 3/4 ✓
- §4.6 不变量 → Global Constraints（仅 5 文件、不改后端/算法）✓
- §5 验证口径 → Task 1 Step 4 / Task 2 Step 5-6 ✓

**2. Placeholder scan** —— 无 TBD/TODO；每步含完整代码/命令。

**3. Type consistency** —— `previewPath: string | null` / `setPreviewPath(path: string | null)` 在 Task 1 定义、Task 2 消费，类型逐字一致；`queue.find(...) ?? queue[0] ?? null` 在预览组件与队列行推导一致；`target` 为 `{ path, type }`，`renderOriginalPreview` 签名未变。

**4. Task 边界（每次提交后 tree 绿色）**：
- Task 1：store + page + queue（挂载预览但组件仍上传模式）→ 行为等价迁移，verify + typecheck 过。
- Task 2：双模式 + 行切换 + 样式 → verify + typecheck 过。
