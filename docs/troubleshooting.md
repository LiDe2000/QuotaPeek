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

## 报告问题

提交 Issue 时，请附上系统版本、应用版本、涉及的供应商、复现步骤和截图；开发环境的问题也可附上相关错误输出。

不要在公开 Issue 中附带登录令牌、授权链接、账户凭据文件或未经检查的完整日志。
