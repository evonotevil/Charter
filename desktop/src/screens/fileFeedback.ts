export type FileFeedbackKind = "success" | "duplicate";

export function inboxResultFeedback(added: number, duplicates: number): { text: string; kind: FileFeedbackKind } {
  return {
    text: `已加入待整理 ${added} 份${duplicates ? `，其中 ${duplicates} 份与已有文件重复` : ""}。`,
    kind: duplicates ? "duplicate" : "success",
  };
}

export function partialPacketFeedback(titles: string[]): string | null {
  const missing = [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
  return missing.length ? `已生成部分材料包，缺少${missing.join("、")}。` : null;
}
