# 模块设计：广告屏蔽（ad-blocker）

对应需求 3：屏蔽电脑上软件的各种广告与个性化推荐。

## 1. 需求

- 对浏览器、视频播放器、文档编辑器、搜狗 / 百度输入法等软件屏蔽广告。
- 屏蔽个性化推荐。

## 2. 设计

### 2.1 屏蔽机制

通过系统 **hosts 文件**把广告 / 推荐域名解析到 `0.0.0.0`（彻底不可达），请求无法到达真实服务器。

- Windows hosts 路径：`C:\Windows\System32\drivers\etc\hosts`
- 语法与域名示例见 `skills/ad-blocker/references/hosts-format.md`。

### 2.2 规则管理

规则按「软件分组 + 类别（ad / recommend）」组织，存 SQLite `adblock_rules` 表，用户可单独开关某软件或某条规则。

### 2.3 应用与回滚

- **应用**：把启用规则拼成 `0.0.0.0 <domain>` 行写入 hosts；写入前备份到 `adblock_backups` 表（含时间戳）。
- **回滚**：从备份恢复原 hosts 内容。
- **幂等**：写入前检查域名是否已存在，避免重复行。
- **刷新**：应用后提示 `ipconfig /flushdns`。

## 3. IPC 接口

见 `API_SPEC.md` §5：`adblock:getRules` / `addRule` / `updateRule` / `removeRule` / `apply` / `restore` / `getStatus` / `listBackups`。

## 4. 数据

- `adblock_rules`（软件、域名、类别、开关）。
- `adblock_backups`（hosts 内容备份 + 时间戳）。

## 5. UI

页面 `pages/AdBlocker/`：`AdBlockerPage` + `RuleGroupList` / `RuleEditor` / `ApplyBar`。

## 6. 关键实现要点

- **管理员权限**：改 hosts 需管理员权限，写入失败（`EACCES`）返回 `PERMISSION_DENIED`，引导用户以管理员身份运行；必要时提供提权重启。
- **边界**：只做 hosts 域名层，不做注入 / 篡改二进制 / 内存修改。
- **安全**：域名格式校验（合法域名正则），防写入任意内容污染系统文件。
- **精度**：域名清单精确到「广告子域」，避免屏蔽整站主域导致核心功能不可用。

## 7. 验收标准

- [ ] 可新增 / 编辑 / 删除规则，并按软件分组开关。
- [ ] 应用后目标广告域名被解析到本机（`ping <域名>` 返回 `0.0.0.0`）。
- [ ] 可一键回滚到应用前状态。
- [ ] 无管理员权限时给出明确提示而非静默失败。
