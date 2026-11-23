import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { writePacketChecklistPDF, type PacketChecklistData } from "../services/packetChecklistPDF";

const font = new Uint8Array(readFileSync(new URL("../assets/fonts/NotoSansSC-Medium.ttf", import.meta.url)));

function checklistPlatform() {
  return Object.assign(new MemoryPlatform("{}"), { cjkFont: async () => font });
}

const materials = [
  "公司注册证明书", "董事名册", "成员登记册", "董事会决议", "商业登记证", "股权结构说明", "注册办事处地址证明", "授权签字人名册",
  "业务概况及经营范围", "法定代表人任命书", "管理层声明", "英文登记摘要", "最终受益人声明（含跨境控股架构中间层、投票权特别安排及经批准的最新董事会授权条款说明）",
  "董事会会议通知", "相关交易备案", "资本结构调整摘要", "股份登记册核对表", "受托持股事项说明", "董事服务协议", "业务持续性计划",
  "运营主体与关联公司之间的长期采购框架协议及年度补充条款变更记录（中英文签署本）", "尽职调查确认函", "登记机关书面确认", "最新税务登记材料",
  "关联方交易摘要", "银行开户决议", "保险证明", "年度经营报告", "已发行股份明细", "集团主要联系人", "对外授权补充说明", "当地经营许可证",
];

function stress(): PacketChecklistData {
  return {
    company: "澄川示例国际控股与区域营运管理有限公司 Chengchuan Example International Holdings and Regional Operations Management Limited",
    purpose: "跨境年度审阅",
    day: "2026年11月20日",
    files: materials.map((name, index) => ({
      number: index + 1,
      fileName: `${name}.${index === 5 || index === 15 ? "xlsx" : "pdf"}`,
      issueText: index % 7 === 6 ? "未注明" : "2026-03-09",
      warning: index === 5 || index === 15 ? "原样放入 · 无法加水印或清除文件信息" : undefined,
    })),
    missing: ["签署授权书", "年度申报回执", "审计报告", "地址证明更新件", "委托事项确认书", "税务申报回执", "主要股东声明", "合并财务报表"].map((title) => ({ title, reason: "还没有这份文件" })),
    summary: { total: 32, watermarked: 30, cleaned: 30, watermarkText: "仅供年度审阅 2026-11-20" },
  };
}

describe("材料包目录 PDF", () => {
  it("长公司名、32 份文件、8 项缺件稳定排成两页", async () => {
    setPlatform(checklistPlatform());
    const bytes = await writePacketChecklistPDF(stress());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toContain("跨境年度审阅材料清单");
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
  });

  it("短清单留在一页", async () => {
    setPlatform(checklistPlatform());
    const data = stress();
    data.company = "澄川示例有限公司";
    data.purpose = "年度审计";
    data.files = data.files.slice(0, 4).map((item) => ({ ...item, warning: undefined }));
    data.missing = data.missing.slice(0, 2);
    data.summary = undefined;
    const pdf = await PDFDocument.load(await writePacketChecklistPDF(data));
    expect(pdf.getPageCount()).toBe(1);
  });
});
