<p align="center">
  <img src="public/quotapeek.svg" width="120" alt="QuotaPeek" />
</p>

<h1 align="center">QuotaPeek</h1>

<h3 align="center">All your AI limits at a glance.</h3>

<p align="center">
  Check AI quotas, balances, and reset times from a floating desktop sidebar.<br />
  Codex · WorkBuddy · ZCode · DeepSeek
</p>

<p align="center">
  <a href="https://github.com/LiDe2000/QuotaPeek/releases">Download</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#download-and-use">Quickstart</a> ·
  <a href="#develop-from-source">Develop</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.12%2B-5FA04E?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 22.12+" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/Tauri-2.12-24C8D8?style=flat-square&amp;logo=tauri&amp;logoColor=white" alt="Tauri 2.12" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square" alt="Platform: Windows" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-A3BE8C?style=flat-square" alt="License: MIT" /></a>
</p>

Built with React, TypeScript, and Tauri 2. Primarily targets Windows; other platforms have not been tested on actual devices.

## Features

- View quotas or balances for Codex, WorkBuddy, ZCode, and DeepSeek.
- Switch between accounts grouped by provider and save account selections and provider order.
- Hover to preview cached data, click to refresh, or refresh all accounts.
- Keep the last result on query failure and show the error and last successful update time.
- Open a provider from the arrow next to its name: on Windows, launch the installed desktop app first (DeepSeek Harness for DeepSeek), then use the official web page if unavailable. Codex falls back to ChatGPT, DeepSeek to its Harness page, WorkBuddy to its web workspace, and ZCode to downloads. This uses the target app's current login; it does not switch accounts. Other platforms use the web page.
- Adapt card height and expansion direction, with five themes (Dark, Light, Dimmed, Warm, and Navy) and system tray controls.
- Adjust the whole interface from 75% to 150% in Appearance; the saved scale applies to the sidebar, cards, and native window bounds. Reset restores 100%.

## Screenshots

<table align="center">
  <tr>
    <td align="center" width="225">
      <strong>Sidebar</strong><br /><br />
      <img src="docs/images/sidebar.png" width="67" alt="Collapsed sidebar with provider quota rings" /><br /><br />
    </td>
    <td align="center" width="225">
      <strong>Expands to the right</strong><br /><br />
      <img src="docs/images/main-panel-right.png" width="186" alt="Main panel expanded to the right of the sidebar" /><br /><br />
    </td>
    <td align="center" width="225">
      <strong>Expands to the left</strong><br /><br />
      <img src="docs/images/main-panel-left.png" width="187" alt="Main panel expanded to the left of the sidebar" /><br /><br />
    </td>
    <td align="center" width="225">
      <strong>Hover preview</strong><br /><br />
      <img src="docs/images/hover-preview.png" width="241" alt="Quota or balance preview shown on hover" /><br /><br />
    </td>
  </tr>
</table>

<table align="center">
  <tr>
    <td align="center" width="300">
      <strong>Login</strong><br /><br />
      <img src="docs/images/login-panel.png" width="172" alt="Connect account panel with provider selection" /><br /><br />
    </td>
    <td align="center" width="300">
      <strong>Appearance</strong><br /><br />
      <img src="docs/images/appearance-panel.png" width="185" alt="Theme selection and interface scale settings" /><br /><br />
    </td>
    <td align="center" width="300">
      <strong>Activities</strong><br /><br />
      <img src="docs/images/activities-panel.png" width="362" alt="Activity panel with reward claim status" /><br /><br />
    </td>
  </tr>
</table>

## Supported services

| Service | Data | Connection |
| --- | --- | --- |
| Codex | Quota windows, remaining percentages, reset times | ChatGPT login in a local Codex installation; one local account |
| WorkBuddy | Credits, plan details, expiration times | Browser authorization; multiple accounts |
| ZCode | Quota balances, usage percentages, quota details | Browser authorization; multiple Z.ai and BigModel accounts |
| DeepSeek | Total, recharge, and promotional balances; cumulative spending | Browser login; multiple accounts. Existing API key accounts can still refresh |

Missing values remain unknown; quotas and cumulative spending are not inferred. Codex API key login does not support subscription quota queries.

## Download and use

### Download and run

Download an asset for your architecture from [GitHub Releases](https://github.com/LiDe2000/QuotaPeek/releases). If no assets are available, build from source.

| Distribution | Usage |
| --- | --- |
| Portable `quotapeek.exe` | Place it in a writable folder and run it. To upgrade, replace the exe and keep the adjacent `data/` folder |
| Installer `*-setup.exe` or `.msi` | Run the installer, then launch from the Start menu or shortcut |

Release builds do not require Node.js, Rust/Cargo, or build tools. Windows requires the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section).

### Connect accounts

