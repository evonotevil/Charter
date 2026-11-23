import { describe, expect, it } from "vitest";
import { filingChecklistCSV, type FilingChecklistRow } from "../domain/filingChecklist";

const exportedOn = "2026-11-20";
const header = "\uFEFF截止日,公司,法域,事项,中介,截止日确认状态,到期状态";
const base: FilingChecklistRow = {
  due: exportedOn, company: "星桥", jurisdiction: "香港", filing: "利得税报税表",
  agent: "", dateConfirmed: false, overdue: false,
};

describe("申报清单 CSV", () => {
  it("空范围仍保留中文七列表头和 UTF-8 BOM", () => {
    expect(filingChecklistCSV([], exportedOn)).toBe(header);
  });

  it("保留清单顺序，分开表示截止日是否确认和是否逾期", () => {
    const csv = filingChecklistCSV([
      { ...base, due: "2026-11-19", overdue: true },
      { ...base, dateConfirmed: true },
      { ...base, due: "2027-01-01" },
    ], exportedOn);
    expect(csv.split("\r\n")).toEqual([
      header,
      '"2026-11-19","星桥","香港","利得税报税表","","推算","已逾期"',
      '"2026-11-20","星桥","香港","利得税报税表","","已确认","今日截止"',
      '"2027-01-01","星桥","香港","利得税报税表","","推算","未到期"',
    ]);
  });

  it("公司名和中介名中的逗号、双引号与换行都留在同一单元格", () => {
    const csv = filingChecklistCSV([{ ...base, company: '星桥, "Asia"', agent: "North\r\nPoint" }], exportedOn);
    expect(csv).toBe(header + '\r\n"2026-11-20","星桥, ""Asia""","香港","利得税报税表","North\r\nPoint","推算","今日截止"');
  });
});
