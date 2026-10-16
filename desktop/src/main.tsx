import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./ui/styles.css";
import { setPlatform, platform } from "./platform/platform";
import { Store, ungrouped } from "./state/store";
import { Router } from "./state/router";
import { SyncMonitor } from "./state/sync";
import { Ctx, useApp } from "./state/hooks";
import { Shell } from "./screens/Shell";
import { startReminderLoop, writeCalendarFile } from "./services/packets";
import { installSampleData } from "./state/sample";
import { dragEnd, dragOver } from "./ui/drop";

async function boot() {
  const inTauri = "__TAURI_INTERNALS__" in window;
  if (inTauri) {
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
  };
  await store.load();
  if (!inTauri && store.data.companies.length === 0 && new URLSearchParams(location.search).has("sample")) await installSampleData(store);
  sync.start(store.folder.root);
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
      if (k === ",") { e.preventDefault(); router.openSettings("sync"); return; }
      if (router.sheet || router.settings) return;
      if (/^[1-5]$/.test(k)) { e.preventDefault(); router.go((["overview", "companies", "files", "people", "parties"] as const)[+k - 1]); return; }
      if (blocked) return;
      if (k === "n" && e.shiftKey) { e.preventDefault(); router.open({ kind: "newCompany" }); return; }
      if (k === "n") {
        e.preventDefault();
        if (router.section === "people") router.set("newPersonRequest", router.newPersonRequest + 1);
        else if (router.section === "parties") router.set("newPartyRequest", router.newPartyRequest + 1);
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

void boot();
