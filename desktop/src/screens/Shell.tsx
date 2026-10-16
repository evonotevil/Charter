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
import { Dashboard } from "./Dashboard";
import { CompaniesView } from "./Companies";
import { FilesView } from "./Files";
import { PeopleView } from "./People";
import { PartiesView } from "./Parties";
import { CalendarView } from "./Calendar";
import { SettingsView } from "./Settings";

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

function GroupSwitcher() {
  const { store, router } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const g = store.group(router.groupFilter);
  const subtitle = g ? (g.tops.length ? `顶层：${store.topLabel(g)}` : `${store.companyIDsIn(g).size} 家公司`)
    : router.groupFilter === ungrouped ? `${store.ungroupedCompanies.length} 家公司` : `${store.data.companies.length} 家公司`;
  const groups = [...store.data.groups].sort((a, b) => a.name.localeCompare(b.name));
  const row = (id: string | null, name: string, count: number) => (
    <button key={id ?? "all"} className="prow" style={{ height: 34 }} onClick={() => { setOpen(false); router.set("groupFilter", id); }}>
      <GroupIcon groupID={id} size={22} />
      <span className="ellipsis grow" style={{ fontWeight: router.groupFilter === id ? 600 : 400 }}>{name}</span>
      <span className="t-meta muted num">{count}</span>
      <Icon name="checkmark" size={12} style={{ opacity: router.groupFilter === id ? 1 : 0 }} />
    </button>
  );
  return (
    <>
      <button ref={ref} onClick={() => setOpen((o) => !o)} className="row gap8 grow no-drag" aria-label={`切换集团，当前：${store.filterName(router.groupFilter)}`}
        style={{ padding: "6px 10px 6px 6px", borderRadius: 14, background: open ? "color-mix(in srgb, var(--hairline) 70%, transparent)" : "var(--band)", textAlign: "left" }}>
        <GroupIcon groupID={router.groupFilter} size={30} fill="var(--surface)" />
        <span className="col grow" style={{ gap: 1 }}>
          <span className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>{store.filterName(router.groupFilter)}</span>
          <span className="ellipsis muted" style={{ fontSize: 11.5 }}>{subtitle}</span>
        </span>
        <Icon name="chevron.up.chevron.down" size={11} className="muted" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="right" minWidth={270}>
        {row(null, "全部公司", store.data.companies.length)}
        {groups.length > 0 && <div className="pheader" style={{ paddingTop: 8 }}>集团</div>}
        <div style={{ maxHeight: groups.length > 9 ? 320 : undefined, overflow: "auto" }}>
          {groups.map((x) => row(x.id, x.name, store.companyIDsIn(x).size))}
        </div>
        {store.ungroupedCompanies.length > 0 && <><div className="pdivider" />{row(ungrouped, "未归入集团", store.ungroupedCompanies.length)}</>}
        <div className="pdivider" />
        <PopoverRow title="新建集团…" icon="plus" onClick={() => { setOpen(false); router.open({ kind: "newGroup" }); }} />
        {g && <PopoverRow title="编辑当前集团…" icon="pencil" onClick={() => { setOpen(false); router.open({ kind: "editGroup", group: g.id }); }} />}
        {g && <PopoverRow title="管理成员…" icon="checklist" onClick={() => { setOpen(false); router.open({ kind: "groupMembers", group: g.id }); }} />}
      </Popover>
    </>
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
  // 设计规范：“公司”带需处理数角标（有文件需处理的公司数）。
  const badge = (s: Section) => (s === "companies" ? store.attentionCompanyCount(router.groupFilter) : 0);
  const groupExists = (id: string) => !!store.group(id);
  return (
    <aside className="col" style={{ width: 250, flex: "none", padding: "8px 12px 12px", background: "var(--canvas)", borderRight: "1px solid var(--hairline)" }}>
      <div className="drag-region" data-tauri-drag-region style={{ height: platform().os === "mac" ? 34 : 6, flex: "none" }} />
      <div className="row gap8" style={{ paddingBottom: 16 }}>
        <GroupSwitcher />
        <ActionMenu icon="plus" ariaLabel="新建" entries={[
          item("新建公司", "building.2", () => {
            const g = router.groupFilter;
            if (g && g !== ungrouped && store.group(g)) router.open({ kind: "newCompanyInGroup", group: g }); else router.open({ kind: "newCompany" });
          }, { shortcut: "⇧⌘N" }),
          item("新建集团", "square.stack.3d.up", () => router.open({ kind: "newGroup" })),
          divider,
          item("上传材料…", "square.and.arrow.down", () => void router.chooseFiles(router.currentImportContext(groupExists)), { shortcut: "⌘I" }),
        ]} />
      </div>
      <nav className="col grow scroll" style={{ gap: 2 }}>
        {sections.map((s, i) => {
          const on = router.section === s.id;
          const n = badge(s.id);
          return (
            <button key={s.id} onClick={() => router.go(s.id)} title={`${s.title}（Ctrl/⌘+${i + 1}）`} aria-current={on ? "page" : undefined}
              className="row gap12" style={{ height: 36, padding: "0 12px", borderRadius: "var(--r-row)", background: on ? "var(--selection)" : "transparent",
                color: on ? "var(--on-selection)" : "var(--ink)", transition: "background var(--standard) var(--ease)", fontWeight: on ? 600 : 500 }}>
              <span style={{ width: 20, display: "inline-flex", justifyContent: "center" }}><Icon name={s.symbol} size={16} /></span>
              <span className="grow" style={{ textAlign: "left" }}>{s.title}</span>
              {n > 0 && <CountBadge count={n} inverted={on} />}
            </button>
          );
        })}
      </nav>
      <SidebarFooter />
    </aside>
  );
}

function Page() {
  const { router } = useApp();
  if (router.showCalendar) return <CalendarView onBack={() => router.set("showCalendar", false)} />;
  switch (router.section) {
    case "overview": return <Dashboard />;
    case "companies": return <CompaniesView />;
    case "files": return <FilesView />;
    case "people": return <PeopleView />;
    case "parties": return <PartiesView />;
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
