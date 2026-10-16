// 主窗口外壳：侧栏（集团切换、五个页面、同步状态与设置）、页面区、弹窗、提示条。移植自 RootView。

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import { sections, type Section } from "../state/router";
import { ungrouped } from "../state/store";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, CountBadge, ErrorStateView, Modal, Popover, PopoverRow, Skeleton, Spinner, divider, item } from "../ui/kit";
import { syncDetail, syncNeedsAttention, syncSymbol, syncTitle } from "../state/sync";
import { platform } from "../platform/platform";
import { SheetHost } from "./SheetHost";
import { CompaniesView } from "./Companies";
import { FilesView } from "./Files";
import { PeopleView } from "./People";
import { SettingsView } from "./Settings";
import { leftText } from "./InfoCard";
import { StructureView } from "./Structure";
import { DueView } from "./Due";
import { AgentsView } from "./Agents";
import * as D from "../domain/day";

export function GroupIcon({ groupID, size = 22, fill = "var(--band)" }: { groupID: string | null; size?: number; fill?: string }) {
  const { store } = useApp();
  const g = groupID && groupID !== ungrouped ? store.group(groupID) : undefined;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!g?.iconFileName) { setSrc(null); return; }
    const p = platform();
    const path = p.join(store.folder.groupIconsDir, g.iconFileName);
    p.stat(path).then((s) => setSrc(s.exists ? p.fileURL(path) + `?v=${s.mtime}` : null)).catch(() => setSrc(null));
  }, [g?.iconFileName, store.folder.root]);
  const r = size * 0.28;
  if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: r, objectFit: "cover", flex: "none" }} />;
  const text = groupID === null ? null : groupID === ungrouped ? "独" : ([...(g?.name.trim() ?? "")][0] ?? "集");
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: r, background: fill, boxShadow: "inset 0 0 0 1px var(--hairline)", flex: "none",
      display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.46, fontWeight: 600 }}>
      {text ?? <Icon name="square.stack.3d.up" size={size * 0.48} />}
    </span>
  );
}

function SidebarFooter() {
  const { router, sync } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const s = sync.state;
  return (
    <div className="row gap8" style={{ paddingTop: 12 }}>
      <button ref={ref} onClick={() => setOpen((o) => !o)} title="查看同步详情" className="row gap6 grow"
        style={{ paddingLeft: 12, fontSize: 12, color: syncNeedsAttention(s) ? "var(--amber-text)" : "var(--muted)" }}>
        <Icon name={syncSymbol(s)} size={13} style={s.kind === "syncing" || s.kind === "checking" ? { animation: "spin 2s linear infinite" } : undefined} />
        <span className="ellipsis">{syncTitle(s)}</span>
      </button>
      <button className="muted row" style={{ width: 28, height: 28, justifyContent: "center", borderRadius: 8 }} title="设置（Ctrl/⌘+,）" aria-label="设置"
        onClick={() => router.openSettings("sync")}><Icon name="gearshape" size={15} /></button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="top">
        <div className="col gap8" style={{ width: 280, padding: 10 }}>
          <div className="row gap6" style={{ fontWeight: 600 }}><Icon name={syncSymbol(s)} size={15} />{syncTitle(s)}</div>
          <div className="t-meta muted">{syncDetail(s)}</div>
          <div className="row gap8" style={{ marginTop: 4 }}>
            <Button size="small" onClick={() => void sync.refresh()}>立即检查</Button>
            <Button size="small" kind="quiet" onClick={() => { setOpen(false); router.openSettings("sync"); }}>同步设置…</Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function Sidebar() {
  const { store, router } = useApp();
  const soon = store.openObligations.filter((o) => D.daysBetween(store.today, o.due) <= 90).sort((a, b) => (a.due < b.due ? -1 : 1));
  const badge = (s: Section) => (s === "due" ? soon.filter((o) => D.daysBetween(store.today, o.due) <= 30).length : s === "files" ? store.attentionCompanyCount(null) : 0);
  const groupExists = (id: string) => !!store.group(id);
  const navButton = (s: (typeof sections)[number], i: number) => {
    const on = router.section === s.id || (s.id === "agents" && router.section === "parties");
    const n = badge(s.id);
    return (
      <button key={s.id} onClick={() => router.go(s.id)} title={`${s.title}（⌘${i + 1}）`} aria-current={on ? "page" : undefined}
        className="row gap12" style={{ height: 36, flex: "none", padding: "0 12px", borderRadius: "var(--r-row)", background: on ? "var(--selection)" : "transparent",
          color: on ? "var(--on-selection)" : "var(--ink)", transition: "background var(--standard) var(--ease)", fontWeight: on ? 600 : 500 }}>
        <span style={{ width: 20, display: "inline-flex", justifyContent: "center" }}><Icon name={s.symbol} size={16} /></span>
        <span className="grow" style={{ textAlign: "left" }}>{s.title}</span>
        {n > 0 && <CountBadge count={n} inverted={on} />}
      </button>
    );
  };
  return (
    <aside className="col" style={{ width: 250, flex: "none", padding: "8px 12px 12px", background: "var(--canvas)", borderRight: "1px solid var(--hairline)" }}>
      <div className="drag-region" data-tauri-drag-region style={{ height: platform().os === "mac" ? 34 : 6, flex: "none" }} />
      <div className="row gap8" style={{ paddingBottom: 12 }} data-tauri-drag-region>
        <span className="v4-logo" data-tauri-drag-region>C</span>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3 }} className="grow" data-tauri-drag-region>Charter</span>
        <ActionMenu icon="plus" ariaLabel="新建" entries={[
          item("新建公司", "building.2", () => router.open({ kind: "newCompany" }), { shortcut: "⇧⌘N" }),
          item("新建集团", "square.stack.3d.up", () => router.openSettings("groups", "new")),
          divider,
          item("上传材料…", "square.and.arrow.down", () => void router.chooseFiles(router.currentImportContext(groupExists)), { shortcut: "⌘I" }),
        ]} />
      </div>
      <button className="v4-search" onClick={() => router.open({ kind: "quickSearch" })} aria-label="搜索公司或人（⌘K）">
        <Icon name="magnifyingglass" size={14} /><span className="grow" style={{ textAlign: "left" }}>搜索公司或人</span><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)" }}>⌘K</span>
      </button>
      <nav className="col" style={{ gap: 2 }}>{sections.slice(0, 3).map(navButton)}</nav>
      <div className="v4-label" style={{ padding: "16px 12px 6px" }}>档案</div>
      <nav className="col" style={{ gap: 2 }}>{sections.slice(3).map((s, i) => navButton(s, i + 3))}</nav>
      <div className="v4-label" style={{ padding: "18px 12px 4px" }}>接下来 90 天</div>
      <div className="col scroll grow" style={{ minHeight: 0 }}>
        {soon.length ? soon.slice(0, 8).map((o) => (
          <button key={o.key} className="v4-side" onClick={() => router.openDue(o.key)}>
            <span className="row" style={{ justifyContent: "space-between", gap: 6 }}>
              <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{o.company.jurisdiction} {o.rule.name}</span>
              <span className="num" style={{ fontSize: 11, flex: "none", color: D.daysBetween(store.today, o.due) < 0 ? "var(--danger)" : D.daysBetween(store.today, o.due) <= 30 ? "var(--amber-text)" : "var(--muted)" }}>{leftText(D.daysBetween(store.today, o.due)).replace("天后", "天")}</span>
            </span>
            <span className="ellipsis muted" style={{ fontSize: 11.5 }}>{o.company.name}</span>
          </button>
        )) : <span className="t-meta muted" style={{ padding: "4px 12px" }}>没有临近的事项</span>}
      </div>
      <SidebarFooter />
    </aside>
  );
}

