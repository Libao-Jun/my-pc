# 模块设计：AI 集成层（ai-integration）

对应 README 阶段 4 · AI 集成层（目标：为后两个模块铺路）。

> 状态：阶段 4 已落地（2026-08-18，见 §7）。核心裁定：**单文件适配层 + 可配置后端（OpenAI 兼容 / Anthropic）+ 未配置抛 AI_NOT_CONFIGURED 由业务走本地兜底**。

## 1. 需求

- 为阶段 5 简历优化、阶段 6 图表生成提供统一的 AI 调用能力。
- 后端可配置：OpenAI 兼容接口（自定义 baseURL + key）与 Anthropic。
- 未配置后端时不静默失败：抛 `AI_NOT_CONFIGURED`，由上层 service 走本地模板兜底。

## 2. 设计

### 2.1 适配层（src/main/ai/adapter.ts，单文件）

统一接口：
- `complete(prompt, schema?)` → `Promise<string>`：**主进程内部接口**，阶段 5/6 的 resume/diagram service 调用。`schema` 只用于构造 system prompt 格式指令，返回纯文本由调用方自行 `JSON.parse`。
- `test()` → `Promise<{ latencyMs }>`：设置页「测试连接」用，对配置后端发最小探测。

按 `settings.aiBackend` 分派：
- **OpenAI 兼容**：`POST {baseUrl}/chat/completions`，`Authorization: Bearer`；schema 存在时加 `response_format: { type: 'json_object' }`。
- **Anthropic**：`POST {baseUrl}/v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`；schema 只拼 system prompt（无 response_format）。

### 2.2 配置存储

复用 SQLite `settings` 表（`aiBackend` / `aiBaseUrl` / `aiApiKey` / `aiModel`）。key 读取时脱敏（`***`），主进程用 `settingsRepository.getRaw()` 取真实值（不暴露给渲染层）。保存时 key 留空或回传脱敏值 → 不覆盖原值。

### 2.3 错误模型

| 码 | 触发 | 上层行为 |
|----|------|---------|
| `AI_NOT_CONFIGURED` | backend=none 或 key/baseUrl 未配 | 阶段 5/6 走本地兜底 |
| `AI_TIMEOUT` | complete 60s / test 15s | 提示重试 |
| `AI_API_ERROR` | 远端非 2xx（message 带 status） | 展示错误 |
| `AI_UNAVAILABLE` | 网络失败 / 响应格式异常 | 展示错误 |

## 3. IPC 接口

见 `API_SPEC.md`：`ai:test`（无参 → `{ latencyMs }`）。**`ai:complete` 不暴露给渲染层**——阶段 5/6 在主进程直接调用 `complete()`。

## 4. 数据

- `settings` 表四字段，见 `DATABASE.md`；无新增表、无迁移。

## 5. UI

页面 `pages/Settings/`：
- `SettingsPage`：页面容器。
- `AiSettings`：后端下拉 / baseUrl / apiKey / model + 「保存」+「测试连接」（成功显示 `连接成功 · Nms`，失败显示错误码文案）。「测试连接」先保存当前表单再对后端探测（成功显示 连接成功 · Nms）。

## 6. 关键实现要点

- 超时用 `AbortController` + `setTimeout`，到点 abort，捕获后转 `AI_TIMEOUT`。
- `baseUrl` 用户填完整基础地址：openai-compatible 含版本路径（如 `https://api.openai.com/v1`）；Anthropic 填根地址（`https://api.anthropic.com`）。adapter 拼资源路径（openai 追加 `/chat/completions`，anthropic 追加 `/v1/messages`）并去尾部斜杠。
- 模型字段留空时兜底默认值：openai-compatible → `gpt-4o-mini`、anthropic → `claude-3-5-haiku`（前端同组默认值做预填）。
- 渲染层展示错误：沿用 store 模式直接显示 `error.message`，不新建错误码映射表。

## 7. 验收标准

- [x] 设置页可配置 backend / baseUrl / key / model 并保存；apiKey 留空保存后原 key 不变。
- [x] 「测试连接」对配置好的 API 完成一次真实调用并显示延迟（openai 兼容与 anthropic 各验一次）。
- [x] backend=none 或 key/baseUrl 未配置时，测试连接给出「未配置 AI 服务」提示，不发起请求。
- [x] `npm run typecheck` 通过。
