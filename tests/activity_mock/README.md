# 活动双服务联调

本文用于本机模拟活动查询与领取。所有命令均从仓库根目录运行。

## 1. 准备环境

需要 Python、Node.js 和已安装的项目依赖。原生联调与自动测试还需要 Cargo 和 Windows Tauri 开发环境，参见 [开发说明](../../docs/development.md)。

激活你的 Conda 环境后安装测试依赖：

```powershell
python -m pip install -r tests/activity_mock/requirements.txt
```

联调使用两个独立服务：

| 服务 | 地址 | 职责 |
| --- | --- | --- |
| 配置服务 `activity-service` | 127.0.0.1:1431 | 发布模拟活动配置，不处理账号或授权 |
| 模拟官方服务 `tests/activity_mock` | 127.0.0.1:1432 | 模拟查询与领取，只接受固定样例账号 |

## 2. 手动联调

准备三个终端，服务终端先激活安装了测试依赖的 Conda 环境。按以下顺序启动两个服务，再选择浏览器或原生应用作为第三个进程。

### 2.1 启动配置服务

终端一运行：

```powershell
.\activity-service\start.ps1 -CatalogFile .\tests\activity_mock\activities.json
```

必须指定模拟配置；省略 `-CatalogFile` 会加载正式官方配置。若 1431 已运行其他配置服务，先在原终端按 `Ctrl+C` 停止，再执行上述命令。

### 2.2 启动模拟官方服务

终端二运行：

```powershell
.\tests\activity_mock\start.ps1
```

### 2.3 启动应用（二选一）

**浏览器预览**：终端三运行：

```powershell
npm run dev
```

