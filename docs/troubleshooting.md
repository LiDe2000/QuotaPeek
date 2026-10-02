# 排障文档

[返回 README](../README.md) · [开发文档](development.md)

## 无法连接本机 Codex

### 运行环境

本机额度查询需要通过桌面应用运行。`npm run dev` 只启动浏览器界面，不能使用原生查询功能；开发时应运行 `npm run tauri dev`。

QuotaPeek 不捆绑 Codex。请先安装 Codex，并使用 ChatGPT 账户登录。API key 登录不提供订阅额度。

### 可执行文件发现

QuotaPeek 按以下顺序寻找原生 Codex 可执行文件：

1. `QUOTAPEEK_CODEX_PATH` 指定的路径。
2. `PATH` 中的原生可执行文件。
3. Windows 的 `%LOCALAPPDATA%/OpenAI/Codex/bin`，包括其直接版本子目录。

如果版本子目录存在多个可执行文件，使用可执行文件修改时间较新的项；不完整的目录会被忽略。

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

2026-10-02：用户对照反馈，停用原生几何更新的 `--fixed` 模式暂未闪烁；恢复左右自适应、保持原生宽高稳定的 `--stable` 模式也暂未闪烁。Windows 默认开发和正式构建现已采用稳定视口，保持 GPU 渲染，只让可见裁剪区域随内容改变。进一步分析与复测入口见 [Windows 闪烁排查记录](windows-rendering-investigation.md)。现有结果支持原生高度变化是主要触发条件，不代表已确认某个底层驱动缺陷或所有设备均无闪烁。

整窗（包括侧栏）一起短暂消失与卡片内容过渡不同，需要检查 WebView2、透明窗口合成和原生尺寸更新。普通动画不能保证解决这类问题。

更新后先完全退出旧进程，使用普通 `npm run tauri dev` 或重新构建的 exe 验证。仍有闪烁时，可以对照软件渲染模式：

```powershell
npm run tauri:software
```

该命令仅为这一次开发启动传入 `--disable-gpu`，不修改系统设置、账户数据或正式构建配置。窗口仍按内容自适应。对照运行 `npm run tauri dev` 时会恢复默认渲染。两个模式不要同时运行，以免共用 WebView2 数据目录的进程沿用旧参数。

需要同样参数的 exe 时运行 `npm run tauri:build:software -- --no-bundle`，输出为 `src-tauri/target/release/quotapeek.exe`。普通构建不会继承软件开发模式的参数。此入口保留作兼容性回退；默认稳定视口方案无需关闭 GPU。

如果只有软件渲染模式不闪，可进一步定位 GPU/DirectComposition 呈现路径；如果仍闪，应继续检查原生窗口和 WebView 尺寸更新的衔接。软件渲染可能增加 CPU 占用。这是诊断入口，不代表已经确认根因或完成修复；浏览器参数不作为正式发行版的长期保证。

### 2026-10-01 排查记录

- 现象：开发模式下鼠标移入应用、悬停预览及切换账户/供应商时出现极短闪帧。
- 录屏证据：24 fps 视频约 1.458 秒，ZCode 切换到 Codex 时整窗（包括侧栏）消失，露出桌面；约 1.500 秒恢复但底部短暂裁剪，约 1.542 秒完整恢复。录屏采样不足以排除更短的其他闪帧。
- 前端调整：窗口拟合按已请求尺寸去重，观察器增量维护，尺寸未变化时跳过原生位置查询；展开面板内边距固定，避免视口变化引起二次拟合；卡片内容增加短暂过渡，背景保持连续；供应商圆环移除与预览重叠的原生 tooltip。
- 原生调整：Rust Tauri 升级至 2.12.0，CLI/API 同步至 2.12.1，启用 `noRedirectionBitmap`。用户后续录屏仍有整窗闪帧，因此这一组合未单独解决问题。
- 对照结果：加入 `tauri:software` 开发入口后，用户反馈“现在好像不闪了”。软件渲染在当前设备上暂时有效，支持进一步怀疑 GPU/DirectComposition 呈现路径，但尚未确认具体驱动、WebView2 或窗口更新环节的根因。
- 检查：前端构建、38 项前端测试、31 项 Rust 测试通过（1 项需要真实 Codex 登录的集成测试跳过）；软件渲染配置通过 Rust 编译检查。
- 当前状态：保留软件渲染作为开发排查/临时规避入口；普通 `npm run tauri dev` 和正式构建仍使用默认渲染，不宣称默认模式已修复。暂不继续改动，后续复现时再比较两个模式。

再次排查时记录实际启动命令、是否完全退出旧进程、WebView2/系统/显卡驱动版本、显示器缩放，以及是整窗消失还是只有卡片内容闪动。优先附原始录屏，条件允许时使用 60 fps 或更高帧率。

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
