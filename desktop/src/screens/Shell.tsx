// 主窗口外壳：侧栏（集团切换、五个页面、同步状态与设置）、页面区、弹窗、提示条。移植自 RootView。

import { useEffect, useState } from "react";
import { useApp } from "../state/hooks";
import { sections, workspaceSections, type Section } from "../state/router";
import { ungrouped } from "../state/store";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, CountBadge, shortcutLabel, ErrorStateView, Modal, Skeleton, Spinner, divider, item } from "../ui/kit";
import { syncNeedsAttention, syncSymbol, syncTitle } from "../state/sync";
import { platform } from "../platform/platform";
import { SheetHost } from "./SheetHost";
import { CompaniesView } from "./Companies";
import { FilesView } from "./Files";
import { PeopleView } from "./People";
import { SettingsView, SyncView } from "./Settings";
import { LogoMark } from "../ui/Logo";
import { StructureView } from "./Structure";
import { DueView } from "./Due";
import { VerifyView } from "./Trust";
import { useTrashJanitor } from "./Lifecycle";
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

const railKey = "charter.sidebar.rail";
function readRail() { try { return localStorage.getItem(railKey) === "1"; } catch { return false; } }
function writeRail(v: boolean) { try { localStorage.setItem(railKey, v ? "1" : "0"); } catch { /* 存不了就只在本次有效 */ } }

