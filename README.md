<p align="center">
  <img src="public/quotapeek.svg" width="80" alt="QuotaPeek" />
</p>

<h1 align="center">QuotaPeek</h1>

<p align="center">All your AI limits at a glance.</p>
<p align="center">在桌面上快速查看 AI 服务的额度、余额与重置时间。</p>

<p align="center">
  <a href="https://github.com/LiDe2000/QuotaPeek/releases">下载</a> ·
  <a href="#下载安装与使用">使用指南</a> ·
  <a href="#从源码开发">开发指南</a> ·
  <a href="docs/troubleshooting.md">常见问题</a>
</p>

## 简介

QuotaPeek 是一款基于 Tauri 的桌面额度查看工具，将多个 AI 服务集中在紧凑的悬浮侧栏中。悬停即可预览额度，单击即可刷新，无需反复打开各个平台的账户页面。

目前主要面向 Windows；其他平台尚未完成实机验证。

## 功能

- **集中查看**：支持 Codex、WorkBuddy、ZCode 和 DeepSeek 的额度或余额查询。
- **多账户切换**：按供应商分组，在同一张卡片中切换账户，并记住各供应商的选择。
- **平台排序**：按住平台球或主界面平台标签约半秒后拖动，松开保存；两处顺序同步，重启后保留。按 Esc 取消，也可聚焦后用 Alt＋方向键调整顺序。
- **快速预览与刷新**：悬停图标查看缓存数据，单击刷新当前账户，也可一次刷新全部账户。
- **状态恢复与反馈**：启动时恢复账户并查询额度，显示最后更新时间；查询失败时保留上次结果。
- **自适应卡片**：窗口随内容调整高度，超出上限后在卡片内滚动；靠近屏幕左右边缘时调整展开方向。
- **外观主题**：提供 Original、Midnight 和 Pearl 三种主题。
- **托盘驻留**：从系统通知区域显示、隐藏或退出应用。

## 支持的服务

| 服务 | 查询内容 | 账户连接 |
| --- | --- | --- |
| Codex | 多个额度窗口的剩余比例、重置时间 | 使用本机 Codex 的 ChatGPT 登录状态，目前支持一个本地账户 |
| WorkBuddy | Credits 余额、使用比例、套餐明细与到期时间 | 浏览器授权，支持多个账户 |
| ZCode | 额度余额、使用比例与额度明细 | 浏览器授权，支持 Z.ai 和 BigModel 多个账户 |
| DeepSeek | 账户总余额、充值余额和赠金余额 | 浏览器账户登录，支持多个账户 |

## 下载安装与使用

### 下载与运行

Windows 可执行文件将通过 [GitHub Releases](https://github.com/LiDe2000/QuotaPeek/releases) 发布。打开版本页面，在 **Assets** 中选择适合系统架构的文件；如果尚无可下载文件，可按下方的开发指南从源码构建。

- **应用可执行文件**（如 `quotapeek.exe`）：下载到本地后双击运行。
- **安装包**（如 `*-setup.exe` 或 `.msi`，以该版本实际提供的附件为准）：运行安装程序，完成后从开始菜单或快捷方式启动。

使用发布版本无需安装 Node.js、Rust/Cargo 或 C++ Build Tools。Windows 需要 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)；若启动时提示缺少 WebView2，请先安装运行时。

### 连接账户

1. 启动 QuotaPeek，点击侧栏的 **＋**。
2. 选择服务，按界面提示连接账户。
3. 连接成功后查看额度或余额；再次启动时会恢复已连接账户并查询一次。

连接 **Codex** 前，需要在本机安装 Codex 并使用 ChatGPT 账户登录。QuotaPeek 读取已有登录状态，目前支持一个本地 Codex 账户；API key 登录不支持订阅额度查询。

**WorkBuddy、ZCode 和 DeepSeek** 通过浏览器完成授权或登录，支持多个账户。DeepSeek 默认使用开放平台账户登录，无需填写 API Key；之前连接的 API Key 账户仍可刷新。累计消费未返回时显示“—”。

### 日常操作

| 操作 | 功能 |
| --- | --- |
| 悬停供应商图标 | 预览当前账户的缓存额度或余额 |
| 单击供应商图标 | 刷新当前账户 |
| 单击 QuotaPeek 主图标 | 打开或收起主面板 |
| 主面板中的账户标签 / 预览右下角的数字按钮 | 切换同一供应商的账户 |
| 账户卡片右上角的 **×** | 确认后移除该账户在 QuotaPeek 中的连接、授权信息和额度缓存 |
| 主面板顶部的刷新按钮 | 刷新全部已连接账户 |
| 主面板中的主题设置 | 切换 Original、Midnight 或 Pearl 主题 |
| 左键点击托盘图标 | 显示主面板 |
| 右键点击托盘图标 | 显示、隐藏、置顶窗口或退出应用 |

关闭窗口会隐藏到托盘；完全退出请使用托盘菜单中的 **Quit**。托盘图标可能被 Windows 收进通知区域的折叠菜单。

账户连接信息、额度缓存和界面偏好保存在本机。连接或运行遇到问题时，请参阅 [排障文档](docs/troubleshooting.md)。

