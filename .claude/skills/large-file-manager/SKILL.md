---
name: large-file-manager
description: 实现大文件扫描、分类与搜索（视频、图片、文档等）。当用户要「扫描电脑上的大文件、按类型/大小/时间分类文件、按文件名/路径搜索大文件、清理占用空间的大文件」时使用，即便没有明说「大文件管理」。
---

# 大文件管理

为 my-pc 的「大文件管理」功能域提供扫描、分类、搜索的实现约定。核心思路是**递归遍历文件系统 → 过滤出大文件 → 建索引（SQLite）供分类与搜索**。

## 扫描

在 Electron **主进程**执行遍历，避免阻塞渲染。优先用 `fs.readdir` 的 `withFileTypes` 拿 `Dirent`（省去每个条目的额外 `stat` 调用）：

```ts
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function walk(dir: string, onFile: (full: string, size: number) => void) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, onFile);
    else if (e.isFile()) {
      const st = await stat(full);
      onFile(full, st.size);
    }
  }
}
```

## 要点

- **跳过目录**：`node_modules`、`$Recycle.Bin`、`System Volume Information`、`.git`、隐藏目录（`.` 开头）。跳过前先检查符号链接（`isSymbolicLink()`），避免循环遍历。
- **防阻塞**：大批量遍历用 `setImmediate` / 分片让出事件循环，或丢到 worker_threads 后台线程。
- **权限错误**：单个目录无权限时捕获 `EACCES` / `EPERM` 继续，不要让一次失败中断整个扫描。
- **大文件阈值**：默认按「大小 ≥ 100MB」或用户设置筛选，阈值做成可配置项。

## 分类

- **按类型**：由扩展名映射到类别（视频 / 图片 / 文档 / 音频 / 压缩包 / 其他），维护一张「扩展名 → 类别」映射表。
- **按大小**：分桶（如 100MB–1GB / 1GB–5GB / >5GB）。
- **按时间**：用 `stat.birthtime`（创建时间）或 `mtime`（修改时间）分档。

## 搜索与索引

- 扫描结果写入 **SQLite**（`better-sqlite3`），建表 `files(path TEXT PRIMARY KEY, name, size, ext, category, birthtime, mtime)`，为 `name`、`category`、`size` 建索引。
- 搜索用 SQL `LIKE` 匹配文件名 / 路径（大小写不敏感），大结果集分页返回。

## IPC 暴露

扫描是长任务：用 `ipcMain.handle` 返回 Promise，或用「进度事件 + `webContents.send`」推进度。渲染层只拿序列化后的文件元数据，不直接拿绝对路径做 IO。
