# 模块设计：大文件管理（large-file-manager）

对应需求 2：查看、分类、搜索电脑上的大文件。

## 1. 需求

- 查看所有大文件（视频、图片、文档等）。
- 按文件类型、大小、创建时间分类。
- 按文件名、路径搜索。

## 2. 设计

### 2.1 扫描

`services/file.service.ts` 在主进程执行递归遍历（实现遵循 `large-file-manager` 技能）：

- 用 `fs.readdir(dir, { withFileTypes: true })` 拿 `Dirent`，减少额外 `stat`。
- 跳过系统目录：`node_modules`、`$Recycle.Bin`、`System Volume Information`、`.git`、隐藏目录。
- 符号链接跳过（防循环）。
- 单目录权限错误捕获 `EACCES` / `EPERM` 继续，计数 `skipped`。
- 大批量遍历分片让出事件循环，或放 worker_threads，避免阻塞主进程。

### 2.2 分类

- **类型**：扩展名 → 类别映射（video / image / document / audio / archive / other）。
- **大小**：分桶（`<1GB` / `1–5GB` / `>5GB`）。
- **时间**：`birthtime`（创建）与 `mtime`（修改）。

### 2.3 索引与搜索

扫描结果 upsert 进 SQLite `files` 表（见 `DATABASE.md` §2.1）；搜索走 `LIKE` + 分类 / 大小范围过滤 + 分页。

## 3. IPC 接口

见 `API_SPEC.md` §4：`file:scan`（长任务，事件 `file:scan:progress` / `file:scan:cancel`）、`file:search`（返回 `FileSearchResult`）、`file:getStats`、`file:getScanPresets`、`file:pickDirectory`。分类筛选由 `file:search` 的 `category` 覆盖，`getByCategory` 不实现。

## 4. 数据

- 表 `files`（索引：name / category / size / birthtime）。
- 重复路径用 `INSERT ... ON CONFLICT(path) DO UPDATE`。

## 5. UI

页面 `pages/FileManager/`：`FileManagerPage` + `ScanControl` / `FileTable` / `CategoryStats` / `FileSearchBar`。

## 6. 关键实现要点

- 扫描是长任务：进度用事件推送，结果用 Promise 返回；支持取消。
- 大结果集分页，表格用虚拟滚动或后端分页（`LIMIT/OFFSET`）。
- 阈值可配置（`settings.largeFileThresholdMB`，默认 100MB）。
- 渲染层只拿元数据，不做文件 IO / 删除（删除列为后续增强，需确认后实现）。
- 重扫清理失效索引：每扫完一个根目录，删除该根下本次未出现的已索引路径（仅完整扫描结束执行，取消则跳过）。
- 最小侧边导航：阶段 2 只保留「系统信息 / 大文件」两个入口。
- 快捷目录入口：`file:getScanPresets` 返回用户主目录与盘符，`ScanControl` 渲染「用户目录 / 盘符 / 浏览…」一键添加扫描目录。

## 7. 验收标准

- [x] 选择目录扫描，进度条推进，可中途取消。
- [x] 扫描出的大文件按类型 / 大小 / 时间可分类筛选。
- [x] 按文件名 / 路径能搜索到目标文件。
- [x] 重启应用后索引仍在（持久化生效）。
