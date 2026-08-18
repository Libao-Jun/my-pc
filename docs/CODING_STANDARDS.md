# 编码标准

整合 `.ai-rules/` 与 `.claude/rules.md` 的规范，作为本仓库唯一的编码标准入口。更细的运行时规则见各规则文件。

## 1. TypeScript

- 开启严格模式（`"strict": true`），禁止 `any`（除非有注释说明的极少数边界）。
- 优先 `interface` 定义对象结构；跨进程类型统一放 `src/shared/types.ts`。
- 枚举用 `const enum` 或字符串字面量联合；避免魔法字符串。
- 空值用 `null` 表达「无」，`undefined` 表达「未提供」；可选属性显式 `?`。

## 2. 前端（React）

- 函数组件 + Hooks；Props 必须定义 `interface` 并命名导出。
- 组件命名 `PascalCase.tsx`，样式 `ComponentName.module.css`，工具函数 `camelCase.ts`。
- 样式用 CSS Modules，不写内联样式（动态值除外）。
- 列表渲染必须加稳定 `key`；避免在渲染函数里创建新对象 / 函数。
- 合理使用 `React.memo` / `useMemo` / `useCallback`；先测后优化，不提前优化。

## 3. 后端（Node.js / 主进程）

- 严格遵循 控制器（`ipc/`）→ 服务（`services/`）→ 数据访问（`db/`）三层，禁止越级。
- IPC 通道统一在 `ipc/` 白名单注册；参数在控制器层校验（Zod）。
- 错误处理统一用 `AppError`，跨 IPC 只透传 `{ code, message }`。
- 数据库操作必须通过 repository，不在 service 里直接拼 SQL。

## 4. Electron 专项

- `webPreferences` 固定 `contextIsolation: true`、`nodeIntegration: false`。
- IPC 走 `contextBridge` + `ipcRenderer.invoke`，通道名 `domain:action`。
- 只传可序列化数据，不传函数 / Buffer / 类实例。
- 系统命令（如 `netstat`）只拼固定参数，校验用户输入，防注入。

## 5. 命名约定

| 对象 | 约定 | 示例 |
|------|------|------|
| 文件（组件） | PascalCase | `ProcessPanel.tsx` |
| 文件（工具 / 服务 / 仓库） | camelCase | `system.service.ts` |
| IPC 通道 | `domain:action` | `system:getCpu` |
| 数据库表 | snake_case 复数 | `adblock_rules` |
| 数据库列 | snake_case | `created_at` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_THRESHOLD_MB` |
| 分支 | 语义化前缀 | `feat/`, `fix/`, `chore/` |

## 6. 目录与文件职责

- 一个文件一个主要职责；单文件超 ~300 行时考虑拆分。
- 功能域代码按 `main/services/`、`main/ipc/`、`pages/<Module>/`、`stores/` 对齐，不跨域混放。
- `shared/` 只放三进程共用的纯类型与常量，不放可执行逻辑。

## 7. Git 工作流

- 主分支 `main`；开发用语义化分支 `feat/<模块>-<简述>`、`fix/<简述>`。
- Commit message 用 Conventional Commits：`feat(system): 实现端口反查`、`fix(adblock): 修复回滚丢失规则`。
- 每个 commit 保持单一职责，不做大杂烩提交。
- 提交前跑 `npm run typecheck` + `npm run lint`；引入新依赖需说明理由。

## 8. 质量门槛（每个功能模块「完成」的定义）

- [ ] 类型检查通过（无 `any`、无未处理空值）。
- [ ] 参数校验覆盖（Zod）与错误分支完整。
- [ ] 关键逻辑有注释，说明「为什么」。
- [ ] 与 `docs/` 中接口契约一致，无散落魔法字符串。
- [ ] 可运行验证（见 `README.md` 各阶段验收标准）。

## 9. 引用

- 全局规则：`.ai-rules/global-rules.md`
- 前端规则：`.ai-rules/frontend-rules.md`
- 后端规则：`.ai-rules/backend-rules.md`
- Claude Code 行为规则：`.claude/rules.md`
- 技能：`.claude/skills/`（`electron-architecture` 优先加载）
