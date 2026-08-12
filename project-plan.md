
# 项目规划

## 项目需求
- 1. 项目是一个基于 Electron 框架的桌面应用，用于管理电脑上的一些基本信息、任务、进程、网络信息等。
  - 1.1 可以查看电脑的基本信息，如 CPU、内存、硬盘、操作系统、版本号、总容量、已用容量等。
  - 1.2 可以查看电脑的网络信息，如 IP 地址、网关、子网掩码、DNS 服务器、MAC 地址、DHCP 状态、网络接口、网络协议、网络状态、网络类型等。
  - 1.3 可以查看电脑的进程信息，如运行中的进程、占用的内存、通过提示被占用的端口号进行查询占用端口等。

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
│   ├── skills/               # Claude Code 技能目录
│   ├── rules.md              # Claude Code 规则文件
│   ├── conventions.md        # 编码规范
│   └── prompts/              # 常用提示词模板
├── .codex/
│   ├── skills/               # Codex 技能目录
│   ├── config.yaml           # Codex 配置
│   └── rules/                # Codex 规则目录
├── .agent/
│   ├── skills/               # Agent 技能目录
│   ├── config.yaml           # Agent 配置
│   └── rules/                # Agent 规则目录
├── docs/
│   ├── ARCHITECTURE.md       # 架构设计文档
│   ├── API_SPEC.md          # API规范
│   ├── CODING_STANDARDS.md  # 编码标准
│   └── COMPONENT_LIBRARY.md # 组件库文档
├── .ai-rules/
│   ├── global-rules.md       # 全局规则
│   ├── backend-rules.md      # 后端规则
│   └── frontend-rules.md     # 前端规则
.... 注意：需要把具体的前后端项目代码放到对应的目录下
```

## Agent Skill
```md
开发流程 ----- skills/SKILL.md
参考文档 ----- skills/reference
开发工具 ----- skills/scripts
静态资源 ----- skills/assets
```

