# 活动配置与本机执行

配置服务发布活动定义，QuotaPeek 使用本机凭据直接访问官方接口。服务不接收账号、凭据或领取请求。

安装与启动见 [配置服务 README](../activity-service/README.md)，联调与测试见 [测试说明](../tests/activity_mock/README.md)。

## 配置来源

```text
GET /v1/activities
    ├─ 有效配置（包括空清单） → 使用服务端配置
    └─ 未配置、请求失败或配置无效 → 读取 exe 同级 activities.json
                                      └─ 不存在或无效 → 显示错误，无可执行活动

选择活动和账号 → 本机校验配置与资格 → 访问官方接口 → 复核领取结果
```

两个来源不合并。服务端有效空清单表示全部下架，不回退本地；官方查询或领取失败也不触发配置回退。每次打开活动页或手动刷新都会重新获取配置并查询账号状态，配置获取超时为 5 秒。

[正式配置](../activity-service/activities.json) 可直接复制到 exe 同级作为本地配置；便携版和安装版均按 exe 所在目录定位。浏览器开发预览从仓库根目录读取 `activities.json`。

服务地址按以下优先级选择：

1. 持久设置 `quotapeek-activity-service-url`。
2. 构建变量 `VITE_ACTIVITY_SERVICE_URL`。
3. 开发默认地址 `http://127.0.0.1:1431/v1/activities`；生产构建默认无服务地址。

当前没有服务地址设置界面，部署时可通过构建变量指定。远程地址要求 HTTPS，回环地址允许 HTTP。

## 配置协议

配置使用 `schemaVersion: 2`，服务通过 `/v1/catalog-schema` 发布 JSON Schema。模型与服务路由见 [app.py](../activity-service/app.py)。修改 JSON 后刷新即可生效；修改服务代码需要重启。

| 字段 | 含义 |
| --- | --- |
| schemaVersion | 固定为 2 |
| revision | 文件中的描述性版本；服务响应替换为内容哈希 |
| activities | 最多 100 个活动；`[]` 为有效空清单 |
| id、providerId | 唯一活动标识；供应商为 workbuddy 或 zcode |
| title、reward、description | 展示文案；奖励说明不代表实际到账 |
| enabled | 默认 true；false 时不显示、不执行 |
| regions | cn/global；省略或 `[]` 表示配置不限制地区，适配器仍可收紧 |
| startsAt、expiresAt | 可选 Unix 秒；执行时再次检查有效期 |
| adapterId | 正式配置使用 workbuddy-checkin-v1、zcode-plan-v1；兼容仅查询的 zcode-preview-v1；测试使用 mock-http-v1 |
| query、claim | 查询与可选领取操作；缺少 claim 时不能领取 |
| request.url、method | 完整 URL 与 GET/POST，需命中客户端内置地址及方法策略 |
| request.query、body | 字符串查询参数与可选 JSON 对象；GET 不能带 body |
| request.timeoutMs | 500–30000 毫秒，默认 5000 |
| response.rules | 按顺序匹配，首条满足全部条件的规则生效 |
| rule.all | path 与 equals 条件数组；path 为点分隔的对象字段，缺失字段不等于 null |
| rule.status | unknown / available / claimed / verification / failed / pending |

配置不接受认证头、凭据或脚本。授权信息、设备标识及供应商专用参数由本机适配器生成。新增目的地址、认证方式或复杂流程需要更新客户端适配器。

配置和响应最多 1 MB，不允许 HTTP 重定向。客户端校验协议、域名、端口、精确路径和方法，官方请求 URL 不接受用户名、密码、片段或内嵌查询参数（查询参数通过 `request.query` 指定）。服务只校验结构，服务端与本地配置均需通过客户端策略校验。

## 领取规则

| 状态 | 界面行为 |
| --- | --- |
| available | 可领取 |
| claimed | 已领取，禁用按钮 |
| unknown | 查询失败或资格不明，禁用按钮 |
| verification | 提示去官方应用完成验证或领取 |
| pending | 结果待确认，禁用按钮，先刷新复核 |
| failed | 操作失败，刷新后重新判断 |
| claiming | 正在提交，仅用于界面 |

HTTP 200 不代表领取成功。无匹配规则的查询为 unknown，领取为 pending。Claim all 跨供应商串行处理已确认 available 的账号。

领取要求最近 5 分钟内查询到 available，提交前再次查询资格。活动操作在本机串行执行，旧配置会话不能提交；领取不会自动重试，只会查询复核。确认到账后自动刷新对应账号的额度，额度刷新失败不覆盖已领取状态。

## 供应商行为

### WorkBuddy

使用 CN 官方接口：

| 操作 | 地址 |
| --- | --- |
| 查询 | POST `https://copilot.tencent.com/v2/billing/meter/checkin-activity-status` |
| 领取 | POST `https://copilot.tencent.com/v2/billing/meter/daily-checkin` |

复用 QuotaPeek 的本机登录凭据及 token 刷新流程。提交后再次查询，只有查到 claimed 才显示成功；HTTP 400 / code 10001 同样需要复核。

### ZCode

当前正式配置使用 `zcode-plan-v1`，通过官方 `https://zcode.z.ai/api/v1/` 下的接口执行：

| 接口 | 用途 |
| --- | --- |
| GET zcode-plan/billing/preview | 查询可领取套餐 |
| GET client/configs | 读取验证配置 |
| POST zcode-plan/billing/claim | 提交领取 |
| GET zcode-plan/billing/balance | 复核到账 |

领取操作的配置 query 和 body 必须为空，套餐 ID 由本机从官方预览选择。凭据保留在 Rust，前端加载官方验证 SDK；验证通过后使用绑定账号、套餐及配置会话的一次性票据提交。需要交互验证、存在多个可选套餐或验证配置不可用时，提示去官方应用处理。

只有目标套餐新增或发放身份、有效期、权益发生变化且为 active，才确认到账。名称、排序变化及空预览不作为成功依据；已确认回执在当前进程内保留。

提交结果不明时保持 pending，并在当前进程内阻止重复提交，刷新配置不会解除。该记录不跨重启保存；结果不明时应先去官方应用确认。

## 验证范围

模拟测试覆盖配置优先级、本地回退、原生命令、查询与领取复核，以及超时、损坏 JSON、重定向和重复提交。模拟测试不证明真实账号资格或到账。

已有本机验证记录（2026-10-04）确认开发及打包来源下的 ZCode 无感验证通过，真实账号流程已推进到可提交阶段，但未提交领取。WorkBuddy 真实账号领取、ZCode 真实领取及到账仍待实测。
