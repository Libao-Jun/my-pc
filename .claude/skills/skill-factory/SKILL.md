---
name: skill-factory
description: 抽离可复用的代码模式、业务逻辑或工具函数为独立 Skill，并维护、优化本项目的 Skill 库。当发现同一逻辑重复 3 次及以上、某个函数被跨文件复用、某类问题（API 调用、错误处理等）反复出现，或用户提出"抽离成 Skill""做成 Skill""固化这个逻辑""封装一下""别重复造轮子"等需求时使用。
---

# Skill Factory — 技能工厂

## 概述

将开发中反复出现的重复逻辑、代码模式、业务规则等抽离为可复用的 Skill，让 Claude Code 具备"自我进化"能力——遇到过的模式下次自动识别和应用。支持用户主动管理和维护 Skill 库。

> 本技能负责「识别 → 抽离 → 创建 → 验证 → 维护」的完整流程。如需评估级验证（eval、A/B 对比、description 触发优化），可参考官方 `skill-creator`（`.agents/skills/skill-creator`）。

## 核心原则

本 Skill 由三条原则驱动，所有行为皆归于这三者：

| 原则       | 含义                                   | 落地机制                                                                                                      |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **标准化** | 所有 Skill 符合统一标准格式            | 标准 frontmatter（`name` + `description`）+ 标准骨架（适用场景/工作流程/速查表/常见错误）+ 规范命名与代码围栏 |
| **流程化** | 识别→抽取→创建→验证→维护按固定流程执行 | 「工作流程」步骤 + 「维护机制」规则，不跳步不省略                                                             |
| **自动化** | 满足触发条件即自动执行，不等待逐条指挥 | 「适用场景」触发 → 自动识别/提取/更新，执行后主动报告                                                         |

三原则形成闭环：**标准化**保证产物质量，**流程化**保证过程可复现，**自动化**保证持续进化。

## 适用场景

当以下情况发生时，**必须**启动本 Skill。

### 自动触发

1. 同一逻辑在项目中出现了 **3 次及以上**（三次原则）
2. 某个工具函数或业务逻辑跨多个文件被引用
3. 某类问题（如 API 调用模式、错误处理方式）反复出现
4. 用户明确要求："抽离成 Skill"、"做成 Skill"、"固化这个逻辑"

### 手动触发

5. 用户输入任何以 `/skill` 开头的命令

### 识别信号 (Detection Signals)

**代码模式识别：**

- **工具函数**：多个文件中出现相同的 `formatDate`、`validateEmail`、`debounce` 等
- **业务逻辑**：相同的价格计算、权限校验、状态机转换
- **配置模式**：重复的 axios 配置、数据库连接、日志格式
- **UI 模式**：相同的弹窗逻辑、表格渲染、表单校验
- **架构模式**：相同的 Repository 模式、Service 层写法

**关键词触发：**

用户说出："这逻辑好多地方用"、"又写了一遍"、"能不能复用"、"封装一下"、"DRY"、"别重复造轮子"。

## 工作流程

### 1. 分析复用内容

目标：理解要抽离的逻辑是什么。

- 阅读相关代码，理解输入输出
- 识别依赖（第三方库、项目配置）
- 确认边界（哪些是通用部分，哪些是特定业务）
- 确认抽离后的复用价值

### 2. 设计 Skill 结构

每个 Skill 必须包含以下标准结构：

```markdown
---
name: [kebab-case-命名]
description: [清晰描述这个 Skill 解决什么问题，包含关键词方便检索]
---

# [Skill 显示名称]

## 适用场景

- [场景1：什么情况下使用]
- [场景2：什么情况下使用]

## 使用方式

[如何调用这个 Skill，如：直接提问、触发关键词、手动调用]

## 核心实现

[包含具体的代码模板、配置模板、架构设计]

## 示例

[提供 1-2 个完整的使用示例]

## 注意事项

[边界情况、已知限制、依赖版本要求]
```

### 3. 创建 Skill 文件

- 路径：`.claude/skills/[skill-name].md`
- 命名规范：
  - 工具类：`[verb]-[noun]-helper`（如 `fetch-api-helper`）
  - 业务类：`[domain]-[action]-handler`（如 `payment-process-handler`）
  - 配置类：`[framework]-[purpose]-config`（如 `axios-retry-config`）
  - UI 类：`[component]-[pattern]-template`（如 `modal-confirm-template`）
  - 架构类：`[architecture]-[pattern]-pattern`（如 `repository-pattern`）

