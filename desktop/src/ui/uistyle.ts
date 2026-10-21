// 界面风格：Charter 5（默认）/ 柔和 / 经典。只影响外观，按这台电脑记住（不进数据文件夹）。
// Charter 5 在结构上沿用柔和（票据、着色代码块、数字条），外观由 html[data-skin="grove"] 覆盖。
import type React from "react";

import { useSyncExternalStore } from "react";

export type UIStyle = "grove" | "soft" | "classic";
const key = "charter.uiStyle";
const listeners = new Set<() => void>();

function read(): UIStyle {
  try {
    // 5.0 首次启动：所有人切到新外观一次；之后尊重用户在设置里的选择。
    if (!localStorage.getItem("charter.v5")) { localStorage.setItem("charter.v5", "1"); localStorage.setItem(key, "grove"); return "grove"; }
    const v = localStorage.getItem(key);
    return v === "soft" || v === "classic" ? v : "grove";
  } catch { return "grove"; }
}
let current: UIStyle = read();
function apply(s: UIStyle) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.style = s === "classic" ? "classic" : "soft";
  if (s === "grove") document.documentElement.dataset.skin = "grove"; else delete document.documentElement.dataset.skin;
}
apply(current);

export function setUIStyle(s: UIStyle) {
  current = s;
  try { localStorage.setItem(key, s); } catch { /* 只在本次有效 */ }
  apply(s);
  listeners.forEach((l) => l());
}

export function useUIStyle(): UIStyle {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** 集团色的柔和铺底与文字色。 */
export const softBg = (c: string) => `color-mix(in srgb, ${c} 20%, var(--surface))`;
export const softInk = (c: string) => `color-mix(in srgb, ${c} 62%, var(--ink))`;

/** 当前是否柔和风格。界面在切换风格时整体重挂载（见 Shell），所以组件里直接读即可。 */
export const isSoft = () => current !== "classic";
/** 柔和结构（柔和与 Charter 5 都是）。 */
export const softLike = (s: UIStyle) => s !== "classic";
export const isGrove = () => current === "grove";

/** 柔和风格下，公司法域代码块用所属集团的浅底着色；经典风格或共用公司返回 undefined。 */
export function codeTint(color: string | null | undefined): React.CSSProperties | undefined {
  if (!isSoft() || !color) return undefined;
  return { background: softBg(color), color: softInk(color) };
}

/** 公司所属集团的柔和着色（法域代码块用）。 */
export function companyTint(store: { brandOf: (id: string) => any; brandColor: (g?: any) => string }, companyID: string): React.CSSProperties | undefined {
  if (!isSoft()) return undefined;
  const g = store.brandOf(companyID);
  return g ? codeTint(store.brandColor(g)) : undefined;
}

/** 票据式事项卡的左侧日期票根（只在柔和风格显示，经典风格由 CSS 隐藏）。 */
export function dueStubParts(due: string, today: string) {
  const [, m, d] = due.split("-").map(Number);
  const left = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return { day: String(d).padStart(2, "0"), month: `${m}月`, tone: left < 0 ? "bad" : left <= 30 ? "warn" : "" };
}

// MARK: 信息密度（与风格独立，按这台电脑记住）

export type Density = "comfortable" | "compact";
const dkey = "charter.density";
let density: Density = (() => { try { return localStorage.getItem(dkey) === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; } })();
if (typeof document !== "undefined") document.documentElement.dataset.density = density;
const dlisteners = new Set<() => void>();
export function setDensity(d: Density) {
  density = d;
  try { localStorage.setItem(dkey, d); } catch { /* 只在本次有效 */ }
  document.documentElement.dataset.density = d;
  dlisteners.forEach((l) => l());
}
export function useDensity(): Density {
  return useSyncExternalStore((l) => { dlisteners.add(l); return () => dlisteners.delete(l); }, () => density);
}
