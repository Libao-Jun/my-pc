# 模块设计：广告屏蔽（ad-blocker）

对应需求 3：屏蔽电脑上软件的各种广告与个性化推荐。

> 状态：阶段 3 设计已定稿（2026-08-18）。核心裁定：**托管段写入 / 引导 + 可提权重启 / 内置种子清单**。

## 1. 需求

- 对浏览器、视频播放器、文档编辑器、搜狗 / 百度输入法等软件屏蔽广告。
- 屏蔽个性化推荐。

## 2. 设计

### 2.1 屏蔽机制

通过系统 **hosts 文件**把广告 / 推荐域名解析到 `0.0.0.0`（彻底不可达），请求无法到达真实服务器。

- Windows hosts 路径：`C:\Windows\System32\drivers\etc\hosts`
- 语法见 `.claude/skills/ad-blocker/references/hosts-format.md`。
- **目标 IP 用 `0.0.0.0`**（个别软件会跳过 `127.0.0.1`，`0.0.0.0` 更彻底）。
- **只写字面域名**：hosts 不支持通配符（`*.example.com` 无效），规则与种子清单全为字面子域，规避「屏蔽整站主域导致核心功能不可用」。

### 2.2 规则管理

规则按「软件分组 + 类别（ad / recommend）」组织，存 SQLite `adblock_rules` 表，用户可单独开关某软件或某条规则。

- `software`：所属软件分组（如「搜狗输入法」「浏览器」）。
- `category`：`ad`（广告）| `recommend`（个性化推荐）。
- `enabled`：布尔开关；组级开关 = 批量启停该软件下全部规则。

**种子规则**：内置一份按软件分组的常见广告域名清单（`src/main/services/adblock/seed-rules.ts`，静态数组），首次 `getRules` 且 `settings.adblock_seeded` 未置位时灌入，置位后不再重复（用户清空全部规则也不会复活）。

### 2.3 应用与回滚（托管段）

hosts 中以固定标记包围的**托管段**，应用 / 恢复**只读写自己的块，文件其余部分（含用户手动条目）永不触碰**：

```
# >>> my-pc 广告拦截 · 开始
0.0.0.0 ad.example.com
0.0.0.0 recommend.sogou.com
# >>> my-pc 广告拦截 · 结束
```

- **应用**（`apply`）：定位块（存在则整体替换，不存在则追加到文件尾），把全部**启用**规则去重后写入块内；写入前校验每个域名字面格式。
  - 单次写入行数上限（500 行）防失控。
- **备份**：应用前把「当前块的原始内容 + 规则数 + 时间戳」存入 `adblock_backups` 表；**保留最近 10 份，超限自动清理**。
- **恢复**（`restore({ backupId? })`）：给 id 恢复指定备份，缺省恢复最新；把块恢复为备份中的原始内容，备份原块为空则删除整个块。
- **幂等**：写块前对启用规则去重，避免重复行。
- **刷新**：应用成功后主进程自动执行 `ipconfig /flushdns`（无需管理员）；失败不阻塞，`ApplyResult.needsFlushDns = true` 由 UI 提示手动刷新。
- **状态**：`applied` = 探测 hosts 中是否存在「开始」标记（读文件即知，不依赖内存态）；`lastAppliedAt` = 最新备份的 `created_at`。

### 2.4 管理员权限

修改系统 hosts 需管理员权限。

- **启动探测**：主进程执行 `net session` probe（非管理员退出码非 0）→ 非管理员时页面顶部常驻横幅「当前非管理员，hosts 写入需提权」。
- **写入失败**（EACCES → `PERMISSION_DENIED`）：弹窗两按钮——
  - 「以管理员身份重启应用」：PowerShell `Start-Process -Verb RunAs` 提权重启 `process.execPath`（dev 模式自动附带应用路径参数），重启后用户重试。
  - 「稍后再说」：仅关闭弹窗。