function Sidebar() {
  const { store, router, sync } = useApp();
  const [railPref, setRail] = useState(readRail);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1100);
  useEffect(() => { const r = () => setNarrow(window.innerWidth < 1100); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const rail = railPref || narrow;
  const toggle = () => setRail((r) => { writeRail(!r); return !r; });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggle(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const soon = store.openObligations.filter((o) => D.daysBetween(store.today, o.due) <= 30);
  const overdue = soon.filter((o) => o.due < store.today).length;
  // 与文件页“需处理”同一口径：当前集团范围内的公司文件 + 全部个人文件
  const gscope = store.companyIDsForFilter(router.groupFilter);
  const missing = store.documentsNeedingAttention.filter((d) => d.owner.kind === "person" || !gscope || gscope.has(d.owner.id)).length;
  const groupExists = (id: string) => !!store.group(id);
  const s = sync.state;
  const spin = s.kind === "syncing" || s.kind === "checking" ? { animation: "spin 2s linear infinite" } : undefined;
  const active = (id: Section) => router.section === id || (id === "people" && (router.section === "agents" || router.section === "parties")) || (id === "companies" && router.section === "overview");
  const navButton = (sec: { id: Section; title: string; symbol: string }, i?: number) => {
    const n = sec.id === "due" ? soon.length : sec.id === "files" ? missing : 0;
    const bad = sec.id === "due" && overdue > 0;
    return (
      <button key={sec.id} className="nav-item" aria-current={active(sec.id) ? "page" : undefined} onClick={() => router.go(sec.id)}
        title={rail ? sec.title : i !== undefined ? `${sec.title}（${shortcutLabel(String(i + 1))}）` : sec.title} aria-label={rail ? sec.title : undefined}>
        <span className="ic"><Icon name={sec.symbol} size={17} /></span>
        <span className="lbl grow ellipsis">{sec.title}</span>
        {n > 0 && <span className="nav-count"><CountBadge count={n} tone={bad ? "bad" : undefined} /></span>}
        {(bad || n > 0) && <span className="rail-dot" aria-hidden />}
      </button>
    );
  };
  const tone = overdue ? "warn" : "";
  return (
    <aside className={`side ${rail ? "rail" : ""}`}>
      <div className="titlebar drag-region" />
      <div className="side-top col gap16">
        <div className="brand">
          <button onClick={toggle} title={`${rail ? "展开" : "收起"}侧栏（${shortcutLabel("\\")}）`} aria-label={rail ? "展开侧栏" : "收起侧栏"} aria-expanded={!rail}><LogoMark size={32} /></button>
          <span className="brand-word">Charter</span>
          {!rail && <><span className="spacer" /><ActionMenu icon="plus" size="small" ariaLabel="新建" showsChevron={false} entries={[
            item("新建公司", "building.2", () => router.open({ kind: "newCompany" }), { shortcut: shortcutLabel("N", true) }),
            item("新建集团", "square.stack.3d.up", () => router.openSettings("groups", "new")),
            divider,
            item("上传材料…", "square.and.arrow.down", () => void router.chooseFiles(router.currentImportContext(groupExists)), { shortcut: shortcutLabel("I") }),
          ]} /></>}
        </div>
        <button className="side-search" onClick={() => router.open({ kind: "quickSearch" })} aria-label={`搜索公司或人（${shortcutLabel("K")}）`} title={rail ? `搜索（${shortcutLabel("K")}）` : undefined}>
          <Icon name="magnifyingglass" size={15} /><span className="lbl">搜索公司或人</span><kbd>{shortcutLabel("K")}</kbd>
        </button>
      </div>
      <nav className="nav" aria-label="主要页面">{sections.map((x, i) => navButton(x, i))}</nav>
      <span className="spacer" />
      {!rail && (soon.length > 0
        ? <button className={`side-card ${tone}`} onClick={() => router.go("due")}>
            <span className="t-subtitle">{overdue ? `${overdue} 件已逾期` : `30 天内 ${soon.length} 件`}</span>
            <span className="t-meta">{overdue ? "先处理逾期的，再看快到期的。" : "按日历一件件来。"}</span>
          </button>
        : <span className="t-meta muted" style={{ padding: "0 12px" }}>30 天内没有申报事项</span>)}
      <nav className="nav" aria-label="工作区">
        <span className="nav-head">工作区</span>
        {workspaceSections.map((x) => navButton(x))}
      </nav>
      <div className="side-foot">
        <button className={`sync-chip grow ${syncNeedsAttention(s) ? "warn" : ""}`} onClick={() => router.go("sync")} title={syncTitle(s)}>
          <Icon name={syncSymbol(s)} size={14} style={spin} /><span className="lbl ellipsis">{syncTitle(s)}</span>
        </button>
      </div>
    </aside>
  );
}

function Page() {
  const { router } = useApp();
  switch (router.section) {
    case "structure": return <StructureView />;
    case "due": return <DueView />;
    case "agents": case "parties": case "people": return <PeopleView />;
    case "overview": case "companies": return <CompaniesView />;
    case "files": return <FilesView />;
    case "verify": return <VerifyView />;
    case "sync": return <SyncView />;
    case "settings": return <SettingsView />;
  }
}

export function Shell() {
  const { store, router } = useApp();
  useTrashJanitor();
  const blocked = store.isLoading || store.isImporting || store.loadFailed;
  return (
    <div className="app">
      <Sidebar />
      <main className="main" {...(blocked && !store.isImporting ? { inert: "" } as any : {})}>
        <div className="titlebar drag-region" />
        <div className="col grow page-in" key={pageKey(router)} style={{ minHeight: 0 }}><Page /></div>
      </main>
      <SheetHost />
      {store.toast && (
        <div className={`toast ${store.toast.action ? "with-action" : ""} ${store.toast.leaving ? "out" : ""}`} key={store.toast.id} role="status"
          onMouseEnter={() => store.pauseToast()} onMouseLeave={() => store.resumeToast()}>
          <span className="dot" style={{ background: store.toast.kind === "success" ? "var(--green)" : "var(--red)", color: store.toast.kind === "success" ? "var(--on-green)" : "#fff" }}>
            <Icon name={store.toast.kind === "success" ? "checkmark" : "exclamationmark"} size={13} strokeWidth={3.5} />
          </span>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{store.toast.text}</span>
          {store.toast.action && <button onClick={() => { const a = store.toast!.action!; store.dismissToast(); a(); }}>{store.toast.actionTitle}</button>}
        </div>
      )}
      {store.isLoading && (
        <div className="overlay" style={{ background: "color-mix(in srgb, var(--canvas) 60%, transparent)" }}>
          <div className="col gap12 sheet" style={{ width: 300, padding: 24 }}>
            <div className="row gap10 t-row"><Spinner />正在读取档案…</div>
            <Skeleton width={220} height={10} /><Skeleton width={160} height={10} />
            <div className="t-meta muted">读取完成前不会保存或修改数据</div>
          </div>
        </div>
      )}
      {!store.isLoading && store.loadFailed && (
        <div className="overlay" style={{ background: "transparent" }}>
          <div className="sheet" style={{ maxWidth: 460 }}>
            <ErrorStateView title="档案暂时处于保护状态" message="现有档案已保留。请检查数据文件夹或修复读取错误，再重新载入。" retryTitle="重新载入" retry={() => void store.load()} />
            <div className="row" style={{ justifyContent: "center", paddingBottom: 24 }}>
              <Button size="small" kind="quiet" onClick={() => { router.go("sync"); }}>更换数据文件夹…</Button>
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

const pageKey = (r: { section: Section; companyOpen: boolean; selectedCompanyID: string | null }) =>
  r.section === "parties" || r.section === "agents" ? "people" : r.section === "companies" && r.companyOpen ? "company:" + r.selectedCompanyID : r.section;
