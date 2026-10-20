// 界面风格：经典 / 柔和。只影响外观，按这台电脑记住（不进数据文件夹）。
import type React from "react";

import { useSyncExternalStore } from "react";

export type UIStyle = "classic" | "soft";
const key = "charter.uiStyle";
const listeners = new Set<() => void>();

function read(): UIStyle { try { return localStorage.getItem(key) === "soft" ? "soft" : "classic"; } catch { return "classic"; } }
let current: UIStyle = read();
if (typeof document !== "undefined") document.documentElement.dataset.style = current;

export function setUIStyle(s: UIStyle) {
  current = s;
  try { localStorage.setItem(key, s); } catch { /* 只在本次有效 */ }
  document.documentElement.dataset.style = s;
  listeners.forEach((l) => l());
}

export function useUIStyle(): UIStyle {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** 集团色的柔和铺底与文字色。 */
export const softBg = (c: string) => `color-mix(in srgb, ${c} 20%, var(--surface))`;
export const softInk = (c: string) => `color-mix(in srgb, ${c} 62%, var(--ink))`;

/** 当前是否柔和风格。界面在切换风格时整体重挂载（见 Shell），所以组件里直接读即可。 */
export const isSoft = () => current === "soft";

/** 柔和风格下，公司法域代码块用所属集团的浅底着色；经典风格或共用公司返回 undefined。 */
export function codeTint(color: string | null | undefined): React.CSSProperties | undefined {
  if (current !== "soft" || !color) return undefined;
  return { background: softBg(color), color: softInk(color) };
}

/** 公司所属集团的柔和着色（法域代码块用）。 */
export function companyTint(store: { brandOf: (id: string) => any; brandColor: (g?: any) => string }, companyID: string): React.CSSProperties | undefined {
  if (current !== "soft") return undefined;
  const g = store.brandOf(companyID);
  return g ? codeTint(store.brandColor(g)) : undefined;
}

/** 票据式事项卡的左侧日期票根（只在柔和风格显示，经典风格由 CSS 隐藏）。 */
export function dueStubParts(due: string, today: string) {
  const [, m, d] = due.split("-").map(Number);
  const left = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return { day: String(d).padStart(2, "0"), month: `${m}月`, tone: left < 0 ? "bad" : left <= 30 ? "warn" : "" };
}
