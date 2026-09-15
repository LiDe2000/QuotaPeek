# QuotaPeek

All your AI limits at a glance.

React + TypeScript + Vite 界面，Tauri 2 + Rust 桌面后端。

## 本地运行与构建（Windows）

安装 Node.js、Rust 和 Tauri 所需的 Windows 开发依赖后，在项目根目录首次执行 `npm install`。

开发时运行桌面应用，修改代码后会自动更新：

```powershell
npm run tauri dev
```

只需要自己运行程序时，构建可执行文件并跳过安装包制作：

```powershell
npm run tauri -- build --no-bundle
.\src-tauri\target\release\quotapeek.exe
```

可执行文件位于 `src-tauri/target/release/quotapeek.exe`。它包含应用界面，但不会创建安装向导、快捷方式或卸载入口。

需要安装包时运行 `npm run tauri -- build`。当前配置的 `bundle.targets` 为 `all`，Windows 会尝试制作 MSI，并可能首次下载 WiX。如果遇到 `wix314-binaries.zip` 下载时的 `Peer disconnected`，失败的是安装包制作；先检查上述可执行文件，或用 `--no-bundle` 重新构建。首次编译 Rust 依赖通常较慢，后续构建会复用已编译的依赖。

## Codex 真实额度查询

1. 本机安装 Codex，并使用 ChatGPT 账户登录。API key 登录不支持订阅额度查询。
2. Windows 会自动查找本机 Codex 桌面应用的安装目录，也支持 PATH 中的原生可执行文件。
3. 点击用户图标 → OpenAI Codex → Connect local Codex。
4. 点击刷新按钮重新查询；页脚显示最近成功查询时间。

查询通过官方 Codex app-server 的 stdio JSON-RPC 协议完成：`initialize` → `initialized` → `account/read` → `account/rateLimits/read` → `account/read`。不启动模型任务，不消耗重置券，也不读取或复制登录令牌。Codex 自行管理原有登录状态及其本地状态文件。

官方协议参考：https://developers.openai.com/codex/app-server

### 当前边界

- 当前连接跟随本机 Codex 登录，一次支持一个本地账户。`id: codex-local` 是连接标识，`accountId` 是后端提供的可选平台账户标识，两者用途不同。
- 切换本机登录后刷新，会整体替换账户和额度；不会把新额度归到旧邮箱。
- 优先使用 `rateLimitsByLimitId`，缺失或为空时回退到 `rateLimits`。保留 Codex 的多个额度分组、可选主次窗口、窗口时长、重置时间、余额及消费限制字段。
- 缺少窗口不生成 0% 假数据；没有重置时间则明确显示未知。倒计时只在前端计算，到期后需要刷新确认，不自动将额度设为 100%。
- 查询失败保留上次成功结果并标记 Stale data；查询超时为 45 秒，同一时间只允许一个请求，结束或超时会清理子进程。
- 账户和额度暂存内存，重启后需重新连接。自动刷新、多账户独立认证、持久化和 Claude 查询尚未接入。
- 本实现依赖本机 Codex 可执行文件。发布 ZIP 暂未捆绑 Codex；单纯运行 `npm run dev` 的浏览器页面无法访问本机查询功能。
- 已在 Windows 验证；macOS 的代码路径尚需实机测试。

### 找不到 Codex 时

查找顺序为：`QUOTAPEEK_CODEX_PATH` → PATH → Windows 的 `%LOCALAPPDATA%/OpenAI/Codex/bin`（包括其版本子目录）。版本目录按可执行文件修改时间选择最新项，忽略不完整目录；无需把版本路径写入系统环境变量。若显式配置的路径无效，会提示修正而不自动切换到另一安装。

可以设置 `QUOTAPEEK_CODEX_PATH` 为 Codex 原生可执行文件的绝对路径，然后重新启动应用。Windows 使用 `codex.exe`，不要指向 npm 的 `.cmd` / `.ps1` 包装脚本。macOS 从 Finder 启动时 PATH 可能不同，也可以使用此设置。

应用遵循已有 `CODEX_HOME`；未设置时使用用户主目录下的 `.codex`。网络或代理问题、失效登录需要在 Codex 中修复后重试。QuotaPeek 不把上游原始错误或凭据写入界面和日志。

