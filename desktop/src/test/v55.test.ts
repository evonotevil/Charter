// 5.5：材料包水印。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument, degrees } from "pdf-lib";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { buildPacket, packetBaseName, packetItems } from "../services/packets";
import { defaultWatermark, englishDate, fitSize, inspectPDF, kindOf, layout, resolveText, watermarkPDF } from "../services/watermark";
import { englishDocName } from "../domain/docnames";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function fresh() {
  const p = new MemoryPlatform(templates); setPlatform(p);
  const s = new Store("/Charter"); await s.load(); await installSampleData(s);
  return { p, s };
}
const ctx = { day: "2026-11-10", fileName: "商业登记证", fileNameEn: "Business Registration Certificate", company: "远澜控股（香港）有限公司", packet: "银行开户", recipient: "汇丰银行" };
async function realPDF(rotate = 0) { const d = await PDFDocument.create(); const pg = d.addPage([595, 842]); pg.setRotation(degrees(rotate)); d.setTitle("机密标题"); d.setAuthor("张三"); return d.save(); }

describe("5.5 水印文字", () => {
  it("中文：中日韩之间不加空格，空标签跳过", () => {
    expect(resolveText(defaultWatermark(), ctx)).toBe("汇丰银行专用 2026-11-10 仅供指定用途使用");
    expect(resolveText({ lang: "zh", parts: [{ kind: "tag", tag: "recipient" }, { kind: "text", text: "专用" }] }, { ...ctx, recipient: "" })).toBe("专用");
  });
  it("英文：日期 10 Nov 2026，文件名称用英文类型名", () => {
    expect(englishDate("2026-11-10")).toBe("10 Nov 2026");
    expect(resolveText({ lang: "en", parts: [{ kind: "text", text: "For" }, { kind: "tag", tag: "recipient" }, { kind: "tag", tag: "file" }, { kind: "tag", tag: "date" }] }, { ...ctx, recipient: "HSBC" }))
      .toBe("For HSBC Business Registration Certificate 10 Nov 2026");
    expect(englishDocName("商业登记证")).toBe("Business Registration Certificate");
    expect(englishDocName("自建类型")).toBe("自建类型");
  });
  it("文件种类与 PDF 检查", () => {
    expect(kindOf("/a/b.PDF")).toBe("pdf"); expect(kindOf("x.heic")).toBe("image"); expect(kindOf("x.docx")).toBe("other");
    const enc = new TextEncoder();
    expect(inspectPDF(enc.encode("%PDF-1.7 /ByteRange[0 1 2 3] /Type /Sig"))).toEqual({ signed: true, encrypted: false });
    expect(inspectPDF(enc.encode("%PDF-1.7 trailer << /Encrypt 5 0 R >>"))).toEqual({ signed: false, encrypted: true });
  });
  it("排版：平铺铺满整页，居中一处，页脚一行且不超出页宽", () => {
    expect(layout("tile", 595, 842, 200, 24, -30).length).toBeGreaterThan(6);
    expect(layout("center", 595, 842, 200, 24, -30)).toHaveLength(1);
    const f = layout("footer", 595, 842, 200, 10, 0); expect(f).toHaveLength(1); expect(f[0].y).toBeLessThan(60);
    expect(fitSize("footer", 595, 842, 10, 40, 0) * 10).toBeLessThanOrEqual(595);
  });
});

describe("5.5 PDF 水印", () => {
  it("加水印、清元数据、处理旋转页", async () => {
    await fresh();
    for (const r of [0, 90]) {
      const out = await watermarkPDF(await realPDF(r), "HSBC only 10 Nov 2026", defaultWatermark(), { stripMeta: true });
      const d = await PDFDocument.load(out);
      expect(d.getPageCount()).toBe(1);
      expect(d.getTitle() ?? "").toBe(""); expect(d.getAuthor() ?? "").toBe("");
      expect(out.length).toBeGreaterThan(1000);
    }
  });
});

describe("5.5 材料包导出", () => {
  it("文件名带接收方；目录注明水印；坏 PDF 不让整包失败；写发送记录", async () => {
    const { p, s } = await fresh();
    const c = s.data.companies.find((x) => x.name === "远澜控股（香港）有限公司")!;
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const items = packetItems(t, c, s);
    const first = items.find((i) => i.included && i.document)!;
    await p.writeBytes(s.fileURL(first.document!), await realPDF());
    const zip = await buildPacket(items, t, c, s, { watermark: { wm: { enabled: true, settings: { ...defaultWatermark(), parts: [{ kind: "text", text: "For" }, { kind: "tag", tag: "date" }] , lang: "en" }, skip: [], stripMeta: true }, recipient: "汇丰银行" } });
    expect(zip).toContain("_银行开户_汇丰银行_");
    expect(zip.split("/").pop()!.startsWith(packetBaseName(c, t, s, true, "汇丰银行"))).toBe(true);
    const names = Object.keys((await JSZip.loadAsync(await p.readBytes(zip))).files).filter((n) => !n.endsWith("/"));
    expect(names.length).toBe(1 + items.filter((i) => i.included && i.document).length);
    const rec = s.data.sends[0];
    expect(rec.companyID).toBe(c.id); expect(rec.recipient).toBe("汇丰银行"); expect(rec.watermarkText).toBe(`For ${(await import("../services/watermark")).englishDate(s.today)}`);
    expect(rec.watermarked).toBeGreaterThanOrEqual(1); expect(rec.path).toBe(zip);
  });
  it("可取消", async () => {
    const { s } = await fresh();
    const c = s.data.companies.find((x) => x.name === "远澜控股（香港）有限公司")!;
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const ac = new AbortController(); ac.abort();
    await expect(buildPacket(packetItems(t, c, s), t, c, s, { signal: ac.signal })).rejects.toThrow();
    expect(s.data.sends).toHaveLength(0);
  });
  it("不加水印时文件名不带接收方", async () => {
    const { s } = await fresh();
    const c = s.data.companies.find((x) => x.name === "远澜控股（香港）有限公司")!;
    const t = s.data.library.packets.find((x) => x.name === "银行开户")!;
    const zip = await buildPacket(packetItems(t, c, s), t, c, s, { watermark: { wm: { enabled: false, settings: defaultWatermark(), skip: [], stripMeta: false }, recipient: "汇丰银行" } });
    expect(zip).not.toContain("汇丰银行");
  });
});
