# SnipJet 维护者文档

本文件面向参与 SnipJet 开发、构建、发布的贡献者。普通用户请阅读 [README.md](README.md)。

---

## 🚀 开发与构建

### 环境要求

- **Node.js** ≥ 18
- **Rust** ≥ 1.77.2
- **Windows**：WebView2（Win10+ 默认已安装）；部分功能依赖 Windows 平台原生能力（如开机自启动注册表读写）

### 开发模式

```bash
# 安装前端依赖
npm install

# 启动 Tauri 开发窗口（自动运行 vite + 启动 Rust 后端）
npm run tauri dev
```

### 单独构建前端（调试 UI 用）

```bash
npm run dev      # 启动 vite 开发服务器
npm run build    # 打包前端到 dist/
npm run preview  # 预览构建结果
```

### 构建发布版（Windows）

```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

构建产物：
- **NSIS 安装包**：`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`
- **MSI 安装包**：`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`
- **原始 exe**：`src-tauri/target/x86_64-pc-windows-msvc/release/SnipJet.exe`

### 只构建便携版 exe（不打安装包）

```bash
npx tauri build --no-bundle --target x86_64-pc-windows-msvc
```

主 exe 嵌入了前端资源、icons、WebView2 loader，单文件即完整应用，无需附带 resources/、bundle/ 等。

---

## 📦 发布流程

### 仓库分工

| 仓库 | 角色 | 内容 |
|---|---|---|
| [GitHub `float0108/SnipJet`](https://github.com/float0108/SnipJet) | **代码主仓库** | 全部代码、commits、tags、Issues、PR |
| [Gitee `float0108/SnipJet`](https://gitee.com/float0108/SnipJet) | **发布镜像** | 仅 release 产物（exe / msi / portable.zip） |

- 所有开发活动（提交代码、提 Issue、提 PR）默认在 GitHub 进行
- Gitee 代码通过其官方「GitHub 自动同步」功能每 24 小时拉取一次
- Gitee release 产物由 workflow 在打 tag 时即时同步

### 1. 触发自动发布

```bash
git tag v1.2.3
git push origin v1.2.3
```

`origin` 指向 GitHub。推送 `v*` 形式的 tag 即触发 [.github/workflows/release.yml](.github/workflows/release.yml)。

### 2. 工作流会做的事

1. `build` job（Windows runner）：
   - 跑 `npx tauri build` 生成 NSIS + MSI
   - 再跑 `npx tauri build --no-bundle` 拿到原始 exe
   - 用 PowerShell 内联 `Compress-Archive` 打便携 zip 到 `dist/`
   - 一次性上传 `snipjet-windows` artifact
2. `release` job（Ubuntu runner）：
   - 下载 `snipjet-windows`
   - 发布到 **GitHub Releases**
   - 同步产物（仅附件）到 **Gitee Releases**

> 工作流**不会**把代码 push 到 Gitee。Gitee 代码由其后台的「GitHub 同步」定时拉取。

### 3. 必需的 Secrets / Variables

在 GitHub 仓库 **Settings → Secrets and variables → Actions**：

| 名称 | 类型 | 说明 |
|---|---|---|
| `GITEE_TOKEN` | Secret | Gitee 私人令牌，需 `projects` / `releases` 权限（仅用于上传 release 附件） |
| `GITEE_REPO` | Variable | Gitee 仓库路径，如 `float0108/SnipJet` |

### 4. Gitee 自动同步代码配置

1. 登录 https://gitee.com，进入 [SnipJet 仓库](https://gitee.com/float0108/SnipJet)
2. 顶部 **管理** → **仓库设置** → **同步设置**
3. 启用「**从 GitHub 仓库同步**」
4. 填 `https://github.com/float0108/SnipJet`，保存

完成后 Gitee 会每 24 小时自动从 GitHub 拉取最新代码 + tags。

### 5. 产物命名

| 文件 | 类型 | pickAsset 匹配 |
|---|---|---|
| `SnipJet_<version>_x64-setup.exe` | 安装版（NSIS） | `/setup/i` |
| `SnipJet_<version>_x64.msi` | MSI 安装包 | `/\.msi$/i` |
| `SnipJet_<version>_x64-portable.zip` | 便携版 | `/portable/i` |

