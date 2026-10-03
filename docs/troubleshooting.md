# 排障文档

[返回 README](../README.md) · [开发文档](development.md)

## 找不到 Cargo

运行 `npm run tauri dev` 或构建时，如果出现：

```text
failed to run 'cargo metadata' command
program not found
```

说明当前启动进程找不到 `cargo`。Tauri 需要 Rust 工具链，`npm install` 不会安装它。

先在同一个终端检查：

```powershell
cargo --version
rustc --version
```

未安装 Rust 时，按 [README 的 Windows 首次配置](../README.md#windows-首次配置) 安装。已安装时，检查 `%USERPROFILE%\.cargo\bin` 是否在 PATH 中；使用自定义安装目录时检查对应的 `bin` 目录。安装或修改 PATH 后，重新打开终端，并重启启动开发命令的 IDE，让新进程获取环境变量。

两个命令都能显示版本号后，重新运行 `npm run tauri dev`。这只确认 Rust 命令可用；Windows 编译仍需要 MSVC Build Tools 和 Windows SDK，完整要求见 [Tauri 官方前置依赖](https://v2.tauri.app/start/prerequisites/)。

## 无法连接本机 Codex

### 运行环境

本机额度查询需要通过桌面应用运行。`npm run dev` 只启动浏览器界面，不能使用原生查询功能；开发时应运行 `npm run tauri dev`。

QuotaPeek 不捆绑 Codex。请先安装 Codex，并使用 ChatGPT 账户登录。API key 登录不提供订阅额度。

### 可执行文件发现

QuotaPeek 按以下顺序寻找原生 Codex 可执行文件：

1. `QUOTAPEEK_CODEX_PATH` 指定的路径。
2. `PATH` 中的原生可执行文件。
3. Windows 的 `%LOCALAPPDATA%/OpenAI/Codex/bin`，包括其直接版本子目录。

安装目录根部和版本子目录中的可执行文件一起比较，使用可执行文件修改时间较新的项；不完整的目录会被忽略。这样更新 Codex 后残留的旧版 `bin/codex.exe` 不会覆盖新版。

需要手动指定时，将 `QUOTAPEEK_CODEX_PATH` 设置为原生可执行文件的绝对路径，并重启 QuotaPeek。Windows 应指向 `codex.exe`，不能指向 npm 的 `.cmd` 或 `.ps1` 包装脚本。显式路径无效时，应用会报错，不会自动改用其他安装。

应用沿用已有的 `CODEX_HOME`；未设置时使用用户主目录中的 `.codex`。macOS 的图形启动环境可能使用不同的 PATH，也可使用显式路径设置；该平台仍需实机验证。

### 登录或网络错误

先在 Codex 中确认登录有效，并检查网络或代理连接，再回到 QuotaPeek 刷新。单次查询最多等待 45 秒。失败时卡片保留上次数据，上次成功时间不会被失败时间覆盖。

## Windows 安装包构建失败

构建安装包与生成应用可执行文件是两个步骤。当前打包目标为 `all`，Windows 打包可能需要下载 WiX 等工具。出现 `wix314-binaries.zip` 下载失败或 `Peer disconnected` 时，应先确认失败发生在打包阶段。

如果只需要本地运行，可跳过安装包：

```powershell
npm run tauri -- build --no-bundle
.src-tauri	arget
eleasequotapeek.exe
```

该可执行文件包含界面，但不会创建安装向导、快捷方式或卸载入口。

需要安装包时，解决相关工具的下载问题后重新运行 `npm run tauri -- build`。首次 Rust 编译耗时较长，后续构建会复用已编译依赖。

## 窗口尺寸不更新或卡片被裁剪

首先检查开发控制台是否出现 `Window fit was refused`。原生尺寸和位置调整依赖以下权限：

```text
core:window:allow-set-size
core:window:allow-set-position
```

确认这些权限位于 `src-tauri/capabilities/default.json`，并检查 `tauri.conf.json` 的最小尺寸是否妨碍窗口收缩。

修改权限或 Tauri 配置后，重启桌面开发进程；仅刷新前端页面不能应用这些配置。继续检查时，应区分自然内容高度、CSS 限高和原生窗口尺寸，避免使用已经裁剪的高度作为内容高度。

具体测量与滚动机制见 [开发文档中的窗口布局](development.md#窗口布局)。

## Windows 整窗短暂消失或闪帧

Windows 默认使用稳定的原生视口，保留 GPU 渲染和左右自适应，只让可见裁剪区域随内容改变。此前在当前设备上的对照支持原生高度变化是闪帧的重要触发条件；跨显示器、DPI 变化和其他设备仍需实际验证。

复测前，从托盘 **Quit** 完全退出旧实例，并停止之前的 Vite/Tauri 开发进程。普通关闭只隐藏窗口。每次保持相同显示器、缩放和操作顺序，避免多个实例共用 WebView2 数据目录。

使用以下开发入口比较渲染方式：

| 命令 | 对照内容 |
| --- | --- |
| `npm run tauri:diagnose` | 当前默认稳定视口，保留 GPU 和左右自适应 |
| `npm run tauri:diagnose -- --resize` | 恢复原生高度随内容变化，检查尺寸变化的影响 |
| `npm run tauri:diagnose -- --fixed` | 固定 474 × 800 视口，停用自动尺寸、位置和裁剪更新 |
| `npm run tauri:diagnose -- --redirection` | 关闭 `noRedirectionBitmap`，比较窗口呈现方式 |
| `npm run tauri:diagnose -- --opaque` | 关闭透明窗口 |
| `npm run tauri:diagnose -- --software` | 关闭 GPU，比较软件渲染 |

`--stable` 显式选择默认方案，与 `--fixed`、`--resize` 互斥。其他参数可组合，例如 `--fixed --software`。添加 `--print-config` 可只检查配置而不启动应用。脚本读取主配置生成临时覆盖，不修改正式配置或系统设置；已有 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境覆盖仍会生效，比较前应检查它。

固定视口仅供诊断：未使用的透明区域也拦截鼠标，贴边自适应停用。几何诊断覆盖仅在开发模式有效，正式构建保持默认稳定视口。

软件渲染也可通过 `npm run tauri:software` 启动。需要同样参数的便携 exe 时运行 `npm run tauri:build:software -- --no-bundle`，输出为 `src-tauri/target/release/quotapeek.exe`；重新运行 `npm run tauri:build:portable` 会覆盖为默认渲染版本。软件渲染可能增加 CPU 占用，保留作兼容性回退。

再次排查时记录启动命令、是否完全退出旧进程、WebView2/系统/显卡驱动版本、显示器缩放，以及是整窗消失还是只有卡片内容闪动。条件允许时附上 60 fps 或更高帧率的原始录屏。单元测试不能确认 Windows 最终呈现，也不能仅凭某组对照就归责于具体驱动。

## 退出时出现 Chrome_WidgetWin_0 / Error 1412

开发模式退出时可能出现：

```text
Failed to unregister class Chrome_WidgetWin_0. Error = 1412
```

该日志来自 Chromium/WebView2。Windows 的 `1412` 是 `ERROR_CLASS_HAS_WINDOWS`，表示注销窗口类时仍有该类窗口存在。仅凭这一行不能判定应用崩溃或退出失败。[微软错误码说明](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1300-1699-)

托盘 `Quit` 使用 Tauri 的 `AppHandle::exit(0)`，由框架触发退出和清理；普通窗口关闭则隐藏到托盘，两者不同。Tauri 维护者说明，同类窗口类注销日志也可能出现在正常退出时，逐个关闭窗口也不保证消除。[Tauri 维护者答复](https://github.com/orgs/tauri-apps/discussions/8503)

如果日志只在主动退出时出现，且应用进程和托盘图标正常消失，可先保留现有退出流程。如果伴随 Rust panic、异常退出码、应用运行期间闪退，或退出后进程一直残留，应保留完整前后日志继续排查；不要仅通过屏蔽 WebView2 日志判断修复成功。

## 报告问题

提交 Issue 时，请附上系统版本、应用版本、涉及的供应商、复现步骤和截图；开发环境的问题也可附上相关错误输出。

不要在公开 Issue 中附带登录令牌、授权链接、账户凭据文件或未经检查的完整日志。
