# 项目规划

## 项目需求

- 1. 功能：项目是一个基于 Electron 框架的桌面应用，用于管理电脑上的一些基本信息、任务、进程、网络信息等。
  - 1.1 可以查看电脑的基本信息，如 CPU、内存、硬盘、操作系统、版本号、总容量、已用容量等。
  - 1.2 可以查看电脑的网络信息，如 IP 地址、网关、子网掩码、DNS 服务器、MAC 地址、DHCP 状态、网络接口、网络协议、网络状态、网络类型等。
  - 1.3 可以查看电脑的进程信息，如运行中的进程、占用的内存、通过提示被占用的端口号进行查询占用端口等。
- 2. 功能：电脑大文件管理，如视频、图片、文档等。
  - 2.1 可以查看电脑上的所有大文件，如视频、图片、文档等。
  - 2.2 可以对大文件进行分类，如按文件类型、文件大小、文件创建时间等。
  - 2.3 可以对大文件进行搜索，如按文件名、文件路径等进行搜索。
- 3. 功能：屏蔽电脑上某些软件的各种广告或者个性化推荐。
  - 3.1 可以对电脑上的所有软件进行广告屏蔽，如对浏览器、视频播放器、文档编辑器、搜狗拼音输入法、百度输入法等进行广告屏蔽。
  - 3.2 可以对电脑上的所有软件进行个性化推荐屏蔽，如对浏览器、视频播放器、文档编辑器等进行个性化推荐屏蔽。
- 4. 功能：能够对个人简历进行优化（STAR原则），如添加技能、工作经历、项目经历等。
  - 4.1 可以对个人简历进行优化，如添加技能、工作经历、项目经历等。
  - 4.2 可以对个人简历进行优化，如添加项目经历、工作经历等。
- 5. 功能：可以实现通过所给资料实现 思维导图、流程图、审批流程等
- 6. 保护功能：可自定义水印文本、字体和字号、不透明度、旋转角度、单行水印和多行水印（一页两行、一页三行、一页六行、一页八行）、以及文本位置和是否应用于全部页面。
  - 6.1 给图片、PDF 等文档添加防伪水印
  - 6.2 给视频添加防伪水印

## 技术栈

- Electron
- React
- Node.js
- TypeScript
- SQLite

## 项目结构

```md
project-root/
├── .claude/
│ ├── skills/ # Claude Code 技能目录
│ ├── rules.md # Claude Code 规则文件
│ ├── conventions.md # 编码规范
│ └── prompts/ # 常用提示词模板
├── .codex/
│ ├── skills/ # Codex 技能目录
│ ├── config.yaml # Codex 配置
│ └── rules/ # Codex 规则目录
├── .agent/
│ ├── skills/ # Agent 技能目录
│ ├── config.yaml # Agent 配置
│ └── rules/ # Agent 规则目录
├── docs/
│ ├── ARCHITECTURE.md # 架构设计文档
│ ├── API_SPEC.md # API规范
│ ├── CODING_STANDARDS.md # 编码标准
│ └── COMPONENT_LIBRARY.md # 组件库文档
├── .ai-rules/
│ ├── global-rules.md # 全局规则
│ ├── backend-rules.md # 后端规则
│ └── frontend-rules.md # 前端规则
.... 注意：需要把具体的前后端项目代码放到对应的目录下
```

## Agent Skill

### Skills 目录

```md
开发流程 ----- skills/SKILL.md
参考文档 ----- skills/reference
开发工具 ----- skills/scripts
静态资源 ----- skills/assets
```
### 常用Skill

- 1. 【`typescript-advanced-types`】
```sh
# 先进的 TypeScript 类型系统模式，用于构建类型安全、可复用的组件和工具函数。 
npx skills add https://github.com/wshobson/agents --skill typescript-advanced-types
```
- 2. 【`vercel-react-best-practices`】
```sh
# 在 70 条规则中，根据影响程度对规则进行排序后，进行 React 和 Next.js 的性能优化。
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
```
- 3. 【`frontend-design`】
```sh
# 前端界面独具特色，属于专业级水准。通过精心设计，它们刻意避免了那种千篇一律的 AI 风格。
npx skills add https://github.com/anthropics/skills --skill frontend-design
```
- 4. 【`anthropics/skills`】
```sh
# 人类学/技能
npx skills add anthropics/skills
```
- 5. 【`skill-creator`】
```sh
# 创建技能
npx skills add https://github.com/anthropics/claude-plugins-official --skill skill-creator
```
- 6. 【`skill-development`】
```sh
# 技能提升：为 Claude 代码插件提供技能开发培训
npx skills add https://github.com/anthropics/claude-plugins-official --skill skill-development
```
- 7. 【`vercel-composition-patterns`】
```sh
# React 组合模式用于组件缩放和避免布尔道具的繁衍。
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns
```
- 8. 【`ui-ux-pro-max`】
```sh
# 针对网页和移动应用界面/用户体验的全方位设计智能方案，涵盖 10 种不同的技术栈。
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max
```
- 9. 【`webapp-testing`】
```sh
# 采用原生 Python 编写的 Playwright 脚本，可用于测试包含服务器生命周期管理的本地 Web 应用程序。
npx skills add https://github.com/anthropics/skills --skill webapp-testing
```