## 代码结构

```text
src/
  types/quota.ts                       # 供应商判别联合类型 Account
  types/codex.ts                       # Codex 专属账户、额度分组及窗口
  services/codex.ts                    # query_codex_quota 的 invoke 封装
  hooks/useAccounts.ts                 # 连接、刷新、错误、账户切换状态
  hooks/useAppearance.ts               # 主题状态与 localStorage 持久化
  components/AccountCard.tsx           # 根据 providerId 分派卡片
  components/providers/CodexAccountCard.tsx
  components/providers/CodexAccountCard.css
  components/AddAccount.tsx            # 本地账户连接入口
  components/AppearanceSettings.tsx    # 主题设置
  styles/                             # 通用变量、三套主题和全局样式
  App.tsx                             # 页面、轮播、设置和刷新入口
src-tauri/src/
  lib.rs                              # 注册 Tauri 命令及查询互斥状态
  codex.rs                            # Codex 协议、类型、进程生命周期及测试
tests/codex-card.test.cjs              # 实际卡片的渲染与额度语义测试
```

每个供应商使用独立数据类型和卡片。新增供应商时扩展 `Account` 联合类型及 `providerId` 分派，并新增专属 service、Rust provider 和卡片布局；无需为每个供应商定义五小时或每周窗口。

## 窗口布局约定

窗口外壳 `.quota-window` 高度固定、永不滚动，圆角与边框因此始终完整；`.window-body` 是唯一的滚动区。外壳通过 `--window-padding`（内边距）和 `--panel-top`（浮层上边界）向组件暴露定位基准，两者都在 `.quota-window` 上定义。

`AddAccount` 与 `AppearanceSettings` 是绝对定位浮层，共用 `global.css` 里的 `.panel` 基类，不参与文档流，因此不会把卡片挤下去。两个面板共用同一条 `--panel-top` 上边界，并各自左右留出 `--window-padding`，所以落点和宽度完全一致——不做靠边停靠的窄浮层。按下面板与工具栏以外的任意位置即关闭。

窗口高度等于「内容 + 外壳开销 + 外壳外留白」。`useFittedWindowHeight` 测量 `.window-body` 的子元素高度，以及打开中的面板所占的纵向跨度，取两者较大值，加上外壳开销（header、footer、内边距）后交给 `lib/windowHeight.ts` 的 `fittedWindowHeight` 换算，再用 `setSize` 应用。测量必须取子元素而不是 `.window-body` 自身——flex 会把 body 拉伸到窗口高度，测它会让效果追自己的尾巴；面板是绝对定位的，所以要把它的 offsetTop 从 body 的 offsetTop 里扣掉，并且读 scrollHeight 以免被窗口自身的限高回灌。结果下限就是外壳开销本身，即没有卡片也没有面板时窗口只剩头和尾；上限为屏幕可用高度减 80px（超出时回落到 `.window-body` 的内滚），并带 4px 余量与 2px 死区来吸收取整误差、避免抖动。

`tauri.conf.json` 里的 `height` 只是初始值，取空窗口的高度以免启动时先高后缩；`minHeight` 必须放开到最小高度，否则窗口无法收缩。当前实测（380px 宽窗口、单账户 Codex）：内容约 486px（卡片 + 40px 翻页行），外壳开销约 105px（header、footer、内边距），外壳外留白 24px（`.app-shell` 的 `--space-section` 下边距），拟合高度约 619px 且不滚动；空窗口约 133px。

自适应依赖 `getCurrentWindow().setSize()`，而 Tauri 2 的 ACL 默认不放行这条命令：`src-tauri/capabilities/default.json` 必须显式包含 `core:window:allow-set-size`。缺它不会在任何界面上报错，只会静默拒绝，窗口就停在初始高度不变——加卡片、开面板都不会长高。`setSize` 的失败在 hook 里 `console.warn` 出来，便于下次一眼定位。capability 与 `tauri.conf.json` 都参与 Rust 端编译，改完必须重启 `npm run tauri dev`（会重新编译），前端热更新不生效。

## 验证

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

真实集成测试会启动本机 Codex 并访问额度服务，需要已登录且网络可用；默认测试跳过此项：

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_codex_query -- --ignored --nocapture
```
