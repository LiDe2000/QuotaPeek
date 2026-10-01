<p align="center">
  <img src="public/quotapeek.svg" width="80" alt="QuotaPeek" />
</p>

<h1 align="center">QuotaPeek</h1>

<p align="center">All your AI limits at a glance.</p>
<p align="center">在桌面上快速查看 AI 服务的额度、余额与重置时间。</p>

## 简介

QuotaPeek 是一款基于 Tauri 的桌面额度查看工具，将多个 AI 服务集中在紧凑的悬浮侧栏中。悬停即可预览额度，单击即可刷新，无需反复打开各个平台的账户页面。

目前主要面向 Windows；其他平台尚未完成实机验证。

## 功能

- **集中查看**：支持 Codex、WorkBuddy 和 ZCode 的额度或余额查询。
- **多账户切换**：按供应商分组，在同一张卡片中切换账户，并记住各供应商的选择。
- **快速预览**：悬停供应商图标查看缓存数据，单击刷新当前账户。
- **状态反馈**：显示查询进度、最后更新时间和失败信息；查询失败时保留上次结果。
- **启动恢复**：恢复已连接账户，并自动查询一次额度。
- **自适应卡片**：窗口随内容调整高度，超出上限后在卡片内滚动；靠近屏幕左右边缘时调整展开方向。
- **外观主题**：提供 Original、Midnight 和 Pearl 三种主题。

## 支持的服务

| 服务 | 查询内容 | 账户连接 |
| --- | --- | --- |
| OpenAI Codex | 多个额度窗口的剩余比例、重置时间 | 使用本机 Codex 的 ChatGPT 登录状态，目前支持一个本地账户 |
| WorkBuddy | Credits 余额、使用比例、套餐明细与到期时间 | 浏览器授权，支持多个账户 |
| ZCode | 额度余额、使用比例与额度明细 | 浏览器授权，支持 Z.ai 和 BigModel 多个账户 |

连接 Codex 前，需要在本机安装 Codex 并使用 ChatGPT 账户登录。API key 登录不支持订阅额度查询。

## 快速开始

### 环境要求

- Node.js 22.12 或更高版本，以及 npm。
- Rust 工具链。
- [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 Microsoft C++ Build Tools 和 WebView2。

### 本地运行

```sh
git clone https://github.com/LiDe2000/QuotaPeek.git
cd QuotaPeek
npm install
npm run tauri dev
```

### 构建

构建桌面应用及安装包：

```sh
npm run tauri -- build
```

只构建可执行文件：

```sh
npm run tauri -- build --no-bundle
```

Windows 可执行文件位于 `src-tauri/target/release/quotapeek.exe`，安装包位于 `src-tauri/target/release/bundle/`。

## 使用

1. 点击侧栏的 **＋**，选择服务并连接账户。
2. **悬停供应商图标**预览当前账户，**单击图标**刷新其额度。
3. 同一供应商连接多个账户后，主面板通过左右按钮切换，悬浮预览通过右下角的数字按钮切换。
4. 点击 **QuotaPeek 主图标**打开或收起主面板，在面板中切换供应商、连接账户或调整主题。
5. 主面板顶部的刷新按钮用于刷新全部已连接账户。

账户连接信息、额度缓存和界面偏好保存在本机。

## 开发与贡献

项目使用 React、TypeScript 和 Vite 构建界面，使用 Tauri 2 和 Rust 实现桌面功能与服务查询。

欢迎通过 [Issues](https://github.com/LiDe2000/QuotaPeek/issues) 报告问题或提出建议，也欢迎提交 Pull Request。

- [开发文档](docs/development.md)：代码结构、账户状态、窗口布局与测试。
- [排障文档](docs/troubleshooting.md)：Codex 连接、Windows 构建与桌面权限问题。

## 许可证

本项目采用 [MIT License](LICENSE)。