移除账户只操作 QuotaPeek，不退出供应商网站或浏览器登录。移除 Codex 只断开本地连接并清理 QuotaPeek 缓存，Codex 本身保持登录。移除后可重新连接；若该账户正在查询，会等待查询结束后完成移除。

## 从源码开发

项目使用 React、TypeScript 和 Vite 构建界面，使用 Tauri 2 和 Rust 实现桌面功能与服务查询。以下步骤适用于从源码运行、修改或构建应用。

### 环境要求

- Node.js 22.12 或更高版本，以及 npm。
- Git，用于克隆仓库。
- Rust 工具链（包含 `rustc` 编译器和 `cargo` 包管理/构建工具），通过 [rustup](https://rust-lang.org/tools/install/) 安装；Windows 使用 stable MSVC 工具链。
- [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 Microsoft C++ Build Tools 和 WebView2。

`npm ci` 和 `npm install` 只安装 JavaScript 依赖，不会安装 Rust/Cargo 或系统构建工具。

### Windows 首次配置

1. 安装 Node.js 和 npm。
2. 安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **使用 C++ 的桌面开发（Desktop development with C++）**，保留该工作负载默认的 MSVC 和 Windows SDK 组件。
3. 从 [Rust 官方安装页](https://rust-lang.org/tools/install/) 下载并运行 `rustup-init.exe`，选择默认的 stable MSVC 工具链。也可在 PowerShell 中运行：

   ```powershell
   winget install --id Rustlang.Rustup
   ```

4. 确保已安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)；已有运行时可跳过。
5. 安装完成后，重新打开终端；使用 IDE 内置终端时也应重启 IDE。检查以下命令都能显示版本号，再执行本地运行步骤：

   ```powershell
   node --version
   npm --version
   rustc --version
   cargo --version
   ```

如果出现 `cargo metadata ... program not found`，说明启动进程找不到 Cargo，请检查 Rust 是否安装、`%USERPROFILE%\.cargo\bin` 是否在 PATH 中，并重启终端或 IDE。详见 [Cargo 排障](docs/troubleshooting.md#找不到-cargo)。

### 获取源码与启动

```sh
git clone https://github.com/LiDe2000/QuotaPeek.git
cd QuotaPeek
npm ci
npm run tauri dev
```

`npm ci` 按仓库中的锁文件安装 JavaScript 依赖。首次启动会下载并编译 Rust 依赖，耗时取决于网络与电脑性能。

`npm run tauri dev` 启动完整桌面应用并支持前端热更新。`npm run dev` 仅启动浏览器界面，不能使用原生账户查询功能。修改 Rust、Tauri 配置或桌面权限后，应重新启动桌面开发进程。

### 测试与检查

在项目根目录运行：

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

真实 Codex 查询集成测试默认跳过，执行条件与命令见 [开发文档](docs/development.md#测试与检查)。窗口、托盘和账户授权等桌面行为还需在实际应用中检查。

### 构建可执行文件与安装包

仅生成 Windows 应用可执行文件：

```sh
npm run tauri:build:portable
```

默认输出为 `src-tauri/target/release/quotapeek.exe`。该文件可作为直接运行版本上传到 GitHub Releases。

构建桌面应用及安装包：

```sh
npm run tauri:build:installed
```

安装包输出到 `src-tauri/target/release/bundle/`。安装版命令启用 `installed` 编译特性及独立打包配置，生成 NSIS（`*-setup.exe`）和 MSI（`.msi`）；具体要求见 [Tauri Windows 打包文档](https://v2.tauri.app/distribute/windows-installer/)。打包阶段可能需要下载额外工具，失败时可参阅 [Windows 构建排障](docs/troubleshooting.md#windows-安装包构建失败)。安装版和便携版命令会生成不同数据路径策略的 exe，发布时请使用对应命令的产物。

### 数据保存与软件升级

账户信息、加密授权、额度缓存、主题和账户选择统一保存到 SQLite，JSON 查询结果直接存入数据库字段。数据库会自动执行版本升级，已有版本升级前先备份；不导入早期本机 JSON 和 localStorage。

| 版本 | 数据位置 |
| --- | --- |
| 便携版（默认） | exe 同级 `data/quotapeek.db` 和 `data/webview/` |
| 安装版 | `%LOCALAPPDATA%/com.lide.quotapeek/` 内的 `quotapeek.db` 和 `webview/` |

便携版升级只需替换 exe 并保留 `data/`。移动或手动备份前从托盘完全退出，然后复制整个目录。Windows 授权采用当前用户范围 DPAPI 加密，跨电脑或跨 Windows 用户使用时通常需要重新授权；账户、设置和额度缓存仍可保留。Codex 登录由本机 Codex 管理。详见 [数据存储设计与升级规则](docs/storage.md)。

### 开发文档

- [开发文档](docs/development.md)：代码结构、账户状态、窗口布局与测试。
- [排障文档](docs/troubleshooting.md)：Codex 连接、Windows 构建与桌面权限问题。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/LiDe2000/QuotaPeek/issues) 报告问题或提出建议，也欢迎提交 Pull Request。

报告问题时，请提供系统版本、应用版本、复现步骤和相关错误信息。请勿公开登录令牌、账户凭据或包含敏感信息的日志。

## 许可证

本项目采用 [MIT License](LICENSE)。
