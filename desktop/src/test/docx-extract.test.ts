import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { extract } from "../services/extract";

let platform: MemoryPlatform;

beforeAll(() => { vi.stubGlobal("DOMParser", DOMParser); });

beforeEach(() => {
  platform = new MemoryPlatform("{}");
  setPlatform(platform);
});

async function writeDocx(path: string, documentXml?: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types />");
  if (documentXml !== undefined) zip.file("word/document.xml", documentXml);
  await platform.writeBytes(path, await zip.generateAsync({ type: "uint8array" }));
}

describe("DOCX 文字提取", () => {
  it("读取段落、换行、制表符、表格和 XML 实体", async () => {
    const xml = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>",
      "<w:p><w:r><w:t/></w:r><!-- 不算正文 --><w:r><w:t>董事会</w:t></w:r>",
      "<w:fldSimple w:instr=\"PAGE\"><w:r><w:instrText>字段代码不算正文</w:instrText></w:r></w:fldSimple>",
      "<w:r><w:t xml:space=\"preserve\"> 决议 &amp; 批准</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>第一行</w:t><w:br/><w:t>第二行</w:t><w:tab/><w:t>&#x4E09;</w:t></w:r></w:p>",
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc>",
      "<w:tc><w:p><w:r><w:t>职务</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
      "</w:body></w:document>",
    ].join("");
    await writeDocx("/three.docx", xml);

    const result = await extract("/three.docx");

    expect(result.usedOCR).toBe(false);
    expect(result.pages).toEqual(["董事会 决议 & 批准\n第一行\n第二行\t三\n姓名\t职务"]);
  });

  it("没有正文或损坏的 DOCX 返回空文字，供待整理继续按文件名判断", async () => {
    await writeDocx("/empty.docx");
    await platform.writeBytes("/broken.docx", new Uint8Array([0, 1, 2, 3]));

    await expect(extract("/empty.docx")).resolves.toEqual({ pages: [""], usedOCR: false });
    await expect(extract("/broken.docx")).resolves.toEqual({ pages: [""], usedOCR: false });
  });

  it("正文最多提取 20 万字符", async () => {
    const text = "字".repeat(200_100);
    await writeDocx("/large.docx", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);

    const result = await extract("/large.docx");

    expect(result.pages[0]).toHaveLength(200_000);
  });
});
