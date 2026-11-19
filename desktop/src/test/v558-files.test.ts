import { describe, expect, it } from "vitest";
import { inboxResultFeedback, partialPacketFeedback } from "../screens/fileFeedback";

describe("5.5.8 文件反馈", () => {
  it("重复文件使用定稿文案和状态", () => {
    expect(inboxResultFeedback(3, 1)).toEqual({
      text: "已加入待整理 3 份，其中 1 份与已有文件重复。",
      kind: "duplicate",
    });
    expect(inboxResultFeedback(3, 0)).toEqual({
      text: "已加入待整理 3 份。",
      kind: "success",
    });
  });

  it("部分材料包去重后列出缺件", () => {
    expect(partialPacketFeedback(["公司章程", "公司章程", "董事名册"])).toBe(
      "已生成部分材料包，缺少公司章程、董事名册。",
    );
    expect(partialPacketFeedback(["", "  "])).toBeNull();
  });
});
