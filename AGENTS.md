# AGENTS.md — my-pc 标准规约

所有 AI 代理（Claude Code、Codex 等）在本仓库工作的统一入口。写代码前先读本文件，按需加载对应技能与规则。

## 项目概览

- **项目**：my-pc — 基于 Electron 的桌面应用，管理电脑基本信息、进程、网络、大文件，并提供广告屏蔽、简历优化、图表生成等能力。
- **技术栈**：Electron · React · TypeScript · Node.js · SQLite
- **规划**：`docs/project-plan.md`

## 核心约定（精简）

1. TypeScript 严格模式，禁用 `any`（除非必要）。
2. 前端：函数组件 + Hooks，Props 定义接口，样式用 CSS Modules。
3. 后端：控制器 → 服务 → 数据访问 三层架构，接口参数校验（Zod），统一错误类。
4. Electron：`contextIsolation: true`、`nodeIntegration: false`，IPC 走 `contextBridge` + `invoke`，只传可序列化数据。
5. 数据库操作统一走 SQLite 数据访问层（Node 内置 `node:sqlite`）。

## 核心约束原则（防回归 · 防泄漏）

### 1. 修改边界原则（防回归）

- **职责**：严格区分「既定功能」与「新增需求」。对现有代码的任何修改，以「不破坏既有逻辑」为最高优先级。
- **红线**：禁止改动与当前任务无关的核心业务流程、公共组件或底层配置；确需修改存量代码时，先评估影响范围并在方案中说明理由。
- **最小变更**：只提交与当前需求相关的文件；一行改动可完成的不扩散为多处；不顺手重构无关代码。
- **交付标准**：每次功能逻辑变更后，原有单元测试与 E2E 用例必须全部通过；若行为是有意变更，同步更新对应测试，禁止为让测试通过而修改断言或跳过用例。

### 2. 安全扫描与脱敏原则（防泄漏）

- **扫描时机**：每次 `git add` 前与生成 commit message 前，对本次变更涉及的全部文本文件（`.env*`、`*.json`、`*.yaml`/`*.yml`、`*.js`/`*.ts`/`*.tsx`、`config/*` 等）执行敏感信息检查。
- **检测规则**：仅当「敏感键名 + 赋值 + 真实值（非占位符）」同时满足时命中：

| 类别 | 高信号模式 | 说明 |
|------|-----------|------|
| 账号密码 | `password\s*[:=]`、`passwd\s*[:=]` | 赋值位置的真实密码 |
| | `jdbc:[^"']*password=` | 连接串内嵌凭据（`jdbc:` 本身非凭据，仅当内嵌密码时命中） |
| 密钥凭证 | `api[_-]?key`、`access[_-]?key`、`private[_-]?key`、`secret`、`client[_-]?secret`、`auth[_-]?token`、`refresh[_-]?token` | 仅当键被赋真实值（如 `= "sk-…"`）时命中 |
| 云服务密钥 | `AKIA[0-9A-Z]{16}` | AWS Access Key ID（固定前缀 + 16 位） |
| | `sk-[A-Za-z0-9]{16,}` | OpenAI / 第三方密钥（需足够长度，避免误伤普通 `sk-` 前缀） |
| | `ghp_[A-Za-z0-9]{36,}`、`github_pat_[A-Za-z0-9_]{22,}` | GitHub Personal Access Token |
| | `xox[baprs]-` | Slack token |
| | `-----BEGIN (RSA \| EC \| OPENSSH )?PRIVATE KEY-----` | PEM 私钥 |

- **排除项（不报警）**：占位符 / 示例值（`example`、`your_`、`xxx`、`sample`、`<…>`）；注释与文档说明；仅定义键名、值引用环境变量（如 `const apiKey = process.env.API_KEY`）。
- **环境文件红线**：`.env`、`.env.local` 等真实环境文件必须列入 `.gitignore`，一律不提交；仅 `.env.example`（占位符）可入库。
- **应急处理**：一旦命中敏感信息，立即终止本次提交，将真实值替换为环境变量引用（`process.env.XXX` / `import.meta.env.XXX` / 注入配置），重新检查确认无泄漏后再提交。

## 目录与文档指针

- `.claude/rules.md` — Claude Code 行为规则
- `.ai-rules/global-rules.md` / `frontend-rules.md` / `backend-rules.md` — 详细开发规则
- `docs/` — 架构设计、API 规范、编码标准、组件库（规划中）
- `project-plan.md` — 项目需求与技术栈

## 项目技能清单（`.claude/skills/`）

| 技能 | 触发场景 |
|------|---------|
| `electron-architecture` | 涉及 Electron 结构、IPC、数据层的任何开发（基础技能，优先加载） |
| `system-monitor` | 系统信息：CPU / 内存 / 硬盘 / OS / 网络 / 进程 / 端口占用 |
| `large-file-manager` | 大文件扫描、分类、搜索 |
| `ad-blocker` | 软件广告 / 个性化推荐屏蔽（hosts） |
| `resume-optimizer` | STAR 原则简历优化 |
| `diagram-generator` | 思维导图 / 流程图 / 审批流程图（Mermaid） |

## 工作流

理解需求 → 分析现有结构 → 方案确认 → 编码 → 自检 → 更新文档。
复杂功能先输出设计方案，关键决策需用户确认。
