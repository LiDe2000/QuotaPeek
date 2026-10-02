# SQLite 与便携数据目录

此实现采用已确认的 SQLite 方案，不导入本机旧 JSON 或 localStorage。

## 数据位置

- 默认便携模式：根据运行 exe 的绝对路径，使用同级 `data/quotapeek.db` 和 `data/webview/`。
- 安装版通过 `installed` 编译特性选择 Tauri 的 `app_local_data_dir()`，Windows 对应 `%LOCALAPPDATA%/com.lide.quotapeek/`。也支持便携 exe 的 `--installed` 启动参数。
- 两种模式均先确认数据库可用，再创建 WebView；不可写或数据库版本过新时明确报错，禁止静默换目录。
- 开发构建也使用 exe 同级目录，因此不会写入发布版本的数据。

## 存储边界

Rust 后端统一管理 accounts、credentials、quota_cache、settings、schema_migrations。前端启动时先加载数据库，再挂载 React；后续更新串行保存，失败显示在应用内。当前账户与各供应商的选中账户以同一个设置事务保存。

账户 ID 和排序保持稳定。各服务额度结构继续保存为 JSON，查询时间单独存列。凭据与账户公开元数据通过一个事务更新。公开元数据仅保留显示、身份和站点字段，不含令牌或 API Key。

| 表 | 主要字段与关联 |
| --- | --- |
| accounts | id 主键、namespace、provider_id、public_auth JSON、position、创建与更新时间 |
| credentials | account_id 外键、protection 版本标记、payload 密文 BLOB、更新时间 |
| quota_cache | account_id 外键、fetched_at、format_version、payload JSON |
| settings | key 主键、value；主题和账户选择与设备标识采用不同 key |
| schema_migrations | version 主键、applied_at；与 user_version 同事务推进 |

新增供应商通常无需改表：定义 namespace、供应商数据类型和公开元数据字段即可。新增设置无需改表，在后端 UI 设置白名单注册 key。需要新的列、索引或表时，在 MIGRATIONS 末尾追加 SQL；当前 schema 版本自动取升级步骤数量，不手动修改旧步骤。credentials 与 quota_cache 的外键启用级联删除，供今后账户删除功能同步清理关联数据。

Windows 使用当前用户范围 DPAPI，密文 BLOB 存在 credentials 中。其他平台在尚无安全存储实现时拒绝保存凭据，不回退为明文。账户列表不依赖解密，因此跨电脑或跨用户打开数据库仍可看到账户；查询提示重新授权，重新登录覆盖该账户凭据。Codex 授权始终由外部 Codex 管理。

## 后续升级与移动

数据库使用 application_id 和 user_version 识别格式，顺序执行版本化 SQL，并记录 schema_migrations。已有版本升级前通过 SQLite backup API 保存版本备份，升级及版本号更新在事务中一起提交。重复启动不会重跑已完成升级；失败回滚，版本过新拒绝打开，禁止清空或降级。

版本备份先写临时文件，成功后再改为 `quotapeek.db.v<旧版本>.bak`。已有同版本备份保留，并先检查其完整性、application_id 和版本号；备份不完整时停止升级，保留原库。

初始两次升级分别创建账户、凭据、设置表以及额度缓存表，验证已有数据库的升级路径。今后改表新增升级步骤，保留现有步骤不变。

采用 DELETE 日志模式和短事务，适合当前低频读写；正常完全退出后可复制整个目录。关闭窗口只隐藏到托盘，搬迁前必须从托盘退出。替换 exe 保留 data 目录；跨机器保留设置与额度缓存，Windows 凭据通常需重新授权。

额度缓存有独立 format_version，不支持的缓存格式跳过，后续成功查询再写入可读格式；不影响凭据和设置。备用软件渲染模式的 WebView 配置不同，因此在 webview 目录内使用独立子目录，SQLite 数据库保持一致。

## 实施与验证

1. 存储层：路径定位、SQLite 事务、版本备份、失败回滚和拒绝未来版本测试。
2. 服务接入：四类授权入口和设备 ID 改用数据库；凭据加密、账户顺序和重新授权测试。
3. 前端接入：启动加载、设置与缓存串行保存，验证重启恢复及写入失败后的重试。
4. 运行 Rust 和前端测试、前端构建及 Windows 桌面构建；记录验证限制。

便携构建：`npm run tauri:build:portable`。安装包构建：`npm run tauri:build:installed`。默认 Tauri 配置关闭安装包，安装版使用 `tauri.installed.conf.json` 开启 NSIS/MSI。两个命令生成的 exe 路径相同、数据策略不同，发布时分别收集对应产物。

Windows 便携启动验证：构建后运行 `powershell -ExecutionPolicy Bypass -File scripts/verify-portable-storage.ps1`。脚本在工作区 `.tmp/` 下创建隔离副本，从不同的工作目录启动，写入合成数据后移动整个应用目录再启动，并通过数据库触发器确认 React 已读取原主题和账户选择、经 IPC 保存缓存。合成凭据在解密阶段失败，不执行实际账户网络查询；测试进程结束后关闭，目录保留供检查。

2026-10-02 验证结果：前端 66 项测试通过，Rust 53 项通过、2 项真实服务集成测试按默认设置跳过；前端构建、便携 release exe 构建和 `installed` 特性编译检查通过。正常 Windows 权限下的实际便携启动、IPC 保存、目录移动和重启恢复通过。沙箱中 WebView2 未完成启动，因此实际启动验证使用正常权限。安装包生成、安装/卸载与真实账户重新授权尚未实测；DPAPI、无法解密时重新保存、稳定账户排序和迁移回滚使用合成数据测试。
