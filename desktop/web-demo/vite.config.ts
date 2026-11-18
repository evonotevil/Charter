import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "../package.json";

interface PublishedRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

// Pages builds the downloads and the desktop update feed from the same Release.
// Local previews can also run offline using the desktop package version.
const snapshot = process.env.CHARTER_SITE_RELEASE;
const release: PublishedRelease | undefined = snapshot ? JSON.parse(readFileSync(snapshot, "utf8")) : undefined;
const releases = "https://github.com/evonotevil/Charter/releases";
const tag = release ? release.tag_name : `v${pkg.version}`;
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Invalid release tag: ${tag}`);
const version = tag.slice(1);
function asset(name: string) {
  return release
    ? release.assets.find((file) => file.name === name)?.browser_download_url
    : `${releases}/download/${tag}/${name}`;
}

const platforms = [
  { name: "Mac", options: [["Apple 芯片", "Mac-arm64.dmg"], ["Intel 芯片", "Mac-x64.dmg"]] },
  { name: "Windows", options: [["安装版", "Windows-Setup.exe"], ["免安装版", "Windows-x64.zip"]] },
].map(({ name, options }) => ({
  name,
  options: options.flatMap(([label, suffix]) => {
    if (!release && suffix.endsWith(".zip")) return [];
    const url = asset(`Charter-${version}-${suffix}`);
    return url ? [{ label, url, format: suffix.split(".").pop()!.toUpperCase() }] : [];
  }),
})).filter(({ options }) => options.length > 0);
const checksums = asset("SHA256SUMS.txt");
if (!platforms.length || !checksums) throw new Error(`Missing installers or checksums for ${tag}`);
const downloads = { platforms, checksums, releaseUrl: release?.html_url ?? `${releases}/tag/${tag}` };
export type SiteDownloads = typeof downloads;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SITE_DOWNLOADS__: JSON.stringify(downloads),
    "import.meta.env.VITE_RELEASE_VERSION": JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      input: {
        site: fileURLToPath(new URL("./index.html", import.meta.url)),
        workspace: fileURLToPath(new URL("./workspace.html", import.meta.url)),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
});
