# 开发文档

[返回 README](../README.md)

本文说明项目的代码组织和实现约定。安装与基本使用请参阅 README。

## 技术栈与代码结构

- 前端：React、TypeScript、Vite。
- 桌面：Tauri 2、Rust。
- 测试：Node.js 测试运行器、Rust 单元测试。

```text
src/
  components/       # 侧栏、连接面板、主题设置与供应商卡片
    providers/      # Codex、WorkBuddy、ZCode 的专属卡片
  hooks/            # 账户状态、悬停预览、主题与窗口尺寸
  lib/              # 账户合并、供应商分组、额度圆环与窗口定位
  services/         # Tauri 查询与登录命令的前端封装
  styles/           # 设计变量、主题与全局样式
  types/            # Account 联合类型与各供应商数据类型
  App.tsx           # 面板、供应商与账户切换的组合入口
src-tauri/src/
  lib.rs            # Tauri 命令与共享状态注册
  account_store.rs  # 多账户连接信息的持久化
  codex.rs           # Codex 协议与查询进程管理
  codex_executable.rs # 本机 Codex 可执行文件发现
  workbuddy.rs      # WorkBuddy 授权、账户与额度查询
  zcode.rs          # ZCode 授权、账户与额度查询
tests/              # 前端数据逻辑与卡片渲染测试
```

## 账户与查询状态

`Account` 使用 `providerId` 区分供应商，额度字段保留在各供应商的类型中。每种服务使用自己的卡片，避免把不同服务强行解释成相同的五小时或每周窗口。

账户按稳定 ID 更新，刷新不会改变账户顺序。侧栏每个供应商只有一个图标，该图标的额度和刷新操作对应供应商当前选中的账户。主面板可切换供应商，同一供应商的多个账户在卡片中切换；各供应商的选择独立保存。

`useAccounts` 按账户记录查询进度、错误和最后成功时间，同一账户的并发查询复用已有请求。启动时恢复账户并查询一次额度；悬停只展示缓存数据。手动刷新在请求结束后有 10 秒冷却期，全部刷新逐个处理账户并汇总结果。

失败时保留上次查询数据，并显示错误及上次成功时间。未知额度不生成虚假的 0% 或 100%；重置时间到期也不直接修改额度，需要再次查询确认。

Codex 使用本机已有登录状态，目前只有一个本地连接；WorkBuddy 和 ZCode 的授权信息按账户独立保存。浏览器登录轮询在上一次请求结束后再安排下一次，隐藏面板不会取消登录；取消登录使用独立操作。

## 窗口布局

### 内容布局与滚动

- `.app-shell` 使用固定的 `--window-inset` 留白。
- `.window-body` 横向排列侧栏和当前展开的卡片。
- `.orb-pop` 承载主面板；`.orb-float` 承载悬停预览。
- 连接和主题面板参与正常文档流，保留主面板的标题栏和工具栏。
- 只有当前选中的账户卡片参与高度计算，隐藏卡片不撑高窗口。
- 主面板和悬停预览超过限高时各自在内部滚动；文档根节点不滚动。

布局不依赖窗口当前高度撑开内容，避免尺寸测量被已经裁剪的窗口反向限制。

### 原生窗口尺寸

`useFittedWindowHeight` 观察内容尺寸与 DOM 变化，将可见区域调整到内容需要的宽高。Windows 将原生视口与可见区域分开，其他平台直接拟合原生尺寸。测量使用可见子元素的自然高度及边框、偏移、外层留白；内容高度通过 `scrollHeight` 获取。

最大高度为当前显示器工作区高度减去 80 个逻辑像素。`fittedWindowHeight` 保留 4 像素余量和 2 像素误差容忍，减少取整造成的重复调整。`--window-max-height` 同步提供给 CSS，原生窗口和内部滚动区使用同一个上限。

`horizontalPlacement` 保持侧栏的屏幕位置：右侧空间不足时向左展开，左侧则向右展开。计算使用当前显示器工作区及缩放比例，支持显示器原点为负坐标的情况。当前不根据底部空间自动调整纵向位置。

