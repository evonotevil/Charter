// 导出图片、PDF 等“纸面”产物一律用浅色令牌——不跟随界面的深色模式。
// 直接从 styles.css 的第一个 :root 块读，设计系统改色时这里自动跟上。
import css from "./styles.css?raw";

let cache: Record<string, string> | null = null;
export function lightTokens(): Record<string, string> {
  if (cache) return cache;
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  cache = {};
  for (const m of root.matchAll(/--([\w-]+):\s*([^;]+);/g)) cache[m[1]] = m[2].trim();
  return cache;
}
/** 取浅色令牌，例如 tok("ink")。 */
export const tok = (name: string) => lightTokens()[name] ?? "#000000";
