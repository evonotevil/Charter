import { afterEach, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { checkForUpdate, currentVersion, parseRelease, selectReleaseDownload } from "../services/update";
import { DemoPlatform } from "../state/demo";

afterEach(() => vi.unstubAllGlobals());

const assets = [
  { name: "Charter-99.0.0-Mac-arm64.dmg", browser_download_url: "https://github.com/evonotevil/Charter/releases/download/v99.0.0/Charter-99.0.0-Mac-arm64.dmg" },
  { name: "Charter-99.0.0-Mac-x64.dmg", browser_download_url: "https://github.com/evonotevil/Charter/releases/download/v99.0.0/Charter-99.0.0-Mac-x64.dmg" },
  { name: "Charter-99.0.0-Windows-Setup.exe", browser_download_url: "https://github.com/evonotevil/Charter/releases/download/v99.0.0/Charter-99.0.0-Windows-Setup.exe" },
];

it("checks the public Charter feed and selects this Mac's installer", async () => {
  const platform = new MemoryPlatform("{}");
  Object.defineProperties(platform, { os: { value: "mac" }, arch: { value: "arm64" } });
  setPlatform(platform);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    tag_name: "v99.0.0", body: "- 新功能", html_url: "https://example.invalid/placeholder", assets,
  })));
  vi.stubGlobal("fetch", fetcher);
  const result = await checkForUpdate();
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.github.com/repos/evonotevil/Charter/releases/latest",
    expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
  );
  expect(result.kind).toBe("available");
  if (result.kind === "available") {
    expect(result.info.url).toBe(assets[0].browser_download_url);
  }
});

it("selects the exact Intel Mac or Windows installer and rejects untrusted assets", () => {
  expect(selectReleaseDownload("99.0.0", assets, { os: "mac", arch: "x64" })).toBe(assets[1].browser_download_url);
  expect(selectReleaseDownload("99.0.0", assets, { os: "windows", arch: "x64" })).toBe(assets[2].browser_download_url);
  expect(selectReleaseDownload("99.0.0", assets, { os: "windows", arch: "arm64" })).toBe("");
  expect(selectReleaseDownload("99.0.0", [{ name: assets[2].name, browser_download_url: "https://example.invalid/malware.exe" }], { os: "windows", arch: "x64" })).toBe("");
  expect(selectReleaseDownload("99.0.0", [{ name: assets[2].name, browser_download_url: "https://github.com/evonotevil/Charter/releases/download/v98.0.0/Charter-99.0.0-Windows-Setup.exe" }], { os: "windows", arch: "x64" })).toBe("");
});

it("keeps the update visible when its matching installer is missing", () => {
  expect(parseRelease({ tag_name: "v99.0.0", body: "- 新功能", assets: [] }, { os: "mac", arch: "arm64" })).toMatchObject({ version: "99.0.0", url: "" });
});

it("keeps the real architecture and download action during the tutorial", async () => {
  const real = new MemoryPlatform("{}");
  Object.defineProperties(real, { os: { value: "mac" }, arch: { value: "arm64" } });
  let opened = "";
  real.openURL = async (url) => { opened = url; };
  const demo = new DemoPlatform(real, "{}");
  expect(demo.arch).toBe("arm64");
  await demo.openURL(assets[0].browser_download_url!);
  expect(opened).toBe(assets[0].browser_download_url);
});

it("reports latest when the feed returns the installed version", async () => {
  setPlatform(new MemoryPlatform("{}"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    tag_name: `v${currentVersion()}`, body: "",
  }))));
  expect((await checkForUpdate()).kind).toBe("latest");
});

it("uses the public website mirror if GitHub rate limits the request", async () => {
  setPlatform(new MemoryPlatform("{}"));
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response("rate limited", { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v99.0.0", body: "- 新功能" })));
  vi.stubGlobal("fetch", fetcher);
  expect((await checkForUpdate()).kind).toBe("available");
  expect(fetcher).toHaveBeenNthCalledWith(2,
    "https://evonotevil.github.io/Charter/update.json", expect.objectContaining({ cache: "no-store" }));
});

it("shows an error when neither update endpoint is reachable", async () => {
  setPlatform(new MemoryPlatform("{}"));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
  expect(await checkForUpdate()).toMatchObject({ kind: "error", message: expect.stringContaining("网络不可用") });
});
