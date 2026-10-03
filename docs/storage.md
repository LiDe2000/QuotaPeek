# 数据存储

[README](../README.md) · [开发文档](development.md) · [常见问题](troubleshooting.md)

## 数据位置

| 模式 | 目录 | 选择方式 |
| --- | --- | --- |
| 便携版 | exe 同级 `data/` | 默认构建 |
| 安装版 | `%LOCALAPPDATA%/com.lide.quotapeek/` | `installed` 编译特性，或 `--installed` 启动参数 |

目录包含 `quotapeek.db` 和 `webview/`。路径以运行 exe 为准，不依赖启动工作目录；开发构建也使用自身 exe 同级目录。数据库可用后才创建 WebView，无法写入或版本不兼容时报告错误，不静默切换目录。

软件渲染模式使用 `webview/` 内独立配置目录，SQLite 数据库保持一致。不导入早期 JSON 或 localStorage 数据。

## 数据结构

Rust 的 `storage/` 统一管理数据库，前端先加载状态再挂载 React，后续写入串行排队。

| 表 | 内容 |
| --- | --- |
| `accounts` | 稳定 ID、namespace、供应商、公开身份 JSON、排序和时间戳 |
| `credentials` | 账户外键、保护格式标记、凭据密文 BLOB |
| `quota_cache` | 账户外键、查询时间、缓存格式版本、供应商结果 JSON |
| `settings` | 主题、账户选择、平台顺序、设备标识等键值 |
| `schema_migrations` | 已执行的数据库升级版本和时间 |

公开身份不含 token 或 API Key。供应商结果直接存入 JSON 字段，不保存旧文件路径。

### 事务与账户移除

- 账户公开信息与凭据一起提交，保证稳定 ID 和排序。
- 当前账户及各供应商选择在同一设置事务中保存。
- `storage_remove_account` 删除账户，外键级联清理凭据和缓存，同时修复选择；失败整体回滚。
- 前端等待已有查询结束后删除，阻止旧结果或排队缓存重新加入；显式重新连接后解除限制。

账户移除不调用供应商退出接口，不修改本机 Codex 登录。

## 凭据保护

Windows 使用当前用户范围 DPAPI 加密。账户列表读取公开信息，查询时解密对应凭据；无法解密时提示重新授权，再次登录覆盖该账户凭据。其他平台尚无安全存储实现时拒绝保存凭据，不回退为明文。

跨电脑或 Windows 用户复制数据库可保留账户、设置和缓存，但通常需重新授权。Codex 登录由外部 Codex 管理。

## 数据库升级

数据库通过 `application_id` 识别格式，使用 `user_version` 和 `schema_migrations` 跟踪版本。

1. 检查数据库身份和版本；拒绝其他格式及未来版本。
2. 已有数据库升级前使用 SQLite backup API 生成 `quotapeek.db.v<旧版本>.bak`。
3. 在事务中执行未完成升级，同步更新版本记录；失败回滚。

备份先写临时文件，成功后改名。已有同版本备份需通过完整性、身份和版本检查，否则停止升级。重复启动不重跑已完成步骤，不清空或降级数据库。

额度缓存单独使用 `format_version`。不支持的缓存跳过，成功查询后替换；不影响账户凭据和设置。

## 备份、升级与移动

1. 从托盘 **Quit** 完全退出，关闭窗口只会隐藏。
2. 备份整个数据目录；移动便携版时同时复制 exe 与 `data/`。
3. 升级便携版只替换 exe，保留原 `data/`。
4. 跨电脑或用户运行后，按提示重新授权。

数据库使用 DELETE 日志模式和短事务。不要在应用运行时直接复制数据库文件。

## 维护规则

- 新增供应商：定义 namespace、数据类型和公开身份，通常无需改表。
- 新增 UI 设置：在 `storage/mod.rs` 的 `UI_SETTING_KEYS` 注册，设备内部标识保持独立。
- 改表：仅在 `MIGRATIONS` 末尾追加 SQL，不修改已发布步骤；当前版本自动取升级步骤数量。
- 改缓存结构：评估 `format_version`，兼容旧缓存或跳过，保留账户与凭据。
- 涉及写入的改动补充事务回滚、重启恢复和旧查询结果的回归检查。

## 便携版验证

先构建便携版，再在 Windows PowerShell 运行：

```powershell
npm run tauri:build:portable
powershell -ExecutionPolicy Bypass -File tests/desktop/verify-portable-storage.ps1
```

自定义 exe 可追加 `-Executable "C:\path\quotapeek.exe"`。

脚本在工作区 `.tmp/` 创建隔离副本，验证不同工作目录启动、IPC 保存、合成状态、目录移动和重启恢复。测试使用不可解密的合成凭据，不查询真实账户，结束后关闭测试进程并保留目录供检查。

单元测试命令见 [开发文档](development.md#测试与检查)。此脚本不验证安装/卸载或真实账户重新授权，这些行为需独立实测。
