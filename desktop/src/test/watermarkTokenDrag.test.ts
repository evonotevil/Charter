import { describe, expect, it } from "vitest";
import { watermarkDropIndex } from "../screens/useWatermarkTokenDrag";

const slot = (index: number, left: number, width: number, centerY: number) => ({ index, left, width, centerY });
const initial = [slot(0, 10, 72, 25), slot(1, 90, 130, 25), slot(2, 228, 80, 25), slot(3, 10, 138, 65)];

describe("水印标签换位", () => {
  it("越过同排中点时换位，短标签的新占位区内保持目标位置", () => {
    expect(watermarkDropIndex(initial, 0, 152, 25)).toBe(0);
    expect(watermarkDropIndex(initial, 0, 157, 25)).toBe(1);
    const shifted = [slot(1, 10, 130, 25), slot(0, 148, 72, 25), ...initial.slice(2)];
    expect(watermarkDropIndex(shifted, 0, 156, 25)).toBe(1);
    expect(watermarkDropIndex(shifted, 0, 152, 25)).toBe(1);
  });
  it("跨行按行内中点插入，末行空白可追加，往前也能回到行首", () => {
    expect(watermarkDropIndex(initial, 1, 40, 65)).toBe(2);
    expect(watermarkDropIndex(initial, 1, 270, 66)).toBe(3);
    expect(watermarkDropIndex(initial, 3, 15, 24)).toBe(0);
  });
  it("最后一行只有原占位时，指针移到两侧仍落在该行", () => {
    expect(watermarkDropIndex(initial, 3, 1, 65)).toBe(3);
    expect(watermarkDropIndex(initial, 3, 300, 65)).toBe(3);
  });
});
