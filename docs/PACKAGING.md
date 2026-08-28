# 打包发布指南（Windows 安装包）

> 本文说明 `release/` 目录中 `.exe` 安装包是如何生成的，以及完整的操作步骤。
> 适用对象：需要在本机打新版本安装包的开发者。

## 1. 一句话概括

`npm run dist` 分两步完成：先用 **electron-vite** 把 `src/` 编译到 `out/`，再用 **electron-builder** 把 `out/` 打包成 NSIS 安装包输出到 `release/`。

```
npm run dist
  = electron-vite build   # 1. 编译 main / preload / renderer → out/
  + electron-builder      # 2. 读取 electron-builder.yml → 生成安装包到 release/
```

## 2. 产物一览（release/ 目录）

在 Windows x64 上执行一次 `npm run dist` 后，`release/` 下会生成：

| 文件 / 目录 | 说明 |
|-------------|------|
| `my-pc Setup <版本>.exe` | **NSIS 安装包**（向导式安装，可选手动选择安装目录），即分发对象 |
| `my-pc Setup <版本>.exe.blockmap` | 差分更新映射（供 electron-updater 增量下载用） |
| `latest.yml` | 自动更新元数据（版本号、文件哈希、发布时间的 YAML 清单） |
| `win-unpacked/` | 解包后的完整应用目录（体积最大，安装包即由它压缩而来），可直接运行 `my-pc.exe` 验证 |
| `builder-debug.yml` | electron-builder 本次打包的完整生效配置（排查用） |

> 当前示例：`package.json` 版本为 `0.1.1`，产物将命名为 `my-pc Setup 0.1.1.exe`（约 84 MB）。
> 现有 `release/my-pc Setup 0.1.0.exe` 是版本 `0.1.0` 时的产物。

## 3. 操作步骤

### 3.1 环境要求

- **Node.js 20+**（Electron 36 内置 Node 22，本机安装环境满足即可）
- **Windows**（本项目 target 为 `win x64 / nsis`；在 Windows 上打包最稳妥）
- 已执行过 `npm install`

### 3.2 打新版本安装包

```bash
# 1.（建议）先改版本号：package.json → version 字段，如 "0.1.1"
#    版本号直接决定安装包文件名与 latest.yml 中的版本。

# 2.（建议）类型检查 —— 项目的验证门
npm run typecheck

# 3.（建议）先预览编译产物，确认无误再打包
npm run build && npm run start

# 4. 一键打包（自动完成编译 + 打包两步）
npm run dist
```

等待执行结束，安装包即出现在 `release/` 目录。

### 3.3 验收

1. 确认 `release/my-pc Setup <版本>.exe` 已生成，且文件名中的版本号正确。
2. 双击 `release/win-unpacked/my-pc.exe` 直接运行解包版，快速验证功能。
3. 完整安装一次安装包：应出现**向导式安装界面**（非一键安装）、可修改安装目录、按当前用户安装（默认装到 `%LOCALAPPDATA%\Programs\my-pc\`，无需管理员权限）。

## 4. 关键配置

### 4.1 `electron-builder.yml`

```yaml
appId: com.mypc.app              # 应用唯一标识
productName: my-pc               # 应用名与安装包前缀
directories:
  output: release                # 打包输出目录
files:
  - out/**                       # 只打包编译产物（不含源码）
win:
  target:
    - target: nsis               # NSIS 安装包
      arch:
        - x64                    # 仅 x64
nsis:
  oneClick: false                # 关闭一键安装 → 向导式安装
  allowToChangeInstallationDirectory: true   # 允许用户改安装目录
  perMachine: false              # 按用户安装，无需管理员权限
```

各字段含义：

| 字段 | 含义 | 本项目的取值 |
|------|------|-------------|
| `directories.output` | 打包输出目录 | `release/` |
| `files` | 打进安装包的文件范围 | 仅 `out/**`（编译产物） |
| `win.target` | Windows 目标格式与架构 | `nsis` + `x64` |
| `nsis.oneClick` | `true` 一键静默安装 / `false` 向导式安装 | `false` |
| `nsis.allowToChangeInstallationDirectory` | 是否允许改安装目录（向导式下生效） | `true` |
| `nsis.perMachine` | `true` 全机器安装 / `false` 当前用户安装 | `false` |

### 4.2 `electron.vite.config.ts`

main / preload 段用了 `externalizeDepsPlugin()`：将 `package.json` 的 `dependencies`（如 `systeminformation`）保留为外部依赖，不打进 bundle，运行时从 `node_modules` 加载。因此打包时 electron-builder 会一并把生产依赖的 `node_modules` 收进安装包。

### 4.3 `.npmrc`

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

首次打包 / 安装依赖时，Electron 二进制默认从 GitHub 下载，国内网络较慢。此配置将其指向 **npmmirror 镜像**以加速。

## 5. 常见问题与注意事项

- **安装包文件名变了？** 文件名含版本号（`my-pc Setup <version>.exe`），来自 `package.json` 的 `version` 字段。改版本号后产物名自动跟随。
- **electron-builder 下载慢 / 失败？** electron-builder 会把 Electron 发行版与 NSIS 工具缓存到 `%LOCALAPPDATA%\electron-builder\Cache`。国内网络可确认 `.npmrc` 的镜像配置；清理缓存后重试。
- **SmartScreen 提示「未知发布者」？** 项目未配置代码签名，属正常现象，选择「仍要运行」即可。正式分发建议配置证书签名。
- **默认图标？** 未在 `electron-builder.yml` 配置 `icon`，安装包与 `my-pc.exe` 使用 Electron 默认图标。自定义图标可添加 `build/icon.ico` 并在 `win.icon` / `nsis` 中指定。
- **`latest.yml` 与 `.blockmap` 有什么用？** 供自动更新（`electron-updater`）使用。本项目当前未接入自动更新，属 electron-builder 附带生成，可忽略。
- **打包前务必先通过 `npm run typecheck`** —— 这是本项目的验证门，避免把类型错误带进发布包。

## 6. 发布前 Checklist

- [ ] `package.json` 版本号已更新（决定产物名）
- [ ] `npm run typecheck` 通过
- [ ] `npm run build && npm run start` 预览确认功能正常
- [ ] `npm run dist` 打包成功，`release/my-pc Setup <版本>.exe` 已生成
- [ ] 安装包 / `win-unpacked/my-pc.exe` 冒烟验证（启动、主要功能页可打开）
