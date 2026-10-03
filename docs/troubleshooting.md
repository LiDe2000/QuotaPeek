# 常见问题

[README](../README.md) · [开发文档](development.md) · [数据存储](storage.md)

## 找不到 Cargo

出现 `cargo metadata ... program not found` 时，在启动应用的同一终端检查：

```powershell
cargo --version
rustc --version
```

未安装时按 [环境要求](../README.zh-CN.md#环境要求) 安装 Rust/rustup。已安装时检查 `%USERPROFILE%\.cargo\bin` 或自定义工具链目录是否在 PATH 中，然后重开终端和 IDE。`npm ci` 不安装 Rust/Cargo；Windows 编译还需 MSVC 和 Windows SDK。

## 编辑器提示测试模块不存在

若 `#[path]` 报 `unresolved module`，但 Cargo 编译正常：

1. 从仓库根目录打开 VS Code，确认 `.vscode/settings.json` 存在。
2. 检查 `rust-analyzer.vfs.extraIncludes` 包含 `${workspaceFolder}/tests/rust`。
3. 执行 **rust-analyzer: Restart server**。
4. 运行 `npm run check`，确认实际类型检查与 Clippy 结果。

Rust 测试位于 Cargo 目录之外，需要共享索引配置。若 Cargo 也报告找不到模块，检查实现文件的 `#[path]` 相对路径。

## Tauri 配置提示缺少 identifier

主配置与补充配置均应保留本地 `$schema` 和 `identifier: "com.lide.quotapeek"`。编辑器单独校验各文件，不自动继承主配置字段。配置用途与合并规则见 [开发文档](development.md#tauri-配置)。

## 无法连接本机 Codex

原生查询需运行桌面应用；源码开发使用 `npm run tauri dev`，`npm run dev` 仅提供浏览器界面。请先安装 Codex 并使用 ChatGPT 账户登录，API Key 登录不提供订阅额度。

可执行文件发现顺序：

1. `QUOTAPEEK_CODEX_PATH` 指定的绝对路径。
2. `PATH` 中的原生可执行文件。
3. Windows `%LOCALAPPDATA%/OpenAI/Codex/bin` 及其直接版本子目录。

安装目录候选按可执行文件修改时间比较，忽略不完整目录。Windows 显式路径需指向 `codex.exe`，不能使用 `.cmd` 或 `.ps1` 包装脚本；显式路径无效时直接报错。修改环境变量后重启 QuotaPeek。

应用沿用 `CODEX_HOME`，未设置时使用用户目录 `.codex`。登录或网络错误时先检查 Codex 登录和代理，再刷新；查询最多等待 45 秒，失败保留上次结果。

## 账户过期或数据无法写入

| 情况 | 处理 |
| --- | --- |
| 授权过期，或复制数据后凭据无法解密 | 在连接面板重新授权对应账户 |
| 便携目录不可写 | 完全退出后，将 exe 和 `data/` 移到可写目录 |
| 数据库由更高版本创建 | 使用相同或更新版本应用，不手动降级数据库 |
| 升级备份校验失败 | 完全退出，备份整个数据目录，保留原库与备份供排查 |

路径和凭据保护规则见 [数据存储](storage.md)。

## Windows 安装包构建失败

先区分 Rust 编译失败与安装包打包失败。NSIS/MSI 打包可能需要下载额外工具；WiX 下载失败或 `Peer disconnected` 时检查网络和代理，恢复后重试：

```powershell
npm run tauri:build:installed
```

只需要便携 exe 时运行：

```powershell
npm run tauri:build:portable
.\src-tauri\target\release\quotapeek.exe
```

便携命令不生成安装向导、快捷方式或卸载入口。两种构建使用不同数据策略，发布时不要混用 exe。

## 窗口尺寸不更新或卡片被裁剪

检查控制台错误、`tauri.conf.json` 最小尺寸，以及 `src-tauri/capabilities/default.json` 的窗口权限：

```text
core:window:allow-set-size
core:window:allow-set-position
```

修改权限或原生配置后重启桌面进程。确认自然内容高度、CSS 限高和原生尺寸分别正确；不要将已裁剪的高度用作自然高度。实现规则见 [窗口布局](development.md#窗口布局)。

## Windows 整窗短暂消失或闪帧

默认稳定原生视口保留 GPU 和左右展开，以可见区域裁剪适配内容。复测前从托盘 **Quit** 退出旧实例，并停止旧 Vite/Tauri 进程；保持相同显示器、缩放和操作顺序。

| 命令 | 对照内容 |
| --- | --- |
| `npm run tauri:diagnose` | 默认稳定视口 |
| `npm run tauri:diagnose -- --resize` | 原生高度随内容变化 |
| `npm run tauri:diagnose -- --fixed` | 固定 474 × 800，停用自动几何更新 |
| `npm run tauri:diagnose -- --redirection` | 关闭 `noRedirectionBitmap` |
| `npm run tauri:diagnose -- --opaque` | 关闭透明窗口 |
| `npm run tauri:diagnose -- --software` | 关闭 GPU，使用软件渲染 |

`--stable`、`--resize`、`--fixed` 互斥；其他参数可组合。追加 `--print-config` 只输出配置。脚本不修改正式配置，比较前检查已有 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境覆盖。

固定视口仅供诊断，未使用的透明区域也拦截鼠标，且停用贴边自适应。几何诊断覆盖仅在开发模式生效。

软件渲染可单独启动或构建：

```sh
npm run tauri:software
npm run tauri:build:software -- --no-bundle
```

构建会覆盖 release exe；恢复默认渲染使用 `npm run tauri:build:portable`。软件渲染可能增加 CPU 占用。记录 WebView2、系统、显卡驱动版本、显示器缩放和录屏；单元测试不能确认最终原生呈现。

## 退出时出现 Error 1412

```text
Failed to unregister class Chrome_WidgetWin_0. Error = 1412
```

Windows [错误码 1412](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-) 表示注销窗口类时仍有该类窗口存在。此 WebView2 日志也可能出现在正常退出时，见 [Tauri 维护者答复](https://github.com/orgs/tauri-apps/discussions/8503)。

若仅在退出时出现，且进程与托盘正常消失，可保留现有退出流程。若同时出现 panic、异常退出码、运行中闪退或进程残留，保留前后日志继续排查。

## 报告问题

提交 [Issue](https://github.com/LiDe2000/QuotaPeek/issues) 时附上系统与应用版本、启动命令、涉及供应商、复现步骤、截图和相关错误。公开前移除登录令牌、授权链接、凭据及敏感日志。