应用内 [src/views/settings/updater.js](src/views/settings/updater.js) 的 `pickAsset` 按以上规则识别。

> ⚠️ Tauri/WiX 默认会产出 `*_en-US.msi`，CI 上的 `Normalize MSI filename` 步骤会自动重命名为标准的 `*.msi`。

---

## 🔖 版本号策略

### 约束

Tauri 的 MSI 目标（走 WiX）对 `version` 字段有严格要求：

- **必须**符合 `MAJOR.MINOR.PATCH[-PRERELEASE]` 格式
- **`PRERELEASE` 段只能是数字**，不能含字母（如 `beta` / `alpha` 都不行）
- 数字段 ≤ 65535

**不符合会报错**：

```
failed to bundle project: `optional pre-release identifier in app version must be
numeric-only and cannot be greater than 65535 for msi target`
```

### 合法的版本号示例

| 版本号 | 用途 | 是否合法 |
|---|---|---|
| `0.2.0` | 正式版 | ✅ |
| `0.2.1` | 补丁 | ✅ |
| `0.3.0-rc.1` | 预发布 | ❌ `rc` 是字母 |
| `0.3.0-rc1` | 预发布 | ✅ |
| `0.3.0-alpha.1` | 预发布 | ❌ `alpha` 是字母 |
| `0.3.0-1` | 预发布 | ✅ 用纯数字后缀 |

### 正式版 vs 预发布

SnipJet 用 **Git tag** 区分正式版和预发布，`version` 字段只用纯数字格式：

| 场景 | `version` 字段 | Git tag | GitHub Release |
|---|---|---|---|
| 正式发布 | `0.2.0` | `v0.2.0` | 正式版 |
| 预发布 | `0.3.0` | `v0.3.0-rc1` | 预发布（自动识别 `-` 后缀） |
| 内部测试 | `0.3.0` | `v0.3.0-beta1` | 预发布 |

`tauri-action` 会自动根据 tag 名是否含 `-` 判定 GitHub Release 是 prerelease，不需要额外配置。

### 升级步骤

#### 正式版发布

```bash
# 1. 修改 src-tauri/tauri.conf.json 和 package.json 的 version 字段
#    （两处必须保持一致，例如都改成 0.3.0）
# 2. 提交
git add -A
git commit -m "chore: bump version to 0.3.0"

# 3. 打 tag 并推送（workflow 自动判定为正式版）
git tag v0.3.0
git push origin main v0.3.0

# 4. workflow 自动触发，发布到 GitHub + Gitee
#    tauri-action 看到 tag 不含 '-' → 标记为正式发布
```

#### 预发布版（RC / Beta）

预发布时 `version` 字段**不要带后缀**，版本号仍然是下一个正式版的号（预发布标识只放在 tag 上）：

```bash
# 1. version 字段保持目标号（如 0.3.0），不要写成 0.3.0-rc1
#    src-tauri/tauri.conf.json: "version": "0.3.0"
#    package.json: "version": "0.3.0"

# 2. 提交
git add -A
git commit -m "chore: prepare 0.3.0-rc1"

# 3. 打预发布 tag 并推送
git tag v0.3.0-rc1
git push origin v0.3.0-rc1

# 4. workflow 自动触发，tauri-action 看到 tag 含 '-' → 标记为预发布
#    GitHub Release 会标 Pre-release，Gitee 也跟随
```

#### 修补发布流程

如果 v0.3.0 之后发现 bug 想快速发个补丁：

```bash
# 1. 修复 bug，提交
git add -A
git commit -m "fix: ..."

# 2. 把 version 字段改成 0.3.1
# 3. 打 tag
git tag v0.3.1
git push origin main v0.3.1
```

#### 常见错误

- ❌ `version` 写成 `0.3.0-rc1` → MSI 构建失败（字母后缀）
- ❌ tag 写成 `0.3.0`（没有 `v` 前缀）→ workflow 不触发（trigger 模式是 `v*`）
- ❌ 改了 `tauri.conf.json` 但忘了改 `package.json`（或反过来）→ 产物文件名与 GitHub Release 标题不一致
- ❌ 提交了再打 tag，但没 push commits 就 push tag → workflow 跑出来的源码不是 tag 对应的版本

