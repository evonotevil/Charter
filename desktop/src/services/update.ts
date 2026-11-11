// 5.5.5：检查更新。读取 GitHub Releases 的最新版本（版本号、日期、发布说明），不上传任何档案数据。
import { DOWNLOAD_PAGE_URL, UPDATE_FEED_URL, UPDATE_FALLBACK_URL } from "../config/update";
import { platform } from "../platform/platform";

export type UpdateInfo = { version: string; date?: string; notes: string[]; fullNotes: string; url: string };
export type UpdateState =
  | { kind: "idle" } | { kind: "checking" } | { kind: "latest"; at: number } | { kind: "available"; at: number; info: UpdateInfo }
  | { kind: "error"; at: number; message: string } | { kind: "noURL" };

export const currentVersion = () => (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0");
const AUTO = "update.auto", LAST = "update.last", SKIP = "update.skip", LATER = "update.later";

/** 比较版本号：a > b 返回正数。忽略前缀 v 和预发布后缀。 */
export function compareVersions(a: string, b: string): number {
  const n = (v: string) => v.replace(/^v/i, "").split(/[-+]/)[0].split(".").map((x) => parseInt(x, 10) || 0);
  const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

/** 从发布说明里取要点：Markdown 列表项（- 或 *），去掉格式符号；最多 6 条。 */
export function releaseBullets(body: string): string[] {
  return body.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim()).filter(Boolean).slice(0, 6);
}

export function parseRelease(json: unknown): UpdateInfo {
  const r = json as { tag_name?: string; name?: string; body?: string; html_url?: string; published_at?: string };
  if (!r || typeof r.tag_name !== "string") throw new Error("更新服务器返回的内容无法识别。");
  const body = r.body ?? "";
  return { version: r.tag_name.replace(/^v/i, ""), date: r.published_at?.slice(0, 10), notes: releaseBullets(body), fullNotes: body, url: DOWNLOAD_PAGE_URL || r.html_url || "" };
}

let state: UpdateState = { kind: UPDATE_FEED_URL ? "idle" : "noURL" };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
export const updateState = () => state;
export const subscribeUpdate = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const autoCheckOn = () => platform().prefGet(AUTO) !== "0";
export const setAutoCheck = (on: boolean) => { platform().prefSet(AUTO, on ? "1" : "0"); emit(); };
export const lastCheck = (): number | null => { const v = platform().prefGet(LAST); return v ? Number(v) : null; };

/** 侧栏是否显示“有新版本”：发现了更新，且没有被跳过、也不在“稍后提醒”期间。 */
export function showUpdateBadge(): boolean {
  if (state.kind !== "available") return false;
  const p = platform();
  if (p.prefGet(SKIP) === state.info.version) return false;
  const later = Number(p.prefGet(LATER) ?? 0);
  return Date.now() > later;
}
export function skipVersion(v: string) { platform().prefSet(SKIP, v); emit(); }
export function remindLater(days = 3) { platform().prefSet(LATER, String(Date.now() + days * 864e5)); emit(); }

export async function checkForUpdate(opts: { fetcher?: typeof fetch } = {}): Promise<UpdateState> {
  if (!UPDATE_FEED_URL && !opts.fetcher) { state = { kind: "noURL" }; emit(); return state; }
  state = { kind: "checking" }; emit();
  const at = Date.now();
  try {
    const readRelease = async (url: string) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await (opts.fetcher ?? fetch)(url, { signal: ctl.signal, headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
        if (!r.ok) throw new Error(`更新服务器返回 ${r.status}。`);
        return parseRelease(await r.json());
      } finally { clearTimeout(t); }
    };
    let info: UpdateInfo;
    try { info = await readRelease(UPDATE_FEED_URL || "about:blank"); }
    catch (e) {
      if (!UPDATE_FALLBACK_URL) throw e;
      info = await readRelease(UPDATE_FALLBACK_URL);
    }
    platform().prefSet(LAST, String(at));
    state = compareVersions(info.version, currentVersion()) > 0 ? { kind: "available", at, info } : { kind: "latest", at };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    state = { kind: "error", at, message: /abort|network|fetch/i.test(m) ? "无法连接更新服务器：网络不可用或请求超时。" : m };
  }
  emit();
  return state;
}

/** 启动时自动检查：打开了开关、已设置地址、距上次检查超过一天。 */
export function autoCheckOnLaunch() {
  if (!UPDATE_FEED_URL || !autoCheckOn()) return;
  const last = lastCheck();
  if (last && Date.now() - last < 864e5) return;
  void checkForUpdate();
}
