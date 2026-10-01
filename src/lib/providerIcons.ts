// One icon per provider: any image file dropped into src/assets/providers/<provider>/
// becomes that provider's mark, with `app.*` winning when a folder holds several.
const modules = import.meta.glob<string>("../assets/providers/*/*.{svg,png,webp,gif,jpg,jpeg}", { eager: true, import: "default" });
const byFolder = new Map<string, { path: string; url: string }[]>();
for (const [path, url] of Object.entries(modules)) {
  const parts = path.split("/");
  const folder = parts[parts.length - 2];
  if (!folder) continue;
  const files = byFolder.get(folder) ?? [];
  files.push({ path, url });
  byFolder.set(folder, files);
}
const icons = new Map<string, string>();
for (const [folder, files] of byFolder) {
  const pick = files.find(file => /\/app\.[^.]+$/.test(file.path)) ?? files[0];
  icons.set(folder, pick.url);
}
/** The provider's icon URL, or null when no file has been dropped in yet. */
export function providerIcon(providerId: string): string | null {
  return icons.get(providerId) ?? null;
}