打开 [活动预览](http://127.0.0.1:1420/?preview=activities)。只有此开发预览会使用样例账号。

**原生开发应用**：终端三运行：

```powershell
$env:VITE_ACTIVITY_PREVIEW = '1'
$env:VITE_ACTIVITY_SERVICE_URL = 'http://127.0.0.1:1431/v1/activities'
npm run tauri dev
```

应用使用样例账号，经 Rust 执行查询与领取。退出测试后，在该终端移除环境变量：

```powershell
Remove-Item Env:VITE_ACTIVITY_PREVIEW -ErrorAction SilentlyContinue
Remove-Item Env:VITE_ACTIVITY_SERVICE_URL -ErrorAction SilentlyContinue
```

## 3. 测试状态与重置

### 3.1 默认样例

| 供应商 | 样例账号 | 初始／重置后的状态 | 领取结果 |
| --- | --- | --- | --- |
| WorkBuddy | Personal | 可领取 | 已领取 |
| WorkBuddy | Research | 已领取 | 不可重复领取 |
| WorkBuddy | Work | 可领取 | 待确认 |
| ZCode | Personal | 可领取 | 已领取 |
| ZCode | Work | 需要验证 | 不可直接领取 |

界面中的灰点表示状态未知，绿色圆点与 `Claimed` 表示已领取；灰点加禁用的 `Claim` 按钮不代表已领取。

每次进入活动页都会自动加载配置并查询状态，期间显示 `Checking activities…`。顶部刷新按钮仅用于刷新账号信息；要重新查询活动，返回账号页后再进入活动页。

若底部显示 `Preview · No real claims`，但活动标题仍是正式配置中的 `Buddy gas station`，说明可能误用了正式配置。按 2.1 节切换为模拟配置，再重新进入活动页。程序拒绝混用样例账号与正式活动。

### 3.2 重置领取记录

保持两个服务运行，在另一个终端执行：

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:1432/testing/reset'
```

然后返回账号页，再进入活动页查询状态。此命令清除模拟领取记录和提交计数，恢复上述默认样例，**不是将全部账号设为未领取**。重启 1432 服务也会恢复默认状态；仅重新查询活动不会重置服务中的记录。

若需要所有样例账号均可领取，需修改 [app.py](app.py) 中的默认状态；若还需要所有领取都成功，也需调整 WorkBuddy Work 的待确认分支。

### 3.3 查看提交计数

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:1432/testing/stats'
```

返回 `claims`（领取接口请求次数）与 `redirects`（重定向目标访问次数），用于观察重复提交和重定向行为。它们是请求计数，不是成功到账数量。

## 4. 测试配置回退与空清单

先按第 2 节启动手动联调，再准备本地配置：

| 应用模式 | 将 `tests/activity_mock/activities.json` 复制到 |
| --- | --- |
| 浏览器预览 | 仓库根目录的 `activities.json` |
| 默认原生开发构建 | `src-tauri/target/debug/activities.json` |
| 自定义 Cargo target | 实际应用 exe 同级的 `activities.json` |

如果目标位置已有配置，先备份，测试结束后恢复。

### 4.1 服务不可用时回退本地

1. 停止 1431 配置服务，保留 1432 模拟官方服务。
2. 返回账号页后重新进入活动页，来源应显示 `Local configuration`，并仍能查询／领取模拟活动。
3. 按 2.1 节重启 1431，再重新进入活动页，来源应恢复 `Server configuration`。

浏览器的固定本地文件路由仅为开发预览使用，不进入生产构建；原生应用从 exe 同级读取本地配置。

### 4.2 有效空清单优先于本地配置

将服务端模拟配置的 `activities` 改为 `[]`，保持 1431 运行并重新进入活动页。界面应显示无活动，不能补入本地活动。测试结束后恢复模拟配置并重新进入活动页。

## 5. 自动测试

### 5.1 运行

先停止手动联调的 1431 和 1432 服务，确保端口空闲。在已安装依赖的 Conda 环境运行：

```powershell
python tests/activity_mock/run.py
```

脚本依次运行 Python 路由测试、启动两个服务、运行 Rust HTTP 执行器和使用真实 Wry AppHandle 的原生命令测试，以及浏览器预览 HTTP 客户端测试，最后停止自身启动的服务。端口被占用时退出，不结束其他服务。Cargo 和 Node 需已加入 PATH。

### 5.2 覆盖范围

覆盖服务端配置优先、404 回退本地、查询、单账号领取、领取后复核、重复领取不再提交、待确认、需要验证与账号隔离。Rust 常规测试另外覆盖有效空清单、非法配置、重定向拒绝、目的地址限制和过期配置。

故障联调会先更新模拟领取状态，再让响应延迟 1 秒（客户端超时 500 ms）、返回损坏 JSON 或重定向。客户端通过查询复核结果；服务端计数器验证没有重复 POST，也没有访问重定向目标。

原生命令还覆盖未查询即领取、并发重复领取、旧会话拒绝，以及从测试 exe 同级文件读取配置；测试后自动恢复该文件。本机回环请求直接连接，不经过系统或环境代理；独立子进程的代理回归测试确认本地配置不会经过故意返回 503 的代理。

### 5.3 Windows 运行说明

原生命令测试复用 Tauri 生成的资源清单，避免库测试 exe 缺少 Common Controls v6 时出现 `TaskDialogIndirect` 入口点错误。脚本以 UTF-8 输出，兼容 Node 测试报告中的 Unicode 字符。

Python Proactor 循环可能在故意超时、客户端断开时打印 `WinError 10054`；判断测试结果应看最终断言和退出码。配置加载失败时，应用会显示原因；HTTP 错误附带状态码和目标路径。

## 6. 测试边界

模拟服务拒绝 Authorization、Cookie、X-Refresh-Token 和真实账号。`POST /testing/reset`、`GET /testing/stats` 与重定向目标仅存在于 1432 测试替身中，正式配置服务没有这些接口。重置不能改变真实官方账号的领取记录。

自动测试验证原生命令和 HTTP 链路，不创建窗口、不加载真实账户数据库；桌面窗口点击与 JS 到 Rust 的真实 WebView IPC 不属于此无窗口测试。模拟服务不是官方协议的完整仿真，不能证明真实账号资格或奖励到账。

发行构建禁用模拟执行，即使放入模拟配置，也不会向本地模拟服务发送真实账号数据。
