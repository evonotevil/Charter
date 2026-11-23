import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writePDF } from "../services/files";
import { writeFilingChecklistPDF } from "../services/filingChecklistPDF";
import { writePacketChecklistPDF } from "../services/packetChecklistPDF";
import { defaultWatermark, watermarkPDF } from "../services/watermark";

it("保留材料清单、水印、申报清单及档案 PDF 中的连字、数字和中文文本层", async () => {
  // 通过同一份生产用 HarfBuzz 和品牌字体覆盖真正的嵌入路径。
  vi.stubGlobal("fetch", async (url: string) => {
    const name = url.split("/").pop()!.split("?")[0];
    const file = readFileSync(new URL("../assets/fonts/" + name, import.meta.url));
    return new Response(new Uint8Array(file));
  });
  try {
    const text = "Confidential File office Affinity A19 Audit 1/2 中文";
    const directory = await writePacketChecklistPDF({
      company: "QA Company", purpose: "测试用途", day: "2026-11-23",
      files: [{ number: 1, fileName: "审阅版.pdf", issueText: "2026-11-23" }], missing: [],
      summary: { total: 1, watermarked: 1, watermarkText: text },
    });
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const marked = await watermarkPDF(await source.save(), text, { ...defaultWatermark(), style: "footer" }, { stripMeta: false });
    const fullArchive = await writePDF("材料", text, []);
    const filing = await writeFilingChecklistPDF({ rangeLabel: text, exportedOn: "2026-11-23", rows: [] });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const standardFontDataUrl = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
    for (const bytes of [directory, marked, fullArchive, filing]) {
      const pdf = await pdfjs.getDocument({ data: bytes, standardFontDataUrl }).promise;
      try {
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const words = content.items.map(item => "str" in item ? item.str : "").join(" ");
        expect(words).toContain(text);
      } finally { await pdf.destroy(); }
    }
  } finally { vi.unstubAllGlobals(); }
});
