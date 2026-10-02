// Controlled Windows rendering comparisons; never writes the release config.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const flags = new Set(process.argv.slice(2));
const supported = new Set(['--fixed', '--stable', '--resize', '--software', '--redirection', '--opaque', '--print-config']);
for (const flag of flags) {
  if (!supported.has(flag)) {
    console.error(`Unknown option: ${flag}. Supported: ${[...supported].join(', ')}`);
    process.exit(1);
  }
}
const root = path.resolve(__dirname, '..');
if (['--fixed', '--stable', '--resize'].filter(flag => flags.has(flag)).length > 1) {
  console.error('Choose one geometry mode: --fixed, --stable, or --resize.');
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
// Tauri merge-patch replaces arrays, so retain every existing window property.
const windows = structuredClone(base.app.windows);
const main = windows.find(window => (window.label ?? 'main') === 'main');
if (!main) throw new Error('Main window is missing');
if (flags.has('--fixed')) Object.assign(main, { width: 474, height: 800, center: true });
if (flags.has('--redirection')) main.noRedirectionBitmap = false;
if (flags.has('--opaque')) main.transparent = false;
if (flags.has('--software')) {
  const software = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.software-rendering.conf.json'), 'utf8'));
  main.additionalBrowserArgs = software.app.windows[0].additionalBrowserArgs;
}
const config = { app: { windows } };
const fixed = flags.has('--fixed') ? '1' : '0';
const stable = flags.has('--resize') ? '0' : '1';
if (flags.has('--print-config')) {
  console.log(JSON.stringify({ config, VITE_QUOTAPEEK_FIXED_VIEWPORT: fixed, VITE_QUOTAPEEK_STABLE_VIEWPORT: stable }, null, 2));
} else {
  if (process.platform !== 'win32') throw new Error('These comparisons target Windows WebView2');
  console.log('Quit existing QuotaPeek and Vite dev processes before comparing modes.');
  console.log(`Rendering comparison: ${[...flags].join(' ') || 'stable (default)'}`);
  if (fixed === '1') console.log('Fixed viewport: unused transparent area also intercepts input. Diagnostic only.');
  // Invoke the existing CLI with an argument array, without cmd.exe quoting.
  const child = spawn(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'dev', '--config', JSON.stringify(config)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_QUOTAPEEK_FIXED_VIEWPORT: fixed, VITE_QUOTAPEEK_STABLE_VIEWPORT: stable },
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
