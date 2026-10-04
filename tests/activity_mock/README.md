# 活动双服务联调

两个独立进程：

| 服务 | 地址 | 职责 |
| --- | --- | --- |
| activity-service | 127.0.0.1:1431 | 发布完整配置，不处理账号或授权 |
| 本目录 FastAPI | 127.0.0.1:1432 | 模拟官方查询与领取，只接受固定样例账号 |

模拟服务拒绝 Authorization、Cookie、X-Refresh-Token 和真实账号。它只用于开发，不是官方协议的完整仿真，也不能证明真实活动资格或到账。

## 自动测试

激活你的 Conda 环境后，在项目根目录运行：

```powershell
python -m pip install -r tests/activity_mock/requirements.txt
python tests/activity_mock/run.py
```

脚本运行 Python 路由测试，启动两个服务，实际运行 Rust HTTP 执行器、使用真实 Wry AppHandle 的原生命令及浏览器预览 HTTP 客户端，然后停止自身启动的进程。原生命令测试不创建窗口、不加载真实账户数据库。端口被占用时退出，不结束其他服务。需要 Cargo 和 Node 已加入 PATH。

覆盖服务端配置优先、404 回退本地、查询、单账户领取、领取后复核、重复领取不再提交、待确认结果、需要验证与账号隔离。Rust 常规测试另外覆盖有效空清单、非法配置、重定向拒绝、目的地址限制和过期配置。

故障联调会在模拟服务已更新领取状态后，让领取响应延迟 1 秒（客户端超时 500 ms）、返回损坏 JSON 或重定向。客户端只通过查询复核结果；服务端计数器验证没有重复 POST，也没有访问重定向目标。原生命令另外覆盖未查询即领取、并发重复领取、旧会话拒绝，以及从测试 exe 同级文件读取配置；测试后自动恢复该文件。

`POST /testing/reset`、`GET /testing/stats` 与重定向目标只存在于这个测试替身中，用于恢复状态和观测提交次数；正式配置服务没有这些接口。Windows Python 的 Proactor 循环可能在故意超时、客户端断开连接时打印 `WinError 10054`；判断测试结果应看最终断言和退出码。

Windows 原生命令测试复用 Tauri 生成的资源清单，避免库测试 exe 缺少 Common Controls v6 时出现 `TaskDialogIndirect` 入口点错误。运行脚本以 UTF-8 输出，兼容 Node 测试报告中的 Unicode 字符。

本机回环配置与模拟接口请求直接连接，不经过系统或环境代理；正式外网接口仍使用默认代理策略。配置失败时界面显示失败原因，HTTP 错误会附带状态码和目标路径，便于区分未配置地址、错误路由和网络失败。回归测试在独立子进程配置故意返回 503 的代理，确认本地配置仍能直接获取。

这些自动测试验证原生命令和 HTTP 链路；桌面窗口点击及 JS 到 Rust 的真实 WebView IPC 不属于此无窗口测试，真实供应商账号资格和奖励到账也尚未实测。

## 手动浏览器联调

三个终端先激活同一个 Conda 环境，再分别运行：

```powershell
./activity-service/start.ps1 -CatalogFile ./tests/activity_mock/activities.json
```

```powershell
./tests/activity_mock/start.ps1
```

```powershell
npm run dev
```

打开 `http://127.0.0.1:1420/?preview=activities`。只有此开发预览会使用样例账号。

测试本地回退：

1. 将 `tests/activity_mock/activities.json` 复制到仓库根目录，保持文件名 `activities.json`。
2. 停止 1431 配置服务，保留 1432 模拟官方服务。
3. 刷新活动页，来源应显示 Local configuration，并仍能查询/领取模拟活动。
4. 重启 1431 后刷新，来源恢复 Server configuration。
5. 把服务端配置的 activities 改为 [] 后刷新，应显示无活动，不能补入本地活动。测试后恢复服务端文件。

浏览器开发模式的固定文件路由仅为预览使用，不进入生产构建。

## 原生开发联调

```powershell
$env:VITE_ACTIVITY_PREVIEW = '1'
$env:VITE_ACTIVITY_SERVICE_URL = 'http://127.0.0.1:1431/v1/activities'
npm run tauri dev
```

在两个模拟服务已启动时，应用使用样例账号，经 Rust 执行查询与领取。若要测本地回退，将配置复制到 `src-tauri/target/debug/activities.json`（或自定义 Cargo target 下实际 exe 的目录），然后停止 1431 并刷新。

退出测试后移除环境变量：

```powershell
Remove-Item Env:VITE_ACTIVITY_PREVIEW
Remove-Item Env:VITE_ACTIVITY_SERVICE_URL
```

发行构建禁用模拟执行，即使有人放入模拟配置也不会向本地模拟服务发送真实账号数据。

样例状态：WorkBuddy Personal 可领取、Research 已领取、Work 返回待确认；ZCode Personal 可领取、Work 需要验证。服务进程重启或 reset 后恢复。
