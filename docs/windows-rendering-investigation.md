# Windows 闪烁排查：2026-10-02

[返回排障文档](troubleshooting.md)

## 当前判断

目前最有力的解释是：**应用反复改变透明原生窗口的高度，触发 Windows / WebView2 GPU 呈现路径上的短暂空帧或旧帧。** 用户先后反馈 `--fixed` 和保留左右自适应/裁剪的 `--stable` 模式暂未闪烁，进一步把主要触发条件缩小到原生尺寸变化。这不是已经确认的某个 WebView2 或显卡驱动缺陷。

Windows 默认开发和正式构建现已采用稳定视口：保留 GPU 渲染与左右自适应，原生宽高保持稳定，可见裁剪区域随内容更新。无需更换框架，也不依赖禁用 GPU。用户反馈属于当前设备上的初步验证，仍需观察长期运行、跨显示器和 DPI 切换。

## 已有证据与边界

| 证据 | 可以支持的判断 | 不能证明的事情 |
| --- | --- | --- |
| 用户反馈普通 `tauri dev` 和打包 exe 都闪 | 不像只发生在 Vite HMR / React 开发检查中的问题 | 不能排除共同的前端布局逻辑 |
| 用户反馈 `tauri:software` 不闪 | GPU 呈现路径是重要变量 | 不能区分 WebView2、DWM、驱动与应用更新时序；软件模式也改变时序 |
| 本次用户实测 `tauri:diagnose -- --fixed` 暂未闪烁 | 保留 GPU 与透明窗口，停用应用自动几何更新后改善，进一步指向该更新路径 | 尚未区分原生 resize 与 region 更新；需更长时间验证 |
| 随后用户反馈 `tauri:diagnose -- --stable` 暂未闪烁 | 保留 GPU、左右自适应和 region 更新，稳定原生尺寸后改善，支持原生高度变化是主要触发条件 | 不能保证其他设备或跨屏/DPI 变化时也无闪烁 |
| 既有录屏中侧栏与卡片一起消失、露出桌面 | 更符合整窗/合成层丢帧，不像只切换卡片内容 | 本次没有获得新的逐帧录屏，不能声称已独立逐帧验证修复效果 |
| 两份 Tauri 配置只在 `additionalBrowserArgs` 上不同 | 软件对照没有改变透明、裁剪或自适应设计 | 参数是否在运行进程中实际生效仍需完全退出旧进程后验证 |

本次读取了项目代码、本机 Cargo 中实际使用的 Wry/Tao 源码、配置 schema 和系统注册表，并检查了现有 debug 窗口。单帧窗口截图无法确认短暂闪帧，单元测试也无法验证 DWM 最终呈现。

## 修复前的源码定位

### 1. “固定视口”只固定了宽度，高度与区域仍在改变

原实现中，`src/hooks/useFittedWindowHeight.ts` 的 `stableViewport` 为 Windows 预留 474 逻辑像素左右的宽度，但每次卡片自然高度变化仍会把 `size.height` 作为原生高度传给 `fit_window_bounds`。悬停不同供应商时，卡片本身高度、顶部偏移和状态文字均可能改变高度。新实现将它作为 `visibleHeight`，原生高度单独预留。

因此，“已经固定了宽度”不等于“没有原生 resize”。展开/收起即使不改变宽度，也会改变 `visibleWidth`，继而更新窗口区域。

### 2. 原生边界与 WebView 画面不是原子提交

`src-tauri/src/window_bounds.rs` 先调用 `SetWindowPos`，再调用 `SetWindowRgn`。把移动和缩放合并进一次 `SetWindowPos`，只能消除应用自己分两次更新几何的中间状态，不能同时提交 WebView2 的下一帧。

本机锁定版本为 Wry 0.57.0、Tao 0.37.1、tauri-runtime-wry 2.12.1。Wry 的 `src/webview2/mod.rs` 中，`parent_subclass_proc` 在收到 `WM_SIZE` 后调用 WebView2 `SetBounds`，并使用 `SWP_ASYNCWINDOWPOS` 更新其宿主子窗口。这里没有等待浏览器合成帧呈现的逻辑。应用收到命令成功，只说明原生操作已执行。