原生窗口使用物理坐标定位和调整尺寸：`physicalHorizontalPlacement` 只按窗口当前 DPI 转换 CSS 宽度，工作区与窗口原点保持物理坐标。监听 DPI 变化重新拟合；热更新时沿用 DOM 已记录的展开方向。相关回归覆盖 200%/125% 缩放、负坐标和实际 hook 连续展开/收起。

Windows 默认预留稳定的原生视口：宽度由 `--main-panel-width`、侧栏、间距和留白计算，高度预留至工作区高度减去 80 个逻辑像素。同一显示器与 DPI 下，展开、收起和切换卡片只更新可见区域，不反复改变 WebView2 的原生表面尺寸。向左展开时，内容对齐视口右边缘。`window_bounds.rs` 的 `fit_window_bounds` 在 UI 线程统一处理物理边界和可见区域，`visibleHeight` 与原生 `height` 分开；原生窗口区域裁掉未使用的视口，空白区域不绘制、不拦截鼠标。可见高度继续随内容自适应，跨显示器或 DPI 变化时重新拟合。非 Windows 平台沿用内容宽高拟合。

开发和正式构建都使用稳定视口，保留 GPU 渲染与左右自适应。排查回归时使用 `npm run tauri:diagnose -- --resize` 恢复旧的原生高度拟合；`--fixed` 则停用全部自动几何更新，仅供隔离实验。诊断覆盖仅在开发模式有效，不能通过环境变量将旧模式带入正式构建。

窗口尺寸与位置调整通过同一条串行路径处理，避免旧请求覆盖新尺寸。原生尺寸命令可能早于 WebView 的 resize 通知完成，因此后续拟合按已请求尺寸去重，不重复使用旧视口尺寸；内容未改变尺寸时不查询原生窗口位置。观察器增量维护已有节点，避免文字更新触发全部节点的初始尺寸通知。

主面板和预览采用固定内容宽度，内边距不随原生视口宽度改变，避免展开后再次改变内容高度。账户切换的短暂过渡只作用于卡片内部内容，卡片底色保持连续；减少动态效果的系统偏好会关闭该过渡。`tauri.conf.json` 的初始宽高只用于启动，不能将最小高度设置到妨碍收缩的值。

Windows 的 `window_drag.rs` 观察系统拖动循环的开始和结束。拖动期间自动拟合暂停，保持鼠标抓取点和展开方向；松开后再拟合。异步读取位置使用版本检查，原生提交还核对请求来源位置并拒绝拖动中的调整，避免旧请求把窗口拉回。`startDragging()` Promise 完成只代表请求已入队，不能用来判断鼠标松开。

### 托盘与窗口生命周期

`src-tauri/src/tray.rs` 负责托盘图标、原生菜单和动作分发；`desktop_window.rs` 提供可复用的显示/隐藏入口。前端通过 `desktop-show-main` 事件打开主面板，Rust 端不直接操作前端 DOM。增加托盘菜单项时，在 `tray.rs` 添加菜单和对应动作；其他入口也可复用窗口操作。

托盘右键菜单的 `Always on Top` 是可勾选开关，控制主窗口是否始终显示在其他普通窗口前面。启动时默认关闭；隐藏后重新显示和展开/收起保留当前置顶状态，重启后恢复默认。菜单勾选状态与原生窗口状态同步，设置失败会恢复原勾选状态。

主窗口不占任务栏，关闭请求只隐藏窗口，托盘菜单的 `Quit` 通过 `app.exit(0)` 退出。托盘随进程驻留，前端热更新不会重复创建图标。普通配置与软件渲染配置保持相同的任务栏行为。Windows 可以把新图标收进通知区域的折叠菜单，具体是否常显由系统设置控制。

### 桌面权限

Windows 透明窗口启用 `noRedirectionBitmap`。Tauri 文档说明它可避免透明窗口创建、WebView 内容尚未绘制时的白闪；它不保证展开和尺寸变化时不闪，此前单独启用后当前设备仍有整窗闪帧，随后稳定视口对照得到改善。此选项需要 Tauri 2.12 及对应 CLI；修改后必须重启开发应用，前端热更新无法改变原生窗口创建参数。进一步定位使用 [Windows 渲染对照入口](windows-rendering-investigation.md)。

