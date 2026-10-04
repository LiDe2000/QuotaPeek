# 开发文档

[README](../README.md) · [数据存储](storage.md) · [常见问题](troubleshooting.md)

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React、TypeScript、Vite |
| 桌面与查询 | Tauri 2、Rust |
| 持久化 | SQLite、Windows DPAPI |
| 测试 | Node.js 测试运行器、Rust 单元测试、PowerShell 桌面验证 |

环境安装和启动命令见 [中文 README](../README.zh-CN.md#从源码开发)。

## 代码结构

```text
src/
  components/
    accounts/       # 账户入口、连接、移除和共用卡片样式
    navigation/     # 侧栏、平台切换与排序
    providers/      # 供应商专属卡片及样式
    settings/       # 外观设置
    shared/         # 公共图标与平台标识
  hooks/            # 账户、主题、悬停、排序与窗口状态
  lib/
    accounts/       # 账户合并与刷新冷却
    providers/      # 平台分组、图标与额度圆环
    storage/        # 前端持久化状态与写入队列
    window/         # 高度和屏幕定位计算
    format/         # 金额与时间格式
  services/
    providers/      # 供应商查询和登录的 Tauri 调用
    storage.ts      # 设置与缓存调用
  types/
    providers/      # 供应商数据类型
    quota.ts        # Account 联合类型及公共工具
  assets/           # 产品图标与卡片头像
  styles/           # 设计变量、主题与全局样式
  App.tsx           # 主面板组合入口
  main.tsx          # 持久化初始化与 React 挂载
src-tauri/
  src/
    providers/
      codex/        # mod.rs：协议查询；executable.rs：程序发现
      deepseek/     # mod.rs：余额模型与 API Key；login.rs：授权；wallet.rs：金额计算
      workbuddy.rs  # WorkBuddy 授权与查询
      zcode.rs      # ZCode 授权与查询
    storage/        # mod.rs：数据库；accounts.rs：账户；credentials.rs：凭据；commands.rs：命令
    desktop/        # window.rs：显示；bounds.rs：边界；drag.rs：拖动；tray.rs：托盘
    lib.rs          # 启动、状态和命令注册
    main.rs         # 进程入口
  capabilities/     # 桌面权限
  icons/            # 应用与安装包图标
tests/
  frontend/         # 逻辑、渲染与交互测试
  rust/             # 解析、授权、窗口参数与存储单元测试
  desktop/          # 便携 exe 启动、持久化与目录移动验证
scripts/            # 开发期渲染诊断
.vscode/            # 共享索引与 Clippy 设置
```

## 维护约定

- 按职责组织文件，组件与专属 CSS 同目录；平台共用的 `AccountCard.css` 位于 `components/accounts/`。
- 同一供应商出现多个独立职责时建子目录，保留分文件实现；Rust 的 `mod.rs` 为模块入口。
- 测试统一放在 `tests/`。Rust 通过 `#[cfg(test)]` 和 `#[path]` 引入单元测试，无需扩大生产代码可见性。
- `.vscode/settings.json` 将 `${workspaceFolder}/tests/rust` 纳入 rust-analyzer 索引，并在保存时运行 Clippy；其他个人配置不提交。
- 变更功能时同步更新调用方、相关测试和文档。

### Tauri 配置

| 文件 | 用途 |
| --- | --- |
| `src-tauri/tauri.conf.json` | 通用配置，默认关闭安装包 |
| `src-tauri/tauri.installed.conf.json` | 启用 NSIS、MSI，配合 `installed` 特性 |
| `src-tauri/tauri.software-rendering.conf.json` | WebView2 软件渲染回退 |

补充配置通过 `--config` 与主配置合并，数组会整体替换；覆盖 `app.windows` 时保留所需窗口属性。三个文件使用相同 `identifier` 和本地 `$schema`，兼顾构建与编辑器校验。变更应用标识时同步修改三处，并评估安装版数据目录的变化。合并规则见 [Tauri 配置文档](https://v2.tauri.app/zh-cn/develop/configuration-files/)。

## 账户与查询状态

`main.tsx` 先加载数据库再挂载 React；`useAccounts` 管理账户、查询进度、错误和最后成功时间。前端 service 调用 Tauri 命令，Rust 查询供应商并返回结果，持久化写入按队列串行执行。

- `Account` 按 `providerId` 区分供应商，保留各服务的单位、币种和窗口时长。
- 账户按稳定 ID 更新；刷新不改变账户顺序，同一账户并发查询复用已有请求。
- 启动恢复账户后查询一次；悬停只读缓存，手动刷新在请求完成后有 10 秒冷却期。
- 侧栏图标对应供应商当前选中账户。各供应商选择独立保存，平台顺序在侧栏与主面板同步。
- 查询失败保留上次数据；未知值不转成零，重置时间到期后需重新查询。
- 移除账户先阻止新查询、等待已有查询，再删除本地记录。失败保留账户；旧结果不能重新加入已移除账户。
- 隐藏连接面板允许登录继续，取消通过独立操作完成。

存储事务与凭据规则见 [数据存储](storage.md)。

### Codex 查询

使用本机 Codex app-server 的 stdio JSON-RPC：

```text
initialize → initialized → account/read → account/rateLimits/read → account/read
```

前后读取账户身份，防止登录切换时错误归属额度。优先读取 `rateLimitsByLimitId`，回退到 `rateLimits`；圆环展示额度窗口中最小的剩余比例。查询不启动模型任务，不读取或复制登录令牌；45 秒超时后清理子进程。

### DeepSeek 查询

- 默认连接采用 S256 PKCE、随机 state 和 `127.0.0.1` 临时回调；流程为 `auth_init`、`auth_exchange`、账户信息与钱包查询。
- 请求限制响应大小，不跟随重定向，校验授权路径与回调参数；单次请求超时 30 秒，登录最长 10 分钟。
- 账户按稳定用户 ID 保存，授权仅在 Rust 查询时解密；前端状态与错误信息不包含 token 或 PKCE verifier。
- 充值与赠金同币种精确合计，不同币种独立；负余额有效，金额溢出拒绝解析，不推算额度百分比或赠金到期时间。
- 已有 API Key 账户使用公开余额接口，与平台账户分别使用 `deepseek-api`、`deepseek-platform` namespace。

## 窗口布局

### 测量与定位

`useFittedWindowHeight` 观察内容和 DOM，使用自然内容高度测量；只有当前卡片参与计算，超出限高后在面板内滚动，根节点不滚动。最大高度为显示器工作区减去 80 个逻辑像素，保留 4 像素余量和 2 像素误差容忍。

定位保持侧栏屏幕位置，按可用空间选择左右展开。CSS 尺寸按当前 DPI 转为物理尺寸，屏幕原点保留物理坐标，支持负坐标。DPI 变化重新拟合，靠近屏幕底部时校正纵向位置，避免放大后的可见区域超出工作区。

### 整体界面缩放

外观设置提供 75%–150% 的整体缩放，拖动时仅预览百分比，松手后应用并保存。布局比例只修改一次，等待窗口拟合完成后用 `transform` 播放短过渡；Windows 保留较大绘制表面，只收回可见裁剪区域，避免过渡结束时再次改变表面尺寸。交互约定、动画时序、方案取舍和验证边界见 [整体界面缩放设计](interface-scale.md)。

### 原生边界与拖动

Windows 使用稳定原生视口，以裁剪区域适配内容，减少 WebView2 表面反复改变尺寸；裁掉区域不显示、不接收鼠标。其他平台直接拟合原生尺寸。

前端发送 `invoke("fit_window_bounds", { bounds: { ... } })`，Rust 解析为 `WindowBounds`。字段采用 camelCase；`visibleHeight` 区别于原生 `height`，省略时使用原生高度。修改参数需同步前端调用、hook 测试和 Rust JSON 测试。

几何请求串行提交，核对来源位置。系统拖动期间暂停拟合，松开后恢复；`startDragging()` 完成不代表鼠标已松开。固定视口和旧尺寸模式仅用于开发诊断，命令见 [渲染排障](troubleshooting.md#windows-整窗短暂消失或闪帧)。

### 托盘与权限

`desktop/tray.rs` 分发原生菜单动作，`desktop/window.rs` 管理显示与隐藏，通过 `desktop-show-main` 通知前端打开面板。置顶状态在本次运行中保留，重启默认关闭。

窗口关闭时隐藏到托盘；**Quit** 调用 `app.exit(0)`。Windows 透明窗口启用 `noRedirectionBitmap`，前端窗口操作权限由 `src-tauri/capabilities/default.json` 声明。修改权限或原生配置后重启桌面进程。

## 测试与检查

在项目根目录运行：

```sh
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

| 检查 | 覆盖内容 |
| --- | --- |
| `npm run check` | 前端、Vite 配置类型检查；所有 Rust 目标和特性的 Clippy，警告视为错误 |
| `npm test` | `tests/frontend/` 的逻辑、渲染和交互 |
| `npm run build` | 前端生产构建 |
| `cargo test` | 通过实现模块引入的 `tests/rust/` 单元测试 |

真实服务测试默认跳过，按需单独执行：

活动功能使用独立的配置服务和模拟官方服务进行本机联调，步骤见 [活动测试](../tests/activity_mock/README.md)。配置与凭据流向见 [活动协议](activity-service.md)。

```sh
# 需本机 Codex 已使用 ChatGPT 登录及网络可用
cargo test --manifest-path src-tauri/Cargo.toml live_codex_query -- --ignored --nocapture

# 需网络；创建并立即取消 DeepSeek 授权，不完成登录
cargo test --manifest-path src-tauri/Cargo.toml live_authorization_initialization -- --ignored --nocapture
```

桌面改动需实机检查悬停、刷新、账户切换、平台排序、缩放与屏幕边缘、登录取消，以及托盘隐藏和退出。便携数据验证见 [存储文档](storage.md#便携版验证)。单元测试和前端构建不能证明原生窗口呈现或安装包行为。

## 新增供应商

1. 在 `types/providers/` 定义类型，扩展 `Account`。
2. 在 Rust `providers/` 实现查询与授权，并在 `lib.rs` 注册命令。
3. 添加 `services/providers/` 调用与 `components/providers/` 卡片。
4. 接入连接入口、稳定账户身份、平台分组、图标和圆环含义。
5. 补充解析、身份、错误和展示测试，同步更新中英文 README 的服务表。

新增设置或修改数据库结构时遵循 [存储维护规则](storage.md#维护规则)。