### 4. 验证和测试

- 在新的对话中，故意询问类似问题，验证 Skill 是否被正确触发
- 如果未被触发，检查 description 中的关键词是否准确
- 必要时调整 Skill 的 description 字段

### 5. 通知用户

创建完成后输出：

> ✅ **Skill 已创建**：我已将 `[具体逻辑描述]` 抽离为 `[skill-name]` Skill。
> 📁 位置：`.claude/skills/[skill-name].md`
> 📝 下次遇到类似场景时，我会自动调用此 Skill。
> 💡 你可以使用 `/skills show [skill-name]` 查看详情或手动编辑。

### 6. 组合 Skill

如果发现多个 Skill 经常一起使用，可以创建一个组合 Skill：

```markdown
---
name: full-stack-crud-generator
description: 整合 api-handler、validation-rules、table-renderer 三个 Skill 生成完整 CRUD
---

# 全栈 CRUD 生成器

## 组合说明

本 Skill 顺序调用以下 Skills：

1. `api-handler` - 生成 API 请求层
2. `validation-rules` - 生成数据校验规则
3. `table-renderer` - 生成数据展示层

## 调用方式

直接描述需求："生成一个用户管理的 CRUD 页面"
系统将自动组合三个 Skill 生成完整代码。
```

## 用户命令系统 (Skill Commander)

> 💡 说明：`/skills` 命令族描述的是预期的**对话式行为**。如需注册为真正可输入的命令，请在 `.claude/commands/` 下创建同名命令文件；否则 Claude 会以文字交互方式响应用户的 `/skills xxx` 输入。

### 命令列表

| 命令                       | 说明                                                     |
| -------------------------- | -------------------------------------------------------- |
| `/skills list`             | 列出所有可用的 Skills                                    |
| `/skills show [name]`      | 显示某个 Skill 的完整内容                                |
| `/skills search [keyword]` | 搜索包含关键词的 Skills                                  |
| `/skills create`           | 交互式创建新 Skill（询问名称/描述/适用场景/核心实现）    |
| `/skills edit [name]`      | 打开编辑器修改 Skill 内容                                |
| `/skills archive [name]`   | 移到 `.claude/skills/archived/` 目录（保留但不主动加载） |
| `/skills delete [name]`    | 永久删除 Skill（需二次确认）                             |
| `/skills stats`            | 显示 Skill 使用统计                                      |

**快捷指令：**

- `/skill-this`：将当前对话中的某个解决方案抽离成 Skill
- `/skill-from [file]`：从指定文件中提取逻辑生成 Skill
- `/skill-update [name]`：根据当前代码更新已有 Skill

**示例输出：**

```text
📚 已安装的 Skills：
1. date-format-helper - 日期格式化和时区转换 (使用: 12次)
2. api-error-handler - 统一 API 错误处理和重试 (使用: 8次)
3. table-renderer - 可配置的数据表格渲染 (使用: 5次)
4. payment-process-handler - 支付流程处理 (使用: 3次)
...
总计: 12 个 Skills
```

```text
🔍 搜索 "api" 的结果：
1. api-error-handler - 统一 API 错误处理
2. fetch-api-helper - API 请求封装
3. api-mock-generator - API Mock 数据生成
```

```text
📊 Skill 使用统计
总 Skills: 12
活跃 Skills: 9
归档 Skills: 3
最常用: date-format-helper (12次)
最不常用: xml-parser-helper (0次，建议归档)
```

## 自动优化系统 (Skill Optimizer)

当用户说"优化 Skills"、"清理 Skills"、"更新 Skills"时，按以下机制审查 Skill 库。

### 1. 冲突检测

检查是否有两个 Skill 描述同一功能：

```text
⚠️ 检测到冲突：
- `date-format-helper` 和 `time-converter` 功能重叠
建议：合并为一个 Skill 或明确区分适用场景
```

### 2. 过时检测

检查 Skill 中引用的依赖版本是否与项目当前版本匹配：

```text
⚠️ 过时警告：
`api-error-handler` 中使用的 axios@0.21.0
项目当前使用 axios@1.6.0
建议：更新 Skill 中的代码示例
```

