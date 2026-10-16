// 数据文件统一格式：标准 JSON，两格缩进，末尾换行；值为 undefined 的字段省略。

export function toJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("数值无效，无法保存");
    return v;
  }, 2) + "\n";
}
