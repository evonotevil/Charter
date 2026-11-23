import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { FilingChecklistRow } from "../domain/filingChecklist";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { writeFilingChecklistPDF } from "../services/filingChecklistPDF";

const font = new Uint8Array(readFileSync(new URL("../assets/fonts/NotoSansSC-Medium.ttf", import.meta.url)));

function pdfPlatform() {
  return Object.assign(new MemoryPlatform("{}"), { cjkFont: async () => font });
}

function tag(index: number) {
  return String.fromCharCode(65 + Math.floor(index / 26)) + String.fromCharCode(65 + index % 26);
}

async function pageTexts(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  await pdf.destroy();
  return pages;
}

function row(index: number, due = "2026-11-30"): FilingChecklistRow {
  return {
    due,
    company: `COMPANY${tag(index)} 澄川示例有限公司`,
    jurisdiction: index % 2 ? "新加坡" : "香港",
    filing: `FILING${tag(index)} 年度申报事项`,
    agent: index % 3 ? "远岸公司秘书" : "Harbor Vale, Corporate Services",
    dateConfirmed: index % 2 === 0,
    overdue: index % 9 === 0,
  };
}

describe("申报日历清单 PDF", () => {
  it("空清单明确显示范围、导出日和空状态", async () => {
    setPlatform(pdfPlatform());
    const bytes = await writeFilingChecklistPDF({ rangeLabel: "未来 30 天", exportedOn: "2026-11-20", rows: [] });
    const pdf = await PDFDocument.load(bytes);
    const text = (await pageTexts(bytes)).join(" ");
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("申报日历清单");
    expect(text).toContain("未来 30 天");
    expect(text).toContain("导出日 2026-11-20");
    expect(text).toContain("共 0 件");
    expect(text).toContain("当前范围没有申报事项");
    expect(text).toContain("1 / 1");
  });

  it("长中英文公司名、事项和中介换行后不丢内容", async () => {
    setPlatform(pdfPlatform());
    const long = row(1);
    long.company = "LONGCOMPANY 青木国际企业服务与跨境管理咨询有限公司 Aoki International Corporate Reporting Services and Cross-border Management Consulting (Asia Pacific) Limited COMPANYTAILALPHA";
    long.filing = "年度审计与跨境经营信息披露补充材料确认 Annual filing and cross-border operating disclosure supplement FILINGTAILALPHA";
    long.agent = Array.from({ length: 90 }, () => "AGENTBLOCK North Point Advisory Services").join(" ") + " AGENTTAILALPHA";
    long.dateConfirmed = false;
    const bytes = await writeFilingChecklistPDF({ rangeLabel: "即将到期", exportedOn: "2026-11-20", rows: [long] });
    const pages = await pageTexts(bytes);
    const joined = pages.join(" ").replace(/\s+/g, "");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("LONGCOMPANY");
    expect(joined).toContain("COMPANYTAILALPHA");
    expect(joined).toContain("FILINGTAILALPHA");
    expect(joined).toContain("AGENTTAILALPHA");
    expect(joined).toContain("AsiaPacific");
    expect(joined).toContain("新加坡·");
    expect(joined).toContain("日期推算");
  });

  it("跨页时重复表头和月份，且不拆开普通条目", async () => {
    setPlatform(pdfPlatform());
    const rows = Array.from({ length: 36 }, (_, index) => row(index,
      index < 18 ? "2026-11-30" : index < 28 ? "2026-12-15" : "2027-01-08"));
    // 另外覆盖导出日当天的独立状态。
    rows[1] = { ...rows[1], due: "2026-11-20", overdue: false };
    const bytes = await writeFilingChecklistPDF({ rangeLabel: "全部申报事项", exportedOn: "2026-11-20", rows });
    const pdf = await PDFDocument.load(bytes);
    const pages = await pageTexts(bytes);
    expect(pdf.getPageCount()).toBe(3);
    for (const [index, text] of pages.entries()) {
      expect(text).toContain("截止日");
      expect(text).toMatch(/20\d{2}年\d+月/);
      expect(text).toContain(`${index + 1} / ${pages.length}`);
      if (index) expect(text).not.toContain("推算日期尚待确认");
    }
    expect(pages.join(" ")).toContain("今日截止");
    for (let index = 0; index < rows.length; index++) {
      const company = `COMPANY${tag(index)}`;
      const filing = `FILING${tag(index)}`;
      const companyPage = pages.findIndex((text) => text.includes(company));
      const filingPage = pages.findIndex((text) => text.includes(filing));
      expect(companyPage, company).toBeGreaterThanOrEqual(0);
      expect(filingPage, filing).toBe(companyPage);
    }
  });
});