function Page() {
  const { router } = useApp();
  switch (router.section) {
    case "structure": return <StructureView />;
    case "due": return <DueView />;
    case "agents": case "parties": return <AgentsView />;
    case "overview": return <StructureView />;
    case "companies": return <CompaniesView />;
    case "files": return <FilesView />;
    case "people": return <PeopleView />;
  }
}

export function Shell() {
  const { store, router } = useApp();
  const blocked = store.isLoading || store.isImporting || store.loadFailed;
  return (
    <div className="row" style={{ height: "100%", alignItems: "stretch" }}>
      <Sidebar />
      <main className="col grow" style={{ position: "relative", minWidth: 0, background: "var(--canvas)" }} {...(blocked && !store.isImporting ? { inert: "" } as any : {})}>
        <div className="drag-region" data-tauri-drag-region style={{ height: platform().os === "mac" ? 28 : 6, flex: "none" }} />
        <div className="col grow" style={{ minHeight: 0 }}><Page /></div>
      </main>
      <SheetHost />
      {router.settings && <SettingsView />}
      {store.toast && (
        <div className={`toast ${store.toast.action ? "with-action" : ""}`} key={store.toast.id} role="status">
          <span className="dot" style={{ background: store.toast.kind === "success" ? "var(--lime)" : "var(--danger)", color: store.toast.kind === "success" ? "var(--on-lime)" : "#fff" }}>
            <Icon name={store.toast.kind === "success" ? "checkmark" : "exclamationmark.circle.fill"} size={10} strokeWidth={3.5} />
          </span>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{store.toast.text}</span>
          {store.toast.action && <button onClick={() => { const a = store.toast!.action!; store.toast = null; store.emit(); a(); }}>{store.toast.actionTitle}</button>}
        </div>
      )}
      {store.isLoading && (
        <div className="overlay" style={{ background: "color-mix(in srgb, var(--canvas) 60%, transparent)" }}>
          <div className="col gap12" style={{ width: 300, padding: 24, background: "var(--surface)", borderRadius: "var(--r-surface)", boxShadow: "var(--floating-shadow)" }}>
            <div className="row gap10 t-row"><Spinner />正在读取档案…</div>
            <Skeleton width={220} height={10} /><Skeleton width={160} height={10} />
            <div className="t-meta muted">读取完成前不会保存或修改数据</div>
          </div>
        </div>
      )}
      {!store.isLoading && store.loadFailed && (
        <div className="overlay" style={{ background: "transparent" }}>
          <div style={{ maxWidth: 460, background: "var(--surface)", borderRadius: "var(--r-surface)", boxShadow: "var(--floating-shadow)" }}>
            <ErrorStateView title="档案暂时处于保护状态" message="现有档案已保留。请检查数据文件夹或修复读取错误，再重新载入。" retryTitle="重新载入" retry={() => void store.load()} />
            <div className="row" style={{ justifyContent: "center", paddingBottom: 24 }}>
              <Button size="small" kind="quiet" onClick={() => router.openSettings("sync")}>更换数据文件夹…</Button>
            </div>
          </div>
        </div>
      )}
      {store.errorMessage && (
        <Modal onClose={() => store.setError(null)}>
          <div className="sheet" style={{ width: 440, padding: 28, gap: 16 }}>
            <div className="t-sheet">{store.loadFailed ? "档案已暂停保存" : "操作未完成"}</div>
            <div className="muted selectable">{store.errorMessage}</div>
            <div className="row"><span className="spacer" /><Button kind="primary" autoFocus onClick={() => store.setError(null)}>好</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