### 3. 频率统计

统计每个 Skill 被触发的次数，输出使用报告：

```text
📊 使用频率报告（近30天）
🔥 高频使用（>10次）：date-format-helper, api-error-handler
👍 正常使用（1-10次）：table-renderer, payment-process-handler
💤 低频使用（0次）：xml-parser-helper, legacy-validator
建议：将低频 Skill 归档或更新其适用场景描述
```

### 4. 合并建议

如果多个 Skill 经常组合使用，建议合并：

```text
💡 合并建议：
`api-handler` 和 `error-retry` 在 80% 的场景中一起使用
建议：合并为 `api-client` Skill，或创建组合 Skill
```

### 优化输出报告

```text
📊 Skill 健康报告
- 总 Skills：12 个
- 经常使用（>10次/月）：5 个 ✅
- 偶尔使用（1-10次/月）：4 个
- 从未使用：3 个（建议归档）
- 建议更新：2 个（依赖版本过时）
- 建议合并：`api-handler` 和 `error-retry` → 合并为 `api-client`

执行 `/skills archive [name]` 归档，或手动编辑更新内容。
```

## 完整工作流示例

### 场景一：自动识别并创建 Skill

```text
你：这段日期格式化的逻辑在很多地方都在用，抽离成 Skill 吧

Claude Code：[触发 Skill Factory]
🔍 检测到重复模式：在 UserService.ts、OrderService.ts、ReportGenerator.ts
   中都有相同的 `formatDateTime` 函数。
📦 正在分析依赖...
   输入：Date 对象或时间戳
   输出：格式化的字符串
   依赖：dayjs@1.11.0
📝 正在生成 Skill...
✅ 已创建 Skill：date-format-helper.md
📁 位置：.claude/skills/date-format-helper.md
📝 下次遇到日期处理时，我会自动推荐使用这个 Skill。
💡 使用 `/skills show date-format-helper` 查看详情
```

### 场景二：后续对话自动匹配

```text
你：帮我写一个显示创建时间的组件

Claude Code：[自动匹配到 date-format-helper Skill]
📅 检测到日期处理需求，我将使用 `date-format-helper` Skill。
[按照 Skill 中的模板生成代码...]
```

### 场景三：手动管理 Skill

```text
你：/skills list

Claude Code：
📚 已安装的 Skills：
1. date-format-helper - 日期格式化和时区转换 (使用: 12次)
2. api-error-handler - 统一 API 错误处理和重试 (使用: 8次)
3. table-renderer - 可配置的数据表格渲染 (使用: 5次)

你：/skills show api-error-handler

Claude Code：[显示完整的 Skill 内容...]

你：/skills search validation

Claude Code：
🔍 搜索 "validation" 的结果：
1. email-validator - 邮箱格式校验
2. phone-validator - 手机号格式校验
3. form-validation-rules - 通用表单校验规则
```

### 场景四：优化和维护

```text
你：优化 Skills

Claude Code：[触发 Skill Optimizer]
📊 正在扫描 Skills 使用情况...
⚠️ 发现 `xml-parser-helper` 从未被使用（创建于 90 天前）
💡 建议：归档或删除此 Skill
⚠️ `api-error-handler` 中引用的 axios 版本已过时
💡 建议：更新代码示例
💡 发现 `api-handler` 和 `error-retry` 经常组合使用
💡 建议：创建组合 Skill `api-client`

是否执行上述优化？[Y/n]
```

## 维护机制

- **对话后更新（每次会话必做）**：每次对话结束前，回顾本次对话是否命中「适用场景」中的触发条件——识别到重复模式、用户要求抽离/封装逻辑、现有 Skill 被调用但暴露出缺陷或过时内容等。若命中，**当场更新**对应 Skill（新建、修正 description、补充或更新示例/代码），不得推迟到下次对话。
- **主动提取（每次会话必做）**：若对话中出现可提取为 Skill 的内容——新的重复模式、通用工具函数、可复用的业务逻辑或模板——即使仍在对话中、用户未明确要求，也按「工作流程」**当场提取并创建**对应 Skill。
- **标准化（每次会话必做）**：保持本 Skill 与创建的每个 Skill 符合标准格式——标准 frontmatter（`name` + `description`）、标准骨架（适用场景/工作流程/速查表/常见错误）、规范命名与代码围栏。每次修改后自查格式一致性，不标准即修正。
- **流程化（每次会话必做）**：Skill 的识别→分析→设计→创建→验证→通知，严格按「工作流程」步骤顺序执行，不跳步、不省略、不随意调整顺序。
- **自动化（每次会话必做）**：命中「适用场景」触发条件即自动执行对应动作——自动识别、自动提取、自动更新——无需用户逐条指挥；执行完成后主动向用户报告已完成的 Skill 操作。
- **版本控制**：将 `.claude/skills/` 提交到 Git，团队共享
- **定期审查**：定期运行 `/skills stats` 或本技能「自动优化系统」查看使用情况
- **内容更新**：项目依赖升级或架构变更时，同步更新相关 Skill

