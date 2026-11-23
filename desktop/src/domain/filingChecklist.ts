import type { Day } from "./day";

export interface FilingChecklistRow {
  due: Day;
  company: string;
  jurisdiction: string;
  filing: string;
  agent: string;
  dateConfirmed: boolean;
  overdue: boolean;
}

export function filingDueStatus(row: FilingChecklistRow, exportedOn: Day): string {
  if (row.overdue) return "已逾期";
  return row.due === exportedOn ? "今日截止" : "未到期";
}

/** UTF-8 BOM 和 CRLF 方便桌面表格软件直接读取。 */
export function filingChecklistCSV(rows: FilingChecklistRow[], exportedOn: Day): string {
  const lines = ["截止日,公司,法域,事项,中介,截止日确认状态,到期状态"];
  for (const row of rows) {
    const fields = [
      row.due, row.company, row.jurisdiction, row.filing, row.agent,
      row.dateConfirmed ? "已确认" : "推算", filingDueStatus(row, exportedOn),
    ];
    lines.push(fields.map(value => '"' + value.replace(/"/g, '""') + '"').join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}