`src-tauri/capabilities/default.json` 显式声明窗口调整权限：

```text
core:window:allow-set-size
core:window:allow-set-position
```

修改 capability 或 Tauri 配置后，需要重启 `npm run tauri dev`。这些修改不会通过前端热更新生效。权限和尺寸调整的排查见 [排障文档](troubleshooting.md)。

## Codex 查询

查询使用本机 Codex app-server 的 stdio JSON-RPC 协议：

```text
initialize → initialized → account/read → account/rateLimits/read → account/read
```

前后读取账户身份用于防止登录切换过程中将额度归到错误账户。额度优先读取 `rateLimitsByLimitId`，没有可用分组时回退到 `rateLimits`。圆环展示各额度窗口中最小的剩余比例。

查询不启动模型任务，也不读取或复制 Codex 登录令牌。Codex 管理自身登录状态与本地状态文件。查询超时为 45 秒，结束或超时后清理子进程。

## DeepSeek 余额查询

默认连接流程在 `src-tauri/src/deepseek_login.rs` 中实现，参考 [Harness 官方账户授权实现](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/credentials/deepseek-account-platform)。浏览器授权使用 S256 PKCE、随机 state 和仅绑定 `127.0.0.1` 的临时端口回调。通过 `auth_init` 获得授权页，回调后执行 `auth_exchange`，使用账户授权 token 查询 `/auth-api/v0/users/current` 和 `/api/v0/users/get_user_summary`，不发起模型任务。

请求使用 QuotaPeek 自身版本和平台信息，限制响应大小为 64 KiB，不跟随重定向。授权和完成页面只允许开放平台的固定路径；回调校验 state、路径和参数唯一性。单次网络请求超时 30 秒，登录流程最长 10 分钟；取消会阻止尚未提交的凭据写入，已提交的结果返回对应账户 ID。隐藏连接面板允许登录继续。

账户按平台返回的稳定用户 ID 保存；再次登录同一账户更新原记录，不同账户独立保留。账户授权保存在本机应用数据目录的 `deepseek-platform-accounts.json`，设备身份在 `deepseek-device.json`。沿用现有明文 JSON 存储，前端缓存、轮询结果和错误信息不包含授权 token 或 PKCE verifier。HTTP 401 和会话过期业务码会提示重新登录，其他查询失败保留上次成功余额。

充值钱包和赠金钱包分别读取，同一币种内使用有界整数十进制运算精确合计，支持负数及科学计数法；不同币种保持独立。实现限制有效金额位数和指数范围，溢出拒绝解析而非舍入。余额不足不当作登录失败，不推算固定额度百分比；钱包接口没有提供赠金到期时间。

之前的 API Key 账户继续通过 `src-tauri/src/deepseek.rs` 调用公开 `GET https://api.deepseek.com/user/balance`，保存在 `deepseek-accounts.json`。默认连接界面不再要求 Key，旧记录不会被删除。两种认证使用不同存储和查询路径，避免把 Key 当账户授权 token 使用。

卡片图像使用独立的 `src/assets/models/deepseek/avatar.png` Q 版头像，侧栏和供应商切换继续使用 `src/assets/providers/deepseek/` 下的产品图标。新增余额型供应商时，应复用账户状态流程，分别定义余额与额度的侧栏含义。

## 测试与检查

在项目根目录运行：

```sh
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

真实 Codex 集成测试默认跳过。需要本机 Codex 已登录且网络可用时，手动运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_codex_query -- --ignored --nocapture
```

涉及窗口和交互的改动，还应在桌面应用中检查：悬停预览与关闭延迟、跨图标和卡片移动、单账户刷新、账户切换后的高度、屏幕左右边缘展开，以及连接面板隐藏期间的登录流程。

## 新增供应商

1. 增加供应商数据类型，并扩展 `Account` 联合类型。
2. 实现 Rust 端查询、必要的登录流程和 Tauri 命令注册。
3. 添加前端 service 与专属卡片，并接入账户状态和供应商分组。
4. 更新图标、圆环额度含义及连接入口。
5. 补充数据解析、账户身份和卡片展示的测试。

不要默认假设所有服务都采用相同的额度周期；保留服务返回的单位、窗口时长和未知字段语义。
