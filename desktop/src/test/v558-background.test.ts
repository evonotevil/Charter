import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform, type SyncState } from "../platform/platform";
import { Store } from "../state/store";
import { SyncMonitor } from "../state/sync";

afterEach(() => vi.useRealTimers());

it("共享文件夹没有变化时不刷新界面，跨日时仍刷新日历", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 18, 16));
  const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");
  setPlatform(new MemoryPlatform(templates));
  const store = new Store("/Cloud/Charter");
  await store.load();
  await vi.advanceTimersByTimeAsync(1600);
  const update = vi.fn();
  store.subscribe(update);
  store.sideEffects = vi.fn();

  for (let i = 0; i < 3; i++) await store.reloadIfChangedElsewhere();
  await vi.advanceTimersByTimeAsync(1600);
  expect(update).toHaveBeenCalledTimes(0);
  expect(store.sideEffects).toHaveBeenCalledTimes(0);

  vi.setSystemTime(new Date(2026, 10, 19, 9));
  await store.reloadIfChangedElsewhere();
  await vi.advanceTimersByTimeAsync(1600);
  expect(store.today).toBe("2026-11-19");
  expect(update).toHaveBeenCalledTimes(1);
  expect(store.sideEffects).toHaveBeenCalledTimes(1);

  update.mockClear();
  await store.folder.save({ ...store.data.settings, calendarName: "远端更新" }, "settings");
  await store.reloadIfChangedElsewhere();
  expect(store.data.settings.calendarName).toBe("远端更新");
  expect(update).toHaveBeenCalled();
});

it("一批本机保存只检查一次云盘，切换目录时取消旧目录的延时检查", async () => {
  vi.useFakeTimers();
  const p = new MemoryPlatform("");
  const query = vi.spyOn(p, "syncStatus").mockResolvedValue({ kind: "synced", at: 1 });
  setPlatform(p);
  const monitor = new SyncMonitor();
  monitor.start("/Cloud/A");
  await vi.advanceTimersByTimeAsync(0);
  query.mockClear();
  for (let i = 0; i < 10; i++) monitor.refreshSoon();
  expect(monitor.state.kind).toBe("syncing");
  await vi.advanceTimersByTimeAsync(3000);
  expect(query).toHaveBeenCalledTimes(1);
  expect(monitor.state.kind).toBe("synced");

  monitor.refreshSoon();
  monitor.start("/Cloud/B");
  await vi.advanceTimersByTimeAsync(3000);
  expect(query).toHaveBeenCalledTimes(2);
  monitor.refreshSoon();
  monitor.stop();
  monitor.start("/Cloud/B");
  await vi.advanceTimersByTimeAsync(3000);
  expect(query).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(11000);
  monitor.refreshSoon();
  await vi.advanceTimersByTimeAsync(1000);
  expect(query).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(2000);
  expect(query).toHaveBeenCalledTimes(5);
  monitor.stop();
});

it("切换回同一目录、停止监控或并行检查时，迟到的旧结果不会覆盖当前状态", async () => {
  vi.useFakeTimers();
  const p = new MemoryPlatform("");
  const results: Array<(s: SyncState) => void> = [];
  vi.spyOn(p, "syncStatus").mockImplementation(() => new Promise(resolve => results.push(resolve)));
  setPlatform(p);
  const monitor = new SyncMonitor();
  monitor.start("/Cloud/A");
  monitor.start("/Cloud/B");
  monitor.start("/Cloud/A");
  results[2]({ kind: "synced", at: 3 });
  results[1]({ kind: "signedOut" });
  results[0]({ kind: "failed", message: "过期" });
  await vi.advanceTimersByTimeAsync(0);
  expect(monitor.state).toEqual({ kind: "synced", at: 3 });

  const previous = monitor.refresh();
  const latest = monitor.refresh();
  results[4]({ kind: "conflict", files: ["settings.json"] });
  results[3]({ kind: "synced", at: 4 });
  await Promise.all([previous, latest]);
  expect(monitor.state.kind).toBe("conflict");

  const stopped = monitor.refresh();
  monitor.stop();
  monitor.start("/Cloud/A");
  results[5]({ kind: "signedOut" });
  await stopped;
  expect(monitor.state.kind).toBe("checking");
  monitor.stop();
  results[6]({ kind: "synced", at: 7 });
  await vi.advanceTimersByTimeAsync(0);
  expect(monitor.state.kind).toBe("local");
});
