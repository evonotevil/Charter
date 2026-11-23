import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { extract } from "../services/extract";
import { writeXLSX } from "../services/files";

let platform: MemoryPlatform;

beforeAll(() => { vi.stubGlobal("DOMParser", DOMParser); });
beforeEach(() => { platform = new MemoryPlatform("{}"); setPlatform(platform); });

async function workbook(path: string, files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  await platform.writeBytes(path, await zip.generateAsync({ type: "uint8array" }));
}

const book = {
  "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="摘要" sheetId="1" r:id="rId2"/><sheet name="人员" sheetId="2" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>公司</t></si><si><r><t>董事</t></r><r><t>姓名</t></r></si></sst>`,
  "xl/worksheets/sheet2.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><r><t>海港</t></r><r><t>有限公司</t></r></is></c></row><row r="3"><c r="A3"><f>1+1</f><v>2</v></c><c r="B3"><v>0</v></c><c r="C3" t="b"><v>0</v></c></row></sheetData></worksheet>`,
  "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="s"><v>1</v></c><c t="str"><f>CONCAT(\"王\",\"小明\")</f><v>王小明</v></c></row></sheetData></worksheet>`,
};

describe("XLSX 文字提取", () => {
  it("按工作簿顺序读取共享、富文本、内联、数字和公式缓存值", async () => {
    await workbook("/register.xlsx", book);
    await expect(extract("/register.xlsx")).resolves.toEqual({
      pages: ["摘要\n公司\t\t海港有限公司\n\n2\t0\tFALSE", "人员\n董事姓名\t王小明"],
      usedOCR: false,
    });
  });

  it("支持严格 OOXML 命名空间和上级相对关系路径", async () => {
    await workbook("/strict.xlsx", {
      "xl/workbook.xml": `<workbook xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main" xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"><sheets><sheet name="Strict" sheetId="1" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="x" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/../worksheets/sheet.xml"/></Relationships>`,
      "xl/worksheets/sheet.xml": `<worksheet xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main"><sheetData><row><c t="inlineStr"><is><t>有效</t></is></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/strict.xlsx")).pages).toEqual(["Strict\n有效"]);
  });

  it("接受包根绝对工作表路径，并忽略外部关系", async () => {
    await workbook("/root-target.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="本地" r:id="local"/><sheet name="外部" r:id="external"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="local" Type="worksheet" Target="/xl/worksheets/a.xml"/><Relationship Id="external" Type="worksheet" Target="https://example.com/a.xml" TargetMode="External"/></Relationships>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row><c t="inlineStr"><is><t>本机内容</t></is></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/root-target.xlsx")).pages).toEqual(["本地\n本机内容"]);
  });

  it("读取 Charter 自己生成的目录工作簿", async () => {
    await platform.writeBytes("/directory.xlsx", await writeXLSX("文件目录", [["编号", "文件"], ["01", "公司章程.pdf"]]));
    expect((await extract("/directory.xlsx")).pages).toEqual(["文件目录\n编号\t文件\n01\t公司章程.pdf"]);
  });

  it("只把带日期样式或 ISO 日期类型的单元格转换成日历日期", async () => {
    await workbook("/dates.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="日期" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="x" Type="worksheet" Target="worksheets/a.xml"/><Relationship Id="styles" Type="styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row><c r="A1" s="1"><v>45292</v></c><c r="B1"><v>45292</v></c><c r="C1" s="2"><v>45293</v></c><c r="D1" t="d"><v>2026-11-20T10:30:00Z</v></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/dates.xlsx")).pages).toEqual(["日期\n2024-01-01\t45292\t2024-01-02\t2026-11-20"]);
  });

  it("空缓存值不冒充共享文字或日期，纯时间样式不转换成日期", async () => {
    await workbook("/empty-values.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="值" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="x" Type="worksheet" Target="worksheets/a.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>不应出现</t></si></sst>`,
      "xl/styles.xml": `<styleSheet><cellXfs><xf numFmtId="14"/><xf numFmtId="18"/><xf numFmtId="32"/></cellXfs></styleSheet>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row><c r="A1" t="s"><v/></c><c r="B1" s="0"><f>TODAY()</f><v> </v></c><c r="C1" s="1"><v>0.5</v></c><c r="D1" s="2"><v>0.75</v></c><c r="E1" s="0"><f>TODAY()</f></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/empty-values.xlsx")).pages).toEqual(["值\n\t\t0.5\t0.75"]);
  });

  it("忽略共享文字中的拼音标注，并限制稀疏行的空行", async () => {
    await workbook("/phonetic.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="名称" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="x" Type="worksheet" Target="worksheets/a.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>公司</t><rPh sb="0" eb="2"><t>gong si</t></rPh></si></sst>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c></row><row r="1048576"><c t="inlineStr"><is><t>末行</t></is></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/phonetic.xlsx")).pages).toEqual(["名称\n公司\n\n末行"]);
  });

  it("支持 1904 日期系统", async () => {
    await workbook("/date1904.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="true"/><sheets><sheet name="日期" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="x" Type="worksheet" Target="worksheets/a.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row><c s="0"><v>43830</v></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/date1904.xlsx")).pages).toEqual(["日期\n2024-01-01"]);
  });

  it("空白、损坏和超大文件安全返回空文字", async () => {
    await workbook("/empty.xlsx", { "xl/workbook.xml": "<workbook/>" });
    await platform.writeBytes("/broken.xlsx", new Uint8Array([0, 1, 2, 3]));
    await platform.writeBytes("/huge.xlsx", new Uint8Array(64 * 1024 * 1024 + 1));
    await expect(extract("/empty.xlsx")).resolves.toEqual({ pages: [""], usedOCR: false });
    await expect(extract("/broken.xlsx")).resolves.toEqual({ pages: [""], usedOCR: false });
    await expect(extract("/huge.xlsx")).resolves.toEqual({ pages: [""], usedOCR: false });
  });

  it("整份工作簿最多保留 20 万字符", async () => {
    await workbook("/large.xlsx", {
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="长表" r:id="x"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="x" Type="worksheet" Target="worksheets/a.xml"/></Relationships>`,
      "xl/worksheets/a.xml": `<worksheet><sheetData><row><c t="inlineStr"><is><t>${"字".repeat(200_100)}</t></is></c></row></sheetData></worksheet>`,
    });
    expect((await extract("/large.xlsx")).pages[0]).toHaveLength(200_000);
  });
});
