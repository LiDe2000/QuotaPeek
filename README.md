# QuotaPeek
All your AI limits at a glance.

## 前端项目结构

前端使用 React + TypeScript + Vite，由 Tauri 承载为桌面应用。目前展示模拟账户额度，支持账户翻页与主题切换，尚未接入真实额度查询。

```text
src/
├─ components/
│  ├─ AddAccount.tsx           # 选择平台、输入邮箱与添加演示账户
│  ├─ AddAccount.css           # 添加账户面板样式
│  ├─ AccountCard.tsx          # 账户信息、额度进度条和重置时间展示
│  ├─ AccountCard.css          # 账户卡片样式
│  ├─ AppearanceSettings.tsx   # 主题选择交互和面板焦点管理
│  ├─ AppearanceSettings.css   # 外观设置面板样式
│  └─ Icon.tsx                 # 共用 SVG 图标
├─ hooks/
│  └─ useAppearance.ts         # 主题状态、读取、保存和应用，以及 Theme 类型
├─ mocks/
│  └─ quotas.ts                # Codex、Claude 模拟账户及额度数据
├─ styles/
│  ├─ tokens.css               # 字体、字号、间距、尺寸、圆角和动画变量
│  ├─ themes.css               # 三套主题配色、平台配色和主题预览色
│  └─ global.css               # 样式入口、全局基础规则和共用按钮样式
├─ types/
│  └─ quota.ts                 # Account、QuotaLimit 和 ProviderId 共享类型
├─ App.tsx                     # 页面组装、账户轮播、设置开关及外观 hook 调用
├─ App.css                     # 窗口、工具栏、轮播、分页和页脚样式
├─ main.tsx                    # React 挂载入口，引入全局样式
└─ vite-env.d.ts               # Vite 环境类型声明
```

### 组件与数据

- `App.tsx` 读取 `mocks/quotas.ts` 中的模拟数据，通过 props 传给 `AccountCard`，并管理按钮、键盘和滑动翻页。
- `types/quota.ts` 定义共享的 `Account`、`QuotaLimit` 和 `ProviderId` 类型，卡片组件与模拟数据共同引用，数据层无需依赖展示组件。
- `AccountCard.tsx` 负责展示账户和额度。账户的 `id` 是唯一标识，用于 React key、分页标签和面板关联；`providerId` 标识平台，用于选择平台配色。同一平台的多个账户应使用不同的 `id`，并共享同一个 `providerId`。
- `AppearanceSettings.tsx` 通过 props 接收当前主题，通过回调通知主题变更和面板关闭。
- `App.tsx` 调用 `useAppearance()` 获取 `theme` 和 `setTheme`。该 hook 统一读取 `localStorage` 中的 `quotapeek-theme`，将主题应用到根元素的 `data-theme` 属性，并保存选择。未保存、值无效或读取失败时默认使用 `dark`；保存失败时仍可切换主题。
- 轮播根据当前页码动态计算位移，通过用户图标添加账户即可增加页面，无需新增每一页的位移样式。
- 刷新按钮目前仅触发演示动画与计数，不会请求真实账户数据；重置时间和倒计时文字也是模拟值。

### 添加账户（前端演示）

初始账户列表为空，不显示账户卡片或分页，刷新按钮禁用。点击顶部用户图标，选择 OpenAI Codex 或 Claude，再输入邮箱并点击 `Add demo account`。新增账户会使用所选平台的模拟额度，并自动切换到对应卡片。同平台重复邮箱会提示，不同平台可使用相同邮箱。

此流程不执行真实登录或查询，也不收集密码；新增账户仅保存在当前页面内存中，重新加载应用后恢复空账户列表。添加面板支持 Escape 关闭，关闭后焦点返回用户图标；账户面板与外观面板互斥显示。

### 样式约定

- `main.tsx` 引入 `global.css`，后者统一引入 `tokens.css` 和 `themes.css`。
- 字体、字号及通用尺寸优先在 `tokens.css` 调整；各级字号使用 `rem`，可通过根字号统一缩放。
- 主题颜色在 `themes.css` 中维护，通过 `data-theme="classic"`、`"dark"` 或 `"light"` 切换，默认使用深色主题。
- 页面布局写在 `App.css`，组件专属样式放在同名 CSS 文件中，并由对应组件引入。这些是普通 CSS，选择器仍具有全局作用域。

以上记录当前已实现的结构。接入真实额度时可复用共享类型，按需添加接口与查询状态管理；新增平台时需同步扩展 `ProviderId` 和 `themes.css` 中的平台配色。字体、字号目前通过 CSS 变量配置，尚未提供设置面板交互或持久化逻辑。
