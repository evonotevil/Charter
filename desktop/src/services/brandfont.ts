// 5.5：随包附带的思源黑体（Noto Sans SC Medium，SIL OFL 1.1），用于水印与目录 PDF，Mac 和 Windows 效果一致。
// 嵌入 PDF 前用 HarfBuzz（hb-subset.wasm）只取用到的字形；pdf-lib 自带的子集功能对大型中文字体会丢字。

import fontURL from "../assets/fonts/NotoSansSC-Medium.ttf?url";
import wasmURL from "../assets/fonts/hb-subset.wasm?url";

let font: Promise<Uint8Array | null> | null = null;
/** 完整字体（约 10 MB），第一次用到时载入。拿不到（比如在测试环境）时为 null。 */
export function brandFont(): Promise<Uint8Array | null> {
  font ??= fetch(fontURL).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
  return font;
}

type HB = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
let hb: Promise<HB | null> | null = null;
function harfbuzz(): Promise<HB | null> {
  hb ??= (async () => {
    try {
      const r = await fetch(wasmURL); const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
      return instance.exports as unknown as HB;
    } catch { return null; }
  })();
  return hb;
}

/** 只包含 text 所需字形的 TrueType 字体；失败时返回 null。 */
export async function brandFontSubset(text: string): Promise<Uint8Array | null> {
  const [src, h] = await Promise.all([brandFont(), harfbuzz()]);
  if (!src || !h) return null;
  const input = h.hb_subset_input_create_or_fail(); if (!input) return null;
  const ptr = h.malloc(src.byteLength);
  new Uint8Array(h.memory.buffer).set(src, ptr);         // malloc 可能让内存增长，取视图要在 malloc 之后
  const blob = h.hb_blob_create(ptr, src.byteLength, 2, 0, 0);
  const face = h.hb_face_create(blob, 0); h.hb_blob_destroy(blob);
  const feats = h.hb_subset_input_set(input, 6); h.hb_set_clear(feats); h.hb_set_invert(feats);
  const uni = h.hb_subset_input_unicode_set(input);
  for (const c of text + " ") h.hb_set_add(uni, c.codePointAt(0)!);
  let out: Uint8Array | null = null;
  try {
    const sub = h.hb_subset_or_fail(face, input);
    if (sub) {
      const res = h.hb_face_reference_blob(sub);
      const off = h.hb_blob_get_data(res, 0), len = h.hb_blob_get_length(res);
      if (len) out = new Uint8Array(h.memory.buffer).slice(off, off + len);
      h.hb_blob_destroy(res); h.hb_face_destroy(sub);
    }
  } finally { h.hb_subset_input_destroy(input); h.hb_face_destroy(face); h.free(ptr); }
  return out;
}
