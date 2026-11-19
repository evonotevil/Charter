// 5.5.6 入门教程的演示模式：示例档案只放在内存里，不写磁盘。结束或退出后重新载入，回到真实的数据文件夹。

import { MemoryPlatform } from "../platform/memory";
import type { Platform } from "../platform/platform";

const seenKey = "tourSeen";
const requestKey = "tourRequested";

let demo = false;
let realPlatform: Platform | null = null;
export const isDemo = () => demo;
export const setRealPlatform = (p: Platform) => { realPlatform = p; };
const real = () => realPlatform!;

/** 演示用的平台：文件只在内存里；选择文件、保存位置、复制数据文件夹都不可用；系统、设备名沿用真实平台。 */
export class DemoPlatform extends MemoryPlatform {
  override readonly os: Platform["os"];
  override readonly arch: Platform["arch"];
  constructor(private real: Platform, templates: string) {
    super(templates);
    this.os = real.os;
    this.arch = real.arch;
    (this as { copyTree?: unknown }).copyTree = undefined;
    (this as { cloudKind?: unknown }).cloudKind = undefined;
  }
  override async deviceName() { return this.real.deviceName(); }
  override async openURL(url: string) { return this.real.openURL(url); }
  override async pickFiles() { return [] as string[]; }
  override async pickFolder() { return null; }
  override async saveDialog() { return null; }
  override async notify() { /* 演示中不发通知 */ }
}

/** 启动时决定是否进入演示：数据文件夹是空的且这台电脑没看过，或在设置里点了“重新看教程”。 */
export async function shouldStartTour(real: Platform, root: string): Promise<boolean> {
  if (real.os === "web") return typeof location !== "undefined" && new URLSearchParams(location.search).has("tour");
  if (real.prefGet(requestKey)) { real.prefSet(requestKey, null); return true; }
  if (real.prefGet(seenKey)) return false;
  try { return !(await real.stat(real.join(root, "charter.json"))).exists; } catch { return false; }
}
export function enterDemo() { demo = true; }
/** 看完或跳过：记下已看过，重新载入回到真实档案。 */
export function finishTour() { real().prefSet(seenKey, "1"); location.reload(); }
/** 设置里“重新看教程”。 */
export function requestTour(p: Platform) { p.prefSet(requestKey, "1"); location.reload(); }
