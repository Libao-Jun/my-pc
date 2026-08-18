# 数据库设计

my-pc 使用 Node 内置的 **`node:sqlite`**（`DatabaseSync`，同步 API，零原生编译）作为本地存储。数据库文件默认放应用 `userData` 目录（如 `%APPDATA%/my-pc/data.db`）。

## 1. 设计原则

- 所有读写只发生在**主进程**，经 `db/repositories/` 暴露；渲染层不直接触库。
- 建表走**版本化迁移**（`db/migrations.ts`），用 `PRAGMA user_version` 记录版本。
- 打开连接时启用 WAL（`PRAGMA journal_mode = WAL`），提升并发读写体验。
- 金额 / 字节等一律存整数，避免浮点误差；时间戳存 Unix 毫秒（`INTEGER`）。
- `node:sqlite` 无 `.pragma()` / `.transaction()` 辅助方法：`PRAGMA` 用 `prepare(...).get()` 读、`exec()` 写；事务用 `BEGIN/COMMIT/ROLLBACK` 手动控制。

## 2. 表结构

### 2.1 `files` — 大文件索引

```sql
CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,      -- 绝对路径，唯一
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,      -- 字节
  ext        TEXT NOT NULL,         -- 小写扩展名，不含点
  category   TEXT NOT NULL,         -- video / image / document / audio / archive / other
  birthtime  INTEGER NOT NULL,      -- 创建时间（毫秒）
  mtime      INTEGER NOT NULL       -- 修改时间（毫秒）
);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
CREATE INDEX IF NOT EXISTS idx_files_birthtime ON files(birthtime);
```

> `path` 做主键意味着同路径重复扫描时做 upsert（`INSERT ... ON CONFLICT(path) DO UPDATE`）。

### 2.2 `adblock_rules` — 广告屏蔽规则

```sql
CREATE TABLE IF NOT EXISTS adblock_rules (
  id        TEXT PRIMARY KEY,       -- 随机 UUID
  software  TEXT NOT NULL,          -- 所属软件分组
  domain    TEXT NOT NULL,          -- 屏蔽域名（小写）
  category  TEXT NOT NULL,          -- ad / recommend
  enabled   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_adblock_software ON adblock_rules(software);
```

### 2.3 `adblock_backups` — hosts 备份记录

```sql
CREATE TABLE IF NOT EXISTS adblock_backups (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  rule_count INTEGER NOT NULL,
  content    TEXT NOT NULL          -- 备份时的 hosts 内容
);
```

### 2.4 `resumes` — 简历

```sql
CREATE TABLE IF NOT EXISTS resumes (
  id         TEXT PRIMARY KEY,      -- 单条，固定 'default'
  data       TEXT NOT NULL,         -- Resume 的 JSON 序列化
  updated_at INTEGER NOT NULL
);
```

> 简历结构频繁演进，用 JSON 列存整份 `Resume`，避免频繁迁移；查询场景简单（只读 / 整体改写）。

### 2.5 `settings` — 应用设置

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL               -- JSON 序列化
);
```

> AI API key 存 `settings`，读取时脱敏（只返回「是否已配置」），不写日志。

### 2.6 `diagrams` — 图表历史（可选）

```sql
CREATE TABLE IF NOT EXISTS diagrams (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,         -- 原始资料
  type       TEXT NOT NULL,         -- mindmap / flowchart / approval
  mermaid    TEXT NOT NULL,         -- 生成的 Mermaid 源码
  created_at INTEGER NOT NULL
);
```

## 3. 迁移策略

- `db/migrations.ts` 维护一个 `migrations: { version: number; up(db) }[]` 数组。
- 启动时读取 `PRAGMA user_version`，按序执行未应用的迁移，每个迁移包在事务里并更新 `user_version`。
- 只追加迁移，不修改历史迁移（保证已发布版本可平滑升级）。

示例骨架（`node:sqlite` 风格，事务手动控制）：

```ts
import type { DatabaseSync } from 'node:sqlite'

function runMigrations(db: DatabaseSync): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (const m of migrations) {
    if (m.version > user_version) {
      db.exec('BEGIN')
      try {
        m.up(db)
        db.exec(`PRAGMA user_version = ${m.version}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  }
}
```

## 4. Repository 划分

| repository | 关联表 | 主要方法 |
|-----------|--------|---------|
| `file.repository.ts` | `files` | `upsertMany`, `search`, `stats`, `listByCategory` |
| `adblock.repository.ts` | `adblock_rules`, `adblock_backups` | `list`, `add`, `update`, `remove`, `saveBackup`, `listBackups`, `pruneBackups`, `isSeeded`, `markSeeded` |
| `resume.repository.ts` | `resumes` | `load`, `save` |
| `settings.repository.ts` | `settings` | `get`, `set` |
| `diagram.repository.ts` | `diagrams` | `save`, `listRecent` |

## 5. 查询要点

- **大文件搜索**：`WHERE name LIKE '%kw%' COLLATE NOCASE`，配合 `category` / `size` 范围，`LIMIT/OFFSET` 分页。
- **分类统计**：`SELECT category, COUNT(*), SUM(size) FROM files GROUP BY category`。
- **主机名 / 路径大小写**：文件名搜索不区分大小写（`COLLATE NOCASE`）；路径精确匹配区分大小写。