- 边界：只做 hosts 域名层，不做注入 / 篡改二进制 / 内存修改。

### 2.5 域名校验

`isValidDomain(domain)`：合法字面域名正则（小写字母/数字/连字符的标签序列，禁通配符 `*`、禁空格 / 注释 / 路径字符），防止写入任意内容污染系统文件。非法 → `VALIDATION_ERROR`。

## 3. IPC 接口

见 `API_SPEC.md` §5：`adblock:getRules` / `addRule` / `updateRule` / `removeRule` / `apply` / `restore` / `getStatus` / `listBackups`。

- `ApplyResult { written: number; backupId: string; needsFlushDns: boolean }`
- `AdblockStatus { applied: boolean; ruleCount: number; enabledCount: number; lastAppliedAt: number | null }`
- `Backup { id: string; createdAt: number; ruleCount: number }`
- 错误码：`VALIDATION_ERROR`（域名非法）、`PERMISSION_DENIED`（无管理员权限写 hosts）、`NOT_FOUND`（`restore` 无可用备份 / 备份 id 不存在）、`INTERNAL`（hosts 读失败等兜底）。

## 4. 数据

- `adblock_rules`（软件、域名、类别、开关）——见 `DATABASE.md §2.2`。
- `adblock_backups`（块内容、规则数、时间戳）——见 `DATABASE.md §2.3`。
- `settings` 新增 `adblock_seeded` 标志（种子是否已灌入）。
- 迁移：DB 迁移 v3 建上述两表，只追加、不改动历史迁移。

## 5. UI

页面 `pages/AdBlocker/`：

| 组件 | 用途 |
|------|------|
| `AdBlockerPage` | 页面入口：状态条 + 规则组 + 操作 |
| `RuleGroupList` | 按软件分组展示规则（组级开关 + 每条独立开关） |
| `RuleEditor` | 新增 / 编辑规则（软件、域名、类别）——Modal 弹窗 |
| `ApplyBar` | 应用 / 恢复按钮 + 状态提示（含管理员横幅、DNS 提示） |

- 状态条：当前已应用 / 规则总数 / 启用数 / 上次应用时间。
- 备份列表：Modal 展示 `listBackups` + 一键恢复（`ConfirmDialog` 确认）。
- **补建缺失共享组件**：`Switch` / `ConfirmDialog` / `Modal` / `Toast`（广告页需要，当前未建）。

## 6. 关键实现要点

- **托管段常量**：开始 / 结束标记为固定字符串常量，识别时精确匹配（不模糊含前缀行）。
- **块读写**：读 hosts 全文 → 用标记切出块区域 → 组新内容 → **原子写回**：先把新内容写入同目录临时文件（如 `hosts.my-pc.tmp`），再 `rename` 覆盖原 hosts（Windows `rename` 会替换已存在目标），避免写入中途崩溃留下截断的 hosts 破坏整机解析；其余行逐行透传。
- **提权重启**：`app.isPackaged` 决定 `process.execPath` 是否需附带应用路径参数。
- **备份清理**：`DELETE FROM adblock_backups WHERE id NOT IN (SELECT id ... ORDER BY created_at DESC LIMIT 10)`。
- **渲染层零 Node 权限**：一切 hosts 读写 / 提权 / flushdns 都在主进程，渲染层只经 IPC。
- **精度**：域名清单精确到「广告子域」，避免屏蔽整站主域导致核心功能不可用。

## 7. 验收标准

- [ ] 可新增 / 编辑 / 删除规则，并按软件分组开关（组级 + 单条）。
- [ ] 应用后目标广告域名被解析到本机（真实机器 `ping <域名>` 返回 `0.0.0.0`）。
- [ ] 一键恢复后托管段回到应用前状态，**hosts 文件其余部分不变**（含用户手动条目）。
- [ ] 无管理员权限时给出明确提示与提权引导，而非静默失败。
- [ ] 重启应用后规则与备份仍在（SQLite 持久化生效）。