---

## 🗂️ 项目结构

```
SnipJet/
├── src/                          # 前端（Vite + 原生 JS）
│   ├── views/
│   │   ├── main/                 # 主窗口（剪贴板历史列表）
│   │   ├── reader/               # 详情查看器窗口
│   │   ├── settings/             # 设置窗口
│   │   └── expander/             # 文本扩展管理窗口
│   ├── components/               # 共享组件（卡片、空状态、iframe 容器等）
│   ├── services/                 # 前端服务层（剪贴板、主题、窗口、快捷键）
│   ├── utils/                    # 工具函数（i18n、formatter、logger）
│   ├── config/settings.json      # 默认设置
│   ├── public/bootstrap.js       # Tauri bootstrap
│   ├── index.html                # 主窗口入口
│   ├── reader.html               # 查看器入口
│   ├── settings.html             # 设置入口
│   └── expander.html             # 文本扩展入口
│
├── src-tauri/                    # Rust 后端（Tauri 2.x）
│   ├── src/
│   │   ├── core/                 # 剪贴板监听、文本扩展、数据存储
│   │   ├── generators/           # 多格式导出（HTML / DOCX / Office 自动化）
│   │   ├── mcp/                  # MCP 服务端实现
│   │   ├── clipboard_manager.rs  # 剪贴板管理器
│   │   ├── commands.rs           # Tauri 命令接口
│   │   └── main.rs / lib.rs      # 入口
│   ├── scripts/
│   │   └── insert_to_office.ps1  # Office 自动化脚本（Rust 用 include_str! 嵌入）
│   ├── text_expand.yaml          # 文本扩展规则配置
│   ├── tauri.conf.json           # Tauri 应用配置
│   └── Cargo.toml                # Rust 依赖清单
│
├── .github/
│   └── workflows/
│       └── release.yml           # 自动发布工作流（含产物说明）
│
├── package.json                  # 前端依赖与脚本
└── vite.config.js                # Vite 构建配置
```

---

## 🔧 配置说明

### 设置文件位置

所有用户设置统一存放在 `src/config/settings.json` 中（开发态），运行时由前端读取并通过 `localStorage` 缓存。Rust 后端维护独立的状态（历史、收藏、文本扩展规则）。

### 文本扩展规则

文本扩展规则以 YAML 文件形式存储，路径：

```
src-tauri/text_expand.yaml
```

格式示例：

```yaml
rules:
  - key: ":hello"
    content: "Hello, World!"
    group: "greeting"
    description: "问候语"
    date: "2026-02-12"
```

> 在「文本扩展」窗口的 UI 中可直接增删改查并保存到该文件。

### Tauri 配置要点

[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 关键字段：

- `productName` / `version`：构建时同步到所有产物文件名
- `bundle.targets`：`["nsis", "msi"]` —— 同时产出 NSIS 和 MSI
- `bundle.windows.nsis.installMode`：默认 `"currentUser"`，无需管理员权限

---

## 🤝 贡献

提交代码前请确认：

1. 已安装工具链：Rust 1.77+、Node 18+、Tauri CLI
2. 在本地执行 `npm run tauri dev` 验证主流程可用
3. 不要提交构建产物（`dist/`、`src-tauri/target/`）与本地配置
4. 提交前请运行 `cargo fmt` 和 `cargo clippy`

---

## 🐞 调试技巧

### 后端日志

Rust 后端使用 `env_logger` + `log::info!`，日志通过 Tauri 命令通道返回。开发模式下可在终端直接看到 stdout 输出。

### 前端日志

前端用自定义 logger（[src/utils/logger.js](src/utils/logger.js)），可在 DevTools（F12）控制台查看。

### 清理构建缓存

```bash
# 清理 Rust 缓存
cd src-tauri && cargo clean

# 清理前端缓存
rm -rf node_modules dist

# 清理 Tauri 缓存（Windows）
Remove-Item -Recurse -Force "$env:LOCALAPPDATA/com.snipjet.desktop"
```
