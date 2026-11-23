export type FileFeedbackKind = "success" | "duplicate" | "failure";

export function inboxResultFeedback(added: number, duplicates: number, unsupported = 0, failed = 0, saveFailed = 0): { text: string; kind: FileFeedbackKind } {
  if (!added) {
    const details = [
      unsupported ? `${unsupported} 份格式暂不支持` : "",
      failed ? `${failed} 份没有读入` : "",
      saveFailed ? `${saveFailed} 份还没保存，请在备份与恢复里重试保存` : "",
    ].filter(Boolean).join("，");
    return {
      text: details ? `没有加入文件：${details}。` : "没有找到可加入的文件。",
      kind: "failure",
    };
  }
  const skipped = [
    unsupported ? `${unsupported} 份格式暂不支持` : "",
    failed ? `${failed} 份没有读入` : "",
    saveFailed ? `${saveFailed} 份还没保存，请在备份与恢复里重试保存` : "",
  ].filter(Boolean);
  return {
    text: `已加入待整理 ${added} 份${duplicates ? `，其中 ${duplicates} 份与已有文件重复` : ""}${skipped.length ? `；${skipped.join("，")}` : ""}。`,
    kind: skipped.length ? "failure" : duplicates ? "duplicate" : "success",
  };
}

export function partialPacketFeedback(titles: string[]): string | null {
  const missing = [...new Set(titles.map((title) => title.trim()).filter(Boolean))];
  return missing.length ? `已生成部分材料包，缺少${missing.join("、")}。` : null;
}
