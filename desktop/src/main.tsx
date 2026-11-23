import { autoCheckOnLaunch } from "./services/update";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { installTooltips } from "./ui/tooltip";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "./ui/styles.css";
import { basename, setPlatform, platform } from "./platform/platform";
import { Store, ungrouped } from "./state/store";
import { Router } from "./state/router";
import { SyncMonitor } from "./state/sync";
import { Ctx, useApp } from "./state/hooks";
import { hasActiveModal } from "./ui/kit";
import { sectionShortcuts } from "./state/router";
import { Shell } from "./screens/Shell";
import { startReminderLoop, syncCalendarFile } from "./services/packets";
import { scheduleCalendarSync } from "./services/calendarSync";
import { installSampleData } from "./state/sample";
import { DemoPlatform, enterDemo, setRealPlatform, shouldStartSampleDemo, shouldStartTour } from "./state/demo";
import { dragEnd, dragOver } from "./ui/drop";
import { addToInbox } from "./state/lifecycle";
import { inboxResultFeedback } from "./screens/fileFeedback";
import type { InboxImportOutcome } from "./domain/inboxImport";

async function boot() {
  const inTauri = "__TAURI_INTERNALS__" in window;
  const inElectron = !!window.charter;
  if (inElectron) {
    const { createElectronPlatform } = await import("./platform/electron");
    setPlatform(await createElectronPlatform());
    document.documentElement.dataset.shell = "electron";
  } else if (inTauri) {
    const { createTauriPlatform } = await import("./platform/tauri");
    setPlatform(await createTauriPlatform());
  } else {
    const { MemoryPlatform } = await import("./platform/memory");
    const templates = (await import("./assets/charter-templates.json?raw")).default;
    setPlatform(new MemoryPlatform(templates));
  }
  let p = platform();
  document.documentElement.dataset.os = p.os;
  let root = p.prefGet("dataRoot") ?? (await p.defaultRoot());
  // 5.5.6：第一次打开（数据文件夹是空的）先进入演示和入门教程；示例档案只在内存里
  const sampleDemo = shouldStartSampleDemo(p);
  const tour = !sampleDemo && await shouldStartTour(p, root);
  if (tour || sampleDemo) {
    setRealPlatform(p);
    setPlatform(new DemoPlatform(p, await p.bundledTemplates()));
    enterDemo(tour ? "tour" : "sample");
    p = platform(); root = "/Charter";
  }
  const store = new Store(root);
  const router = new Router();
  const sync = new SyncMonitor();
  store.onSaved = () => sync.refreshSoon();
  store.onDataCleared = () => router.resetSelection();
  store.sideEffects = (s) => {
    if (!s.isLoading && !s.loadFailed) void syncCalendarFile(s).catch(() => {});
    scheduleCalendarSync(s);
  };
  await store.load();
  if (tour || sampleDemo) await installSampleData(store, { quiet: true });
  if (sampleDemo) router.go("structure");
  if (!inTauri && !inElectron && store.data.companies.length === 0 && new URLSearchParams(location.search).has("sample")) {
    await installSampleData(store);
    if (new URLSearchParams(location.search).has("stress")) await (await import("./state/stress")).installStressData(store);
  }
  autoCheckOnLaunch();
  // 5.4：回到窗口时重新检查源文件（可能刚同步下来，或在外部被移动、删除）
  window.addEventListener("focus", () => void store.checkFiles(true));
  installTooltips();
  if (new URLSearchParams(location.search).has("film")) (window as unknown as { __charter: unknown }).__charter = { store, router, platform: platform() };
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Ctx.Provider value={{ store, router, sync }}>
        <App />
      </Ctx.Provider>
    </StrictMode>,
  );
}

