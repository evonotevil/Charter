import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { Store } from "../state/store";
import { installSampleData } from "../state/sample";
import { DueCompletionQueue, DueUndoTimer, dueCompletionDelay, dueUndoDuration } from "../screens/dueUndo";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
async function sample() {
  setPlatform(new MemoryPlatform(templates));
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  return store;
}

afterEach(() => vi.useRealTimers());

describe("5.5.8 申报日历撤销", () => {
  it("静默完成不会覆盖复制邮件反馈，并能恢复周期事项", async () => {
    const store = await sample();
    const o = store.openObligations.find((x) => x.rule.schedule.kind !== "event" && x.rule.schedule.kind !== "documentExpiry")!;
    const result = store.complete(o, undefined, { toast: false });
    store.showToast("邮件已复制。");
    expect(store.toast?.text).toBe("邮件已复制。");
    expect(store.openObligations.some((x) => x.key === o.key)).toBe(false);
    result.undo();
    expect(store.openObligations.some((x) => x.key === o.key)).toBe(true);
  });

  it("连续完成 A、B 时，最近一次撤销只恢复 B", async () => {
    const store = await sample();
    const [a, b] = store.openObligations.slice(0, 2);
    store.complete(a, undefined, { toast: false });
    const undoB = store.complete(b, undefined, { toast: false });
    undoB.undo();
    expect(store.openObligations.some((x) => x.key === a.key)).toBe(false);
    expect(store.openObligations.some((x) => x.key === b.key)).toBe(true);
  });

  it("倒计时为 5 秒，暂停时不消耗剩余时间，重新开始会替换上一项", () => {
    vi.useFakeTimers();
    const timer = new DueUndoTimer();
    const expired: string[] = [];
    timer.start(() => expired.push("A"));
    vi.advanceTimersByTime(3200);
    timer.pause("pointer");
    timer.pause("focus");
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
    timer.resume("pointer");
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
    timer.resume("focus");
    vi.advanceTimersByTime(dueUndoDuration - 3201);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(["A"]);

    timer.start(() => expired.push("B"));
    vi.advanceTimersByTime(1000);
    timer.start(() => expired.push("C"));
    vi.advanceTimersByTime(dueUndoDuration);
    expect(expired).toEqual(["A", "C"]);
  });

  it("160ms 内可连续完成不同事项，同一事项的重复点击只提交一次，且只撤销最新一项", async () => {
    const store = await sample();
    const [a, b] = store.openObligations.slice(0, 2);
    vi.useFakeTimers();
    const queue = new DueCompletionQueue();
    const completed: Array<[string, number, boolean]> = [];
    let latestUndo: (() => void) | undefined;
    const add = (o: typeof a) => queue.schedule(o.key, (sequence) => {
      const result = store.complete(o, undefined, { toast: false });
      const latest = queue.isLatest(sequence);
      completed.push([o.key, sequence, latest]);
      if (latest) latestUndo = result.undo;
    });
    expect(add(a)).not.toBeNull();
    vi.advanceTimersByTime(40);
    expect(add(a)).toBeNull();
    expect(add(b)).not.toBeNull();
    vi.advanceTimersByTime(dueCompletionDelay - 40);
    expect(completed).toEqual([[a.key, 1, false]]);
    vi.advanceTimersByTime(40);
    expect(completed).toEqual([[a.key, 1, false], [b.key, 2, true]]);
    expect(store.openObligations.some((x) => x.key === a.key)).toBe(false);
    expect(store.openObligations.some((x) => x.key === b.key)).toBe(false);

    latestUndo?.();
    expect(store.openObligations.some((x) => x.key === a.key)).toBe(false);
    expect(store.openObligations.some((x) => x.key === b.key)).toBe(true);
  });
});