1. Click **＋** in the sidebar and choose a service.
2. Follow the browser authorization or login prompts. For Codex, install and sign in locally first.
3. View the result after connecting. Accounts are restored and queried when the app starts again.

DeepSeek uses a platform account login by default and does not require an API key. Hiding the connection panel does not cancel login; use its cancel action to stop the process.

### Everyday controls

| Action | Result |
| --- | --- |
| Hover / click a provider icon | Preview cached data / refresh the selected account |
| Click the QuotaPeek icon | Open or collapse the main panel |
| Account tabs / numbered buttons in the preview | Switch accounts within a provider |
| **×** at the top right of a card | Confirm removal of the local connection, credentials, and cache |
| Main panel refresh button | Refresh all accounts |
| Hold a provider icon or tab for about half a second, then drag | Reorder providers; both views stay synchronized and save the order. Esc cancels |
| Focus a provider icon or tab, then press Alt + an arrow key | Reorder providers |
| Theme settings | Switch between Dark, Light, Dimmed, Warm, and Navy |
| Left-click / right-click the tray icon | Show the panel / open the show, hide, always-on-top, and quit menu |

Closing the window hides it to the tray. Use **Quit** in the tray menu to exit completely. Removing an account does not sign out of the provider website or local Codex; you can connect it again.

### Data and upgrades

| Distribution | Data folder |
| --- | --- |
| Portable | `data/` next to the exe |
| Installed | `%LOCALAPPDATA%/com.lide.quotapeek/` |

The folder contains `quotapeek.db` and `webview/`. Exit completely before backing up or moving the entire data folder. Windows credentials use current-user DPAPI encryption and usually require reauthorization on another computer or Windows account. Codex manages its own login. See [Data storage](docs/storage.md).

## Develop from source

### Requirements

- Node.js 22.12 or later, npm, and Git.
- [Rust/rustup](https://rust-lang.org/tools/install/), including `rustc` and `cargo`. Use the stable MSVC toolchain on Windows.
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**, MSVC, and the Windows SDK.
- WebView2 Runtime. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform requirements.

On Windows, install Rust from PowerShell:

```powershell
winget install --id Rustlang.Rustup
```

Reopen your terminal or IDE after installation and verify:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

`npm ci` installs JavaScript dependencies only, not Rust/Cargo or system build tools.

### Get the source and run

```sh
git clone https://github.com/LiDe2000/QuotaPeek.git
cd QuotaPeek
npm ci
npm run tauri dev
```

The first run downloads and compiles Rust dependencies. `npm run dev` starts the browser UI only; native queries require the desktop app. Restart the desktop development process after changing Rust, Tauri configuration, or permissions.

### Check and build

```sh
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

`check` runs TypeScript checks and Clippy for all Rust targets and features; `build` builds the frontend only. Live service integration tests are ignored by default. See the [development guide](docs/development.md#测试与检查) for how to run them.

| Command | Output |
| --- | --- |
| `npm run tauri:build:portable` | `src-tauri/target/release/quotapeek.exe` with portable data paths |
| `npm run tauri:build:installed` | NSIS and MSI installers under `src-tauri/target/release/bundle/` with installed data paths |

Both builds overwrite the same release exe. Collect each distribution's output separately before publishing. Installer generation may download additional tools; see [Troubleshooting](docs/troubleshooting.md).

### Build release packages together

To build all three Windows x64 release assets together, double-click `build-release.cmd` in the project root, or run:

```powershell
.\build-release.ps1
```

The script reads the project version and collects the portable ZIP, NSIS `.exe` installer, and MSI installer in `release/<version>/`. It archives the portable exe before building the installed variant and excludes local account data. Existing assets for the same version are overwritten. The Windows development prerequisites above are required; if JavaScript dependencies are missing, the script runs `npm ci`. Installer tools may be downloaded by Tauri on the first build.

Use `.\build-release.ps1 -DryRun` to preview the commands without building, or `-OutputDirectory <path>` to choose another output folder.

## Documentation

The detailed guides are currently in Chinese.

| Document | Contents |
| --- | --- |
| [Development guide](docs/development.md) | Directory responsibilities, state flows, window implementation, testing, and extensions |
| [Interface scale design](docs/interface-scale.md) | Slider interaction, scale transitions, and native window stability |
| [Activity configuration](docs/activity-service.md) | Server-first configuration, local fallback, on-device execution, and mock testing |
| [Data storage](docs/storage.md) | Data paths, credential protection, database upgrades, and portable verification |
| [Troubleshooting](docs/troubleshooting.md) | Runtime, editor, build, and rendering issues |

## Feedback and contributions

Report problems through [Issues](https://github.com/LiDe2000/QuotaPeek/issues) or submit a pull request. Include your OS and app versions, reproduction steps, and errors. Remove credentials, authorization links, and sensitive log data before posting.

## License

[MIT License](LICENSE)