这与既有录屏里“整窗消失 → 底部裁剪 → 完整恢复”的顺序相容，但仍只是机制上的解释。

### 3. 裁剪区域更新还有应用侧风险

每次有效的 `fit_window_bounds` 都创建并设置 region，Rust 端没有判断区域本身是否已相同。例如窗口移动导致一次拟合时，可能重设相同 region。前端的尺寸去重不能替代原生 region 去重。

同时，当前调用为 `SetWindowRgn(hwnd, Some(region), false)`，关闭重绘后没有显式安排后续重绘。微软建议可见窗口通常使用 `TRUE`；文档也明确此 API 会发送 `WM_WINDOWPOSCHANGING` / `WM_WINDOWPOSCHANGED`。因此 region 更新并不是纯粹修改一个裁剪数值。[微软 SetWindowRgn 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)

这两点值得后续修正和验证，但还没有证据证明把 `false` 改成 `true` 就能消除整窗闪烁。贸然强制重绘也不能同步 Chromium 与 DWM。本次保留原生行为，先建立可比较的基线。

### 4. `noRedirectionBitmap` 不是通用的防闪开关

Tauri 的说明是避免透明窗口创建、WebView 内容尚未绘制时的白闪，不是保证动态 resize 不闪。本机 schema 与公开文档一致。[Tauri 配置说明](https://v2.tauri.app/reference/config/#windowconfig)

其他采用 DirectComposition 的框架也有“调整尺寸时短暂透出后方内容”的报告，例如 [Avalonia #9103](https://github.com/AvaloniaUI/Avalonia/issues/9103)。这是同类机制的旁证，不是 QuotaPeek 命中同一缺陷的证明。

### 5. 未找到悬停时主动隐藏整窗的路径

主窗口 `hide()` 位于托盘隐藏与关闭转隐藏逻辑。悬停 hook 只改变预览状态；账户切换动画只作用于卡片内部子元素，不把侧栏或根节点透明度置零。`ResizeObserver` 的回调通过帧调度与串行提交合并，已有回归也验证无变化时不重复提交。

因此，目前没有代码证据支持“悬停误调用了 hide”或“React 每次刷新主动清空整个窗口”。这不排除布局变化触发原生呈现问题。

## 可运行的对照

每次先从托盘 **Quit** 退出所有 QuotaPeek，并停止之前的 Vite/Tauri 开发进程。普通关闭只隐藏窗口。比较时不要拖动窗口，不改变显示器和缩放，重复相同的悬停、展开/收起、账户切换操作。浏览器参数不同的实例不要共用正在使用的数据目录。

`scripts/diagnose-rendering.cjs` 读取当前主配置生成内存覆盖，完整保留窗口数组属性，不修改正式配置或系统设置。参数可组合，建议先只改变一个变量：

| 命令 | 对照变量 | 结果如何解释 |
| --- | --- | --- |
| `npm run tauri:diagnose` | 当前默认稳定视口 | 验证默认方案 |
| `npm run tauri:diagnose -- --resize` | 恢复旧的原生高度随内容变化 | 与默认稳定视口比较；初始排查时的默认基线现由此入口保留 |
| `npm run tauri:diagnose -- --fixed` | 固定 474 × 800 视口，停止应用自动尺寸、位置与 region 更新；仍使用 GPU、透明窗口和原有 React/CSS | 若不闪，强烈指向动态原生几何更新；尚不能区分 resize 与 region |
| `npm run tauri:diagnose -- --stable` | 显式选择当前默认方案，原生高度预留至工作区高度减 80，仅内容可见高度变化 | 用户已反馈暂未闪烁 |
| `npm run tauri:diagnose -- --redirection` | 只将 `noRedirectionBitmap` 设为 false | 若不闪，说明该窗口样式与当前呈现路径有关；还需检查启动白闪 |
| `npm run tauri:diagnose -- --opaque` | 只将 `transparent` 设为 false | 若不闪，透明呈现是重要条件；外观会有不透明底色 |
| `npm run tauri:diagnose -- --software` | 与现有软件渲染入口相同的参数 | 再确认 GPU 对照结果 |
| `npm run tauri:diagnose -- --fixed --software` | 固定视口的 GPU/软件二次比较 | 固定视口仍闪、加软件参数后消失，则不能只归因于应用自动 resize/region |

固定视口仅供开发诊断：空白透明部分仍拦截鼠标，超出视口的卡片内部滚动，不做贴边自适应。小屏幕请以完整可见的区域进行比较。它由 `import.meta.env.DEV` 限制，正式构建不会意外启用。不要把诊断布局当作正式修复发布。

用户在固定模式下发现移到右边不会自动向左展开，这是停用定位的预期结果。`--stable` 恢复这一能力：窗口在同一显示器/DPI 下保留稳定宽高，`visibleHeight` 单独控制原生裁剪区域，未使用部分不拦截鼠标；拖动结束仍重新判断展开方向。跨显示器、DPI 或可用工作区变化仍可能需要调整视口。`--stable`、`--fixed`、`--resize` 三者互斥。稳定视口已成为默认及正式构建方案，停用拟合/恢复旧模式的覆盖仅对开发模式有效。`SetWindowRgn` 的重绘参数未改动，保持已测试的呈现路径。

可在任一命令后添加 `--print-config`，只查看配置而不启动应用。脚本不会清空 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 等外部环境覆盖；若已有额外参数，应先在当前终端排除这些覆盖，避免把带软件参数的启动误当 GPU 基线。

如果后续复发，应记录每组是否整窗消失、是否只是新卡片裁剪、复现次数，并尽量使用 60 fps 以上原始录屏。可比较 `--resize`、默认稳定视口与 `--fixed`，必要时记录原生消息并与录屏时间对齐；原生 region 更新也可能间接触发窗口消息，不能仅凭某一种模式闪烁就证明 region 本身存在缺陷。

## 软件渲染的 exe 临时入口

普通 `tauri build` 不会继承曾经运行过的 `tauri:software` 配置，这解释了初始排查时软件开发模式有效、普通 exe 仍使用 GPU 的差异。现在普通构建已采用稳定视口，软件模式仅保留作额外的兼容性回退。

```powershell
npm run tauri:build:software -- --no-bundle
.\src-tauri\target\release\quotapeek.exe
```

去掉 `--no-bundle` 可构建安装包。上述构建使用现有软件渲染覆盖，仍保留自适应窗口。它是兼容性规避，CPU/功耗影响尚未测量，Chromium 参数也不是长期兼容保证。重新执行 `npm run tauri -- build --no-bundle` 会生成默认渲染版本。

## 本机环境与验证边界

- Windows 注册表：25H2，build 26200.9457；旧 `ProductName` 字段仍写 Windows 10，不能据此误报操作系统代际。
- 已安装 WebView2 目录版本：154.0.4258.48；未把它当作当前运行进程版本的确认。
- 显示设备注册信息：AMD Radeon 780M Graphics，驱动 31.0.14064.1002；另有 OrayIddDriver 和 ToDesk 虚拟显示适配器注册项。未确认当前呈现使用哪个适配器，也没有证据归责于远程桌面软件或某个驱动。
- 59 项前端测试与生产前端构建通过。新增检查验证固定视口不调用原生拟合；稳定高度模式在展开/收起时保持原生尺寸、更新可见高度，并保留贴边与拖动处理。
- Rust 测试 42 项通过，2 项需要真实登录/网络的集成测试按默认设置跳过；新增可见高度参数通过编译。
- 初始排查期间曾构建软件渲染 release exe，后续默认构建会覆盖相同输出路径；识别产物时必须记录构建命令。
- 默认 `npm run tauri -- build --no-bundle` 已成功生成新的 `src-tauri/target/release/quotapeek.exe`，包含稳定视口，未加入禁用 GPU 参数。该新 exe 尚未单独启动实测。
- **当前状态：用户反馈稳定视口模式暂未闪烁，已将这一方案用于 Windows 默认开发和正式构建，保留 GPU 与左右自适应。主要触发条件定位到原生高度变化；尚未确认具体底层缺陷，也未完成所有硬件/跨屏场景验证。**
