# QuotaPeek

All your AI limits at a glance.

React + TypeScript + Vite 界面，Tauri 2 + Rust 桌面后端。

## 本地运行

安装 Node.js、Rust 和对应平台的 Tauri 开发依赖后：

```sh
npm install
npm run tauri dev
```

## Codex 真实额度查询

1. 本机安装 Codex，并使用 ChatGPT 账户登录。API key 登录不支持订阅额度查询。
2. 确保 `codex` 原生可执行文件在 PATH 中，安装后重启 QuotaPeek / 编辑器。
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
