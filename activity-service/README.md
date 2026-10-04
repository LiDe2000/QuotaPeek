# QuotaPeek 活动配置服务

本目录纳入 Git 版本管理。服务只发布活动定义，不接收账号、token、Cookie 或领取请求；真实请求由 QuotaPeek 本机执行。

## 目录结构

| 文件 | 用途 |
| --- | --- |
| `app.py` | FastAPI 路由、配置模型与校验 |
| `activities.json` | 正式发布的活动配置，也是客户端本地配置的分发样例 |
| `requirements.txt` | 服务运行依赖及版本 |
| `start.ps1` | 使用当前 Python 环境启动本机服务，可指定端口和配置文件 |
| `README.md` | 安装、启动与维护说明 |

## 安装与启动

需要 Python 3.11+。先激活你的 Conda 环境，然后在项目根目录运行：

```powershell
python -m pip install -r activity-service/requirements.txt
./activity-service/start.ps1
```

默认监听 `127.0.0.1:1431`：

启动脚本使用当前环境的 `python`，不创建项目内虚拟环境。

- `GET /v1/activities`：读取本目录 `activities.json`，校验后发布完整 v2 配置。
- `GET /v1/catalog-schema`：配置的 JSON Schema。
- `GET /health`：健康检查。
- `/docs`：FastAPI 接口文档。

每次请求重新读取文件，修改无需重启。内容哈希生成服务响应的 revision。服务不再提供账号查询或代领路由。

## 活动配置

[activities.json](activities.json) 是唯一的正式配置，包含 WorkBuddy 签到与 ZCode 本机验证、领取的官方接口。启动脚本默认发布这份文件，无需设置环境变量；ZCode 验证失败时提示去官方应用。

服务端文件可直接复制成 exe 同级 `activities.json`，不需要改格式。浏览器开发预览的本地文件位于仓库根目录；真正桌面应用始终从 exe 同级读取。

模拟配置只保存在测试目录，开发联调时显式指定：

```powershell
./activity-service/start.ps1 -CatalogFile ./tests/activity_mock/activities.json
```

自定义端口使用 `-Port 1435`。更改配置结构或接口代码（`app.py`）需要重启服务；仅编辑 `activities.json` 无需重启。

验证服务与模拟接口（需要额外的测试依赖）：

```powershell
python -m pip install -r tests/activity_mock/requirements.txt
python -B -m unittest discover -s tests/activity_mock -p 'test_*.py'
```

公开部署时使用进程管理器启动 `uvicorn app:app`，通过反向代理提供 HTTPS；客户端通过构建变量 `VITE_ACTIVITY_SERVICE_URL` 设置清单地址。不要把测试用的模拟官方服务部署到公网。

完整的数据流、配置约束与本地回退规则见 [活动协议](../docs/activity-service.md)。模拟测试见 [测试说明](../tests/activity_mock/README.md)。