function App() {
  const { store, router, sync } = useApp();
  const dataRoot = store.folder.root;
  useEffect(() => router.syncInboxDataRoot(dataRoot), [dataRoot, router]);
  // 无上下文的文件统一由常驻队列串行加入待整理。切走文件页也继续处理，
  // 连续拖入的新批次会留在 inboxPaths，当前批次完成后再消费。
  useEffect(() => {
    if (store.isLoading || store.isImporting || store.loadFailed || router.inboxImporting || !router.inboxPaths.length) return;
    const batch = router.beginInboxImport(dataRoot);
    if (!batch) return;
    // 复用正式归档的互斥标记，阻止处理中切换数据根、恢复或清空数据。
    store.isImporting = true;
    store.emit();
    let outcome: InboxImportOutcome | undefined;
    void addToInbox(store, batch.paths, (status) => router.updateInboxImportStatus(batch, status)).then((result) => {
      outcome = result;
      if (router.section !== "files" || router.filesPane !== "inbox") {
        const feedback = inboxResultFeedback(result.added, result.duplicates, result.unsupported, result.failed, result.saveFailed);
        store.showToast(feedback.text, undefined, "", feedback.kind);
      }
    })
      .catch((e) => {
        const detail = e instanceof Error ? e.message : String(e);
        outcome = { added: 0, duplicates: 0, unsupported: 0, failed: batch.paths.length, saveFailed: 0,
          issues: batch.paths.map((path) => ({ path, name: basename(path) || path, reason: "unreadable", detail })) };
        store.setError(`加入待整理失败：${detail}`);
      })
      .finally(() => {
        store.isImporting = false;
        store.emit();
        router.finishInboxImport(batch, outcome);
      });
  }, [dataRoot, router.inboxPaths.length, router.inboxImporting, store.isImporting, store.isLoading, store.loadFailed, store, router]);
  // 文件夹变化（其他设备同步过来）、回到前台时重新检查。5.5.6：只在多台电脑共用时做
  const shared = store.shared;
  useEffect(() => {
    if (!shared) { sync.stop(); return; }
    let un: (() => void) | undefined;
    let cancelled = false;
    void platform().watch(store.folder.root, () => void store.reloadIfChangedElsewhere()).then((f) => { if (cancelled) f(); else un = f; });
    const focus = () => void store.reloadIfChangedElsewhere();
    window.addEventListener("focus", focus);
    sync.start(store.folder.root);
    return () => { cancelled = true; un?.(); window.removeEventListener("focus", focus); };
  }, [store.folder.root, shared]);
  useEffect(() => startReminderLoop(store), [store]);
  // 拖入文件：落到当前公司或当前集团
  useEffect(() => {
    if (!window.charter) return;
    let un: (() => void) | undefined;
    void import("./platform/electron").then(({ installElectronDrop }) => {
      un = installElectronDrop(dragOver, dragEnd, (paths, x, y) => {
        const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
        if (zone) { zone.dispatchEvent(new CustomEvent("charter-drop", { detail: paths, bubbles: false })); return; }
        if (router.sheet) return;
        router.startImport(paths, router.currentImportContext((id) => !!store.group(id)));
      });
    });
    return () => un?.();
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "over") { dragOver(e.payload.position.x / devicePixelRatio, e.payload.position.y / devicePixelRatio); return; }
        if (e.payload.type !== "drop") { dragEnd(); return; }
        dragEnd();
        if (!e.payload.paths.length) return;
        const target = document.elementFromPoint(e.payload.position.x / devicePixelRatio, e.payload.position.y / devicePixelRatio);
        const zone = target?.closest<HTMLElement>("[data-drop]");
        if (zone) { zone.dispatchEvent(new CustomEvent("charter-drop", { detail: e.payload.paths, bubbles: false })); return; }
        if (router.sheet) return;
        router.startImport(e.payload.paths, router.currentImportContext((id) => !!store.group(id)));
      }).then((f) => { un = f; }));
    return () => un?.();
  }, []);
  // 键盘快捷键（Mac 用 ⌘，Windows 用 Ctrl）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd || e.defaultPrevented) return;
      // 弹窗和教程自行处理快捷键；页面命令不能在它们后面打开另一张表单。
      if (router.sheet || hasActiveModal()) return;
      const k = e.key.toLowerCase();
      const editing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      const blocked = store.isLoading || store.isImporting || store.loadFailed;
      if (k === "z" && !editing) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (k === "y" && !editing && platform().os === "windows") { e.preventDefault(); store.redo(); return; }
      if (k === "k") { e.preventDefault(); router.open({ kind: "quickSearch" }); return; }
      if (k === ",") { e.preventDefault(); router.openSettings("reminders"); return; }
      if (/^[1-5]$/.test(k)) { e.preventDefault(); router.go(sectionShortcuts[+k - 1]); return; }
      if (blocked) return;
      if (k === "n" && e.shiftKey) { e.preventDefault(); router.open({ kind: "newCompany" }); return; }
      if (k === "n") {
        e.preventDefault();
        if (router.section === "people") router.set("newPersonRequest", router.newPersonRequest + 1);
        else if (router.section === "parties" || router.section === "agents") router.set("newPartyRequest", router.newPartyRequest + 1);
        else router.open({ kind: "newCompany" });
        return;
      }
      if (k === "i") { e.preventDefault(); void router.chooseFiles(router.currentImportContext((id) => !!store.group(id))); return; }
      if (k === "e" && e.shiftKey) { e.preventDefault(); const id = router.selectedCompanyID; router.open(id ? { kind: "exportAll", companyID: id } : { kind: "packet" }); return; }
      if (k === "l") { e.preventDefault(); router.open({ kind: "chainQuery", to: router.selectedCompanyID ?? undefined }); return; }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  void ungrouped;
  return <Shell />;
}

/** 启动失败时也要有界面：显示原因，而不是一片空白。 */
function fatal(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  try { (window as any).charter?.invoke("log", "error", "启动失败：" + (e instanceof Error ? e.stack || msg : msg)); } catch { /* 忽略 */ }
  const el = document.getElementById("root")!;
  el.innerHTML = "";
  const box = document.createElement("div");
  box.className = "fatal-box";
  el.className = "fatal";
  box.style.cssText = "max-width:520px;margin:15vh auto;padding:32px;border-radius:20px;border:2px solid #E0E7DD;background:#fff;font-family:Inter,'PingFang SC','Microsoft YaHei UI',sans-serif;color:#25352C";
  box.innerHTML = '<h1 style="font:900 24px Nunito,Inter,sans-serif;margin:0 0 8px">Charter 没能打开</h1><p style="margin:0 0 16px;color:#5F6D66">请把下面的原因发给维护的人。你的档案没有被改动。</p><pre style="white-space:pre-wrap;background:#F2F5EF;padding:12px;border-radius:10px;font-size:12px"></pre><button style="margin-top:16px;height:40px;padding:0 18px;border-radius:12px;border:0;background:#58CC02;color:#1B3608;font-weight:800;box-shadow:0 4px 0 #368A00">重新打开</button>';
  box.querySelector("pre")!.textContent = msg;
  box.querySelector("button")!.addEventListener("click", () => location.reload());
  el.appendChild(box);
}
window.addEventListener("error", (e) => { try { (window as any).charter?.invoke("log", "error", String(e.error?.stack || e.message)); } catch { /* 忽略 */ } });
window.addEventListener("unhandledrejection", (e) => { try { (window as any).charter?.invoke("log", "error", String((e.reason as any)?.stack || e.reason)); } catch { /* 忽略 */ } });
boot().catch(fatal);
