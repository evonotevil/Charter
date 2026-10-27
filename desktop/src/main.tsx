import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "./ui/styles.css";
import { setPlatform, platform } from "./platform/platform";
import { Store, ungrouped } from "./state/store";
import { Router } from "./state/router";
import { SyncMonitor } from "./state/sync";
import { Ctx, useApp } from "./state/hooks";
import { sectionShortcuts } from "./state/router";
import { Shell } from "./screens/Shell";
import { startReminderLoop, writeCalendarFile } from "./services/packets";
import { scheduleCalendarSync } from "./services/calendarSync";
import { installSampleData } from "./state/sample";
import { dragEnd, dragOver } from "./ui/drop";

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
  const p = platform();
  document.documentElement.dataset.os = p.os;
  const root = p.prefGet("dataRoot") ?? (await p.defaultRoot());
  const store = new Store(root);
  const router = new Router();
  const sync = new SyncMonitor();
  store.onSaved = () => sync.refreshSoon();
  store.onDataCleared = () => router.resetSelection();
  let lastCalendar = "";
  store.sideEffects = (s) => {
    if (s.data.settings.calendarEnabled && s.complianceOn) {
      const key = s.openObligations.map((o) => o.key + o.due + (o.record?.status ?? "")).join("|");
      if (key !== lastCalendar) { lastCalendar = key; void writeCalendarFile(s).catch(() => {}); }
    }
    scheduleCalendarSync(s);
  };
  await store.load();
  if (!inTauri && !inElectron && store.data.companies.length === 0 && new URLSearchParams(location.search).has("sample")) {
    await installSampleData(store);
    if (new URLSearchParams(location.search).has("stress")) await (await import("./state/stress")).installStressData(store);
  }
  sync.start(store.folder.root);
  // 5.4：回到窗口时重新检查源文件（可能刚同步下来，或在外部被移动、删除）
  window.addEventListener("focus", () => void store.checkFiles(true));
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
  // 文件夹变化（其他设备同步过来）、回到前台时重新检查
  useEffect(() => {
    let un: (() => void) | undefined;
    void platform().watch(store.folder.root, () => void store.reloadIfChangedElsewhere()).then((f) => { un = f; });
    const focus = () => void store.reloadIfChangedElsewhere();
    window.addEventListener("focus", focus);
    sync.start(store.folder.root);
    return () => { un?.(); window.removeEventListener("focus", focus); };
  }, [store.folder.root]);
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
      if (!cmd) return;
      const k = e.key.toLowerCase();
      const editing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      const blocked = store.isLoading || store.isImporting || store.loadFailed;
      if (k === "z" && !editing) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (k === "y" && !editing && platform().os === "windows") { e.preventDefault(); store.redo(); return; }
      if (k === "k") { e.preventDefault(); router.open({ kind: "quickSearch" }); return; }
      if (k === ",") { e.preventDefault(); router.openSettings("reminders"); return; }
      if (router.sheet) return;
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
