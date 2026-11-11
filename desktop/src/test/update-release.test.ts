import { afterEach, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { checkForUpdate, currentVersion } from "../services/update";

afterEach(() => vi.unstubAllGlobals());

it("checks the public Charter feed and opens the real download page", async () => {
  setPlatform(new MemoryPlatform("{}"));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    tag_name: "v99.0.0", body: "- 新功能", html_url: "https://example.invalid/placeholder",
  })));
  vi.stubGlobal("fetch", fetcher);
  const result = await checkForUpdate();
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.github.com/repos/evonotevil/Charter/releases/latest",
    expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
  );
  expect(result.kind).toBe("available");
  if (result.kind === "available") {
    expect(result.info.url).toBe("https://github.com/evonotevil/Charter/releases/latest");
  }
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
