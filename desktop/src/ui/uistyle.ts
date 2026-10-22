// 外观偏好：只剩信息密度（舒适 / 紧凑），按这台电脑记住，不进数据文件夹。
// 5.1 起只有一种界面风格；集团色只出现在徽章描边和小圆点上，卡片与节点始终是白底。

import type React from "react";
import { useSyncExternalStore } from "react";

/** 法域徽章：用集团色描一圈细边，底色不变。 */
export function groupRing(color: string | null | undefined): React.CSSProperties | undefined {
  return color ? ({ "--g": color } as React.CSSProperties) : undefined;
}

/** 公司所属集团的徽章描边。共用公司或未分组返回 undefined。 */
export function companyTint(store: { brandOf: (id: string) => any; brandColor: (g?: any) => string }, companyID: string): React.CSSProperties | undefined {
  const g = store.brandOf(companyID);
  return g ? groupRing(store.brandColor(g)) : undefined;
}

/** 日期票根的日、月与紧急程度。 */
export function dueStubParts(due: string, today: string) {
  const [, m, d] = due.split("-").map(Number);
  const left = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return { day: String(d).padStart(2, "0"), month: `${m}月`, tone: left < 0 ? "bad" : left <= 30 ? "warn" : "" };
}

export type Density = "comfortable" | "compact";
const dkey = "charter.density";
let density: Density = (() => { try { return localStorage.getItem(dkey) === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; } })();
if (typeof document !== "undefined") {
  document.documentElement.dataset.density = density;
  // 清掉 5.0 及以前的风格标记
  delete document.documentElement.dataset.style; delete document.documentElement.dataset.skin;
  try { localStorage.removeItem("charter.uiStyle"); const t = localStorage.getItem("charter.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch { /* 忽略 */ }
}
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