Skill 生命周期：

```text
创建 → 使用 → 优化 → 合并/归档 → 删除
  ↑                    |
  └────────────────────┘ (重新激活)
```

### 最佳实践

1. **描述要精准**：description 字段包含关键词，方便 AI 检索
2. **示例要完整**：提供可直接运行的代码示例
3. **边界要清晰**：明确说明不适用场景
4. **保持更新**：定期审查和更新过时内容
5. **团队协作**：鼓励团队成员贡献和使用 Skills

## 配置文件（可选）

在 `.claude/skills/config.json` 中配置：

```json
{
  "autoCreate": true,
  "autoOptimize": true,
  "optimizeFrequency": "monthly",
  "minUsageBeforeArchive": 0,
  "maxAgeBeforeReview": 90,
  "excludePatterns": ["test-*", "demo-*"],
  "template": "templates/skill-template.md"
}
```

## 附录：Skill 模板示例

以下是一个可直接复用的 Skill 模板（`example-helper`）：

````markdown
---
name: example-helper
description: 这是一个示例 Skill 模板，展示标准结构
---

# 示例 Helper

## 适用场景

- 当需要处理 X 问题时
- 当需要生成 Y 代码时

## 使用方式

直接在对话中描述需求，AI 会自动调用此 Skill

## 核心实现

```typescript
// 核心代码示例
export function exampleFunction(input: string): string {
  return `Processed: ${input}`;
}
```

## 示例

### 输入

```
请帮我处理这个数据
```

### 输出

```
处理后的数据
```

## 注意事项

- 依赖：需要安装 xxx 库
- 限制：不支持 xxx 场景
- 版本：适用于 Node.js 18+
````

## 速查表

| 场景                                 | 操作                            |
| ------------------------------------ | ------------------------------- |
| 同一逻辑重复 3 次及以上 / 跨文件复用 | 按「工作流程」新建 Skill        |
| 用户要求"抽离/封装/复用/固化逻辑"    | 立即启动本 Skill                |
| 对话后命中触发条件                   | 当场更新对应 Skill              |
| 对话中发现可提取内容                 | 当场提取为新 Skill              |
| 用户输入 `/skills xxx`               | 按「用户命令系统」响应          |
| 用户说"优化/清理/更新 Skills"        | 执行「自动优化系统」审查        |
| 新建 Skill 未被触发                  | 检查并修正 `description` 关键词 |

**标准骨架**：`frontmatter（name + description）→ 适用场景 → 工作流程 → 速查表 → 常见错误`

## 常见错误

| 错误                                     | 后果                 | 修正                                                    |
| ---------------------------------------- | -------------------- | ------------------------------------------------------- |
| `description` 写"它做什么"而非"何时触发" | 模型不确定该不该调用 | 用"当…时使用"描述触发条件                               |
| 把 `/skills` 命令当成已注册的 CLI 命令   | 命令不存在导致困惑   | 视为对话式行为，或在 `.claude/commands/` 注册为真实命令 |
| 示例代码依赖过时版本                     | 复用时直接报错       | 更新示例到项目当前依赖版本                              |
| 文件位置或命名错误                       | 技能无法被加载       | 统一放 `.claude/skills/[kebab-case]/SKILL.md`           |
| 只写流程不写触发场景                     | 技能难以被发现       | 在 `description` 和适用场景中写明触发关键词             |

## 参考

- 官方 `skill-creator`（`.agents/skills/skill-creator`）— 完整的技能创建、评估与 description 优化流程

---

**最后更新**：2026-08-18
