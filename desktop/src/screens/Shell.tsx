// 主窗口外壳：侧栏（集团切换、五个页面、同步状态与设置）、页面区、弹窗、提示条。移植自 RootView。

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { leftText, liveCompanies } from "./InfoCard";
import { SlideBg, TweenNumber } from "../ui/motion";
import { isSoft, useUIStyle, softLike, companyTint } from "../ui/uistyle";
import { LogoMark } from "../ui/Logo";
import type { Obligation } from "../domain/engine";
import { StructureView } from "./Structure";
import { DueView } from "./Due";
import { AgentsView } from "./Agents";
import { VerifyView } from "./Trust";
import * as D from "../domain/day";

function shortcutLabel(key: string, shift = false) {
  return platform().os === "mac"
    ? `${shift ? "⇧" : ""}⌘${key}`
    : `${shift ? "Ctrl+Shift+" : "Ctrl+"}${key}`;
}

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

function SidebarFooter({ rail }: { rail: boolean }) {
  const { router, sync } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const s = sync.state;
  const spin = s.kind === "syncing" || s.kind === "checking" ? { animation: "spin 2s linear infinite" } : undefined;
  return (
    <div className={rail ? "col gap6" : "row gap8"} style={{ paddingTop: 12, alignItems: "center" }}>
      <button ref={ref} onClick={() => setOpen((o) => !o)} title={rail ? syncTitle(s) : "查看同步详情"} className={rail ? "row" : "row gap6 grow"}
        style={{ paddingLeft: rail ? 0 : 12, height: 28, minWidth: 28, justifyContent: rail ? "center" : undefined, fontSize: 12, color: syncNeedsAttention(s) ? "var(--amber-text)" : "var(--muted)" }}>
        <Icon name={syncSymbol(s)} size={13} style={spin} />
        {!rail && <span className="ellipsis lbl">{syncTitle(s)}</span>}
      </button>
      <button className="muted row" style={{ width: 28, height: 28, justifyContent: "center", borderRadius: 8, flex: "none" }} title={`设置（${shortcutLabel(",")}）`} aria-label="设置"
        onClick={() => router.openSettings("sync")}><Icon name="gearshape" size={15} /></button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement={rail ? "right" : "top"}>
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

const railKey = "charter.sidebar.rail";
function readRail() { try { return localStorage.getItem(railKey) === "1"; } catch { return false; } }
function writeRail(v: boolean) { try { localStorage.setItem(railKey, v ? "1" : "0"); } catch { /* 存不了就只在本次有效 */ } }

/** 收起后的预览卡：悬停 300ms 出现；在图标之间移动时卡片滑过去、换内容，不关再开。 */
function useFlyout(enabled: boolean) {
  const [fly, setFly] = useState<{ id: Section; top: number } | null>(null);
  const [shown, setShown] = useState(false);
  const openT = useRef<number>(), closeT = useRef<number>();
  const shownRef = useRef(false);
  shownRef.current = shown;
  const clear = () => { window.clearTimeout(openT.current); window.clearTimeout(closeT.current); };
  useEffect(() => { if (!enabled) { clear(); setShown(false); } }, [enabled]);
  useEffect(() => clear, []);
  const enter = (id: Section, el: HTMLElement) => {
    if (!enabled) return;
    clear();
    const top = Math.max(12, Math.min(el.getBoundingClientRect().top - 8, window.innerHeight - 340));
    if (shownRef.current) { setFly({ id, top }); return; }
    openT.current = window.setTimeout(() => { setFly({ id, top }); setShown(true); }, 300);
  };
  const leave = () => { window.clearTimeout(openT.current); window.clearTimeout(closeT.current); closeT.current = window.setTimeout(() => setShown(false), 160); };
  const hold = () => window.clearTimeout(closeT.current);
  const hide = () => { clear(); setShown(false); };
  return { fly, shown, enter, leave, hold, hide };
}

function FlyoutCard({ id, top, shown, onEnter, onLeave, done, soon }: { id: Section; top: number; shown: boolean; onEnter: () => void; onLeave: () => void; done: () => void; soon: Obligation[] }) {
  const { store, router } = useApp();
  const meta = sections.find((s) => s.id === id)!;
  const idx = sections.indexOf(meta);
  const go = (fn: () => void) => () => { done(); fn(); };
  const row = (key: string, lead: ReactNode, title: ReactNode, trail: ReactNode, onClick: () => void) => (
    <button key={key} className="fly-row" onClick={go(onClick)}>{lead}<span className="ellipsis grow" style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>{trail}</button>
  );
  let body: ReactNode = null, sub = "";
  if (id === "structure") {
    const gs = [...store.data.groups].sort((a, b) => a.name.localeCompare(b.name));
    sub = `${gs.length} 个集团`;
    body = <>
      {row("all", <span className="v4-dot" style={{ boxShadow: "inset 0 0 0 1.5px var(--muted)" }} />, "全部", null, () => router.update((r) => { r.section = "structure"; r.groupFilter = null; }))}
      {gs.slice(0, 7).map((g) => row(g.id, <span className="v4-dot" style={{ background: store.brandColor(g) }} />, g.name, <span className="t-meta muted num">{store.companyIDsIn(g).size}</span>,
        () => router.update((r) => { r.section = "structure"; r.groupFilter = g.id; })))}
    </>;
  } else if (id === "due") {
    sub = soon.length ? `90 天内 ${soon.length} 件` : "90 天内没有事项";
    body = soon.slice(0, 5).map((o) => {
      const left = D.daysBetween(store.today, o.due);
      return row(o.key, <span className="v4-code" style={{ fontSize: 10, ...companyTint(store, o.company.id) }}>{o.company.jurisdiction}</span>, o.rule.name,
        <span className="num t-meta" style={{ whiteSpace: "nowrap", flex: "none", color: left < 0 ? "var(--danger)" : left <= 30 ? "var(--amber-text)" : "var(--muted)" }}>{leftText(left).replace("天后", "天")}</span>, () => router.openDue(o.key));
    });
  } else if (id === "agents") {
    const ps = [...store.data.parties].sort((a, b) => a.name.localeCompare(b.name));
    sub = `${ps.length} 家中介`;
    body = ps.slice(0, 6).map((p) => row(p.id, <Icon name="person.2" size={13} />, p.name, null, () => router.openAgent(p.id)));
  } else if (id === "companies") {
    const cs = liveCompanies(store).sort((a, b) => a.name.localeCompare(b.name));
    sub = `${cs.length} 家公司`;
    body = cs.slice(0, 6).map((c) => row(c.id, <span className="v4-code" style={{ fontSize: 10, ...companyTint(store, c.id) }}>{c.jurisdiction}</span>, c.name, null, () => router.openCompany(c.id)));
  } else if (id === "files") {
    const n = store.attentionCompanyCount(null);
    sub = n ? `${n} 家公司缺文件` : "文件齐全";
  } else if (id === "people") {
    sub = `${store.data.people.length} 人`;
  }
  return (
    <div className={`flyout ${shown ? "" : "hidden"}`} style={{ left: isSoft() ? 86 : 72, top }} onMouseEnter={onEnter} onMouseLeave={onLeave} role="menu" aria-label={meta.title}>
      <div className="fly-body col" key={id} style={{ gap: 6 }}>
        <button className="row" style={{ justifyContent: "space-between", textAlign: "left" }} onClick={go(() => router.go(id))}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{meta.title}</span>
          <span className="mono t-meta muted">{shortcutLabel(String(idx + 1))}</span>
        </button>
        <span className="t-meta muted">{sub}</span>
        {body && <div className="col" style={{ marginTop: 4, gap: 1 }}>{body}</div>}
      </div>
    </div>
  );
}

function Sidebar() {
  const { store, router } = useApp();
  const [railPref, setRail] = useState(readRail);
  // 柔和：固定 76px 图标栏（DESIGN.md §2.1）；经典：可收起。
  const softStyle = softLike(useUIStyle());
  // 两种风格都可以图标 + 文字或收起为图标栏（4.5：柔和不再强制纯图标）。
  const rail = railPref;
  const toggle = () => setRail((r) => { writeRail(!r); return !r; });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggle(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const fly = useFlyout(rail);
  const soft = softStyle;
  const soon = store.openObligations.filter((o) => D.daysBetween(store.today, o.due) <= 90).sort((a, b) => (a.due < b.due ? -1 : 1));
  const overdue = soon.filter((o) => o.due < store.today).length;
  const badge = (s: Section) => (s === "due" ? soon.filter((o) => D.daysBetween(store.today, o.due) <= 30).length : s === "files" ? store.attentionCompanyCount(null) : 0);
  const groupExists = (id: string) => !!store.group(id);
  const navButton = (s: (typeof sections)[number], i: number) => {
    const on = router.section === s.id || (s.id === "agents" && router.section === "parties");
    const n = badge(s.id);
    return (
      <button key={s.id} onClick={() => { fly.hide(); router.go(s.id); }} title={rail ? undefined : `${s.title}（${shortcutLabel(String(i + 1))}）`} aria-label={rail ? s.title : undefined} aria-current={on ? "page" : undefined}
        onMouseEnter={(e) => fly.enter(s.id, e.currentTarget)} onMouseLeave={fly.leave} onFocus={(e) => rail && fly.enter(s.id, e.currentTarget)} onBlur={fly.leave}
        className={`row gap12 nav-btn ${on ? "on" : ""}`} style={{ position: "relative", height: 36, flex: "none", padding: "0 12px", borderRadius: "var(--r-row)",
          color: on ? "var(--on-selection)" : "var(--ink)", fontWeight: on ? 600 : 500 }}>
        <span style={{ width: 20, flex: "none", display: "inline-flex", justifyContent: "center" }}><Icon name={s.symbol} size={16} /></span>
        <span className="grow lbl" style={{ textAlign: "left" }}>{s.title}</span>
        {n > 0 && !rail && <CountBadge count={n} inverted={on} />}
        {n > 0 && <span className="rail-badge" aria-hidden />}
      </button>
    );
  };
  return (
    <aside className={`side col ${rail ? "rail" : ""} ${softStyle ? "softrail" : ""}`}>
      <div className="drag-region" data-tauri-drag-region style={{ height: platform().os === "mac" ? 34 : 6, flex: "none" }} />
      <div className="row gap8" style={{ paddingBottom: 12, justifyContent: rail ? "center" : undefined }} data-tauri-drag-region>
        <button className="v4-logo" onClick={toggle} title={`${rail ? "展开" : "收起"}侧栏（${shortcutLabel("\\")}）`} aria-label={rail ? "展开侧栏" : "收起侧栏"} aria-expanded={!rail}><LogoMark size={rail ? 34 : 28} /></button>
        {!rail && <span className="grow lbl brand-word" data-tauri-drag-region>Charter</span>}
        {!rail && <ActionMenu icon="plus" ariaLabel="新建" entries={[
          item("新建公司", "building.2", () => router.open({ kind: "newCompany" }), { shortcut: shortcutLabel("N", true) }),
          item("新建集团", "square.stack.3d.up", () => router.openSettings("groups", "new")),
          divider,
          item("上传材料…", "square.and.arrow.down", () => void router.chooseFiles(router.currentImportContext(groupExists)), { shortcut: shortcutLabel("I") }),
        ]} />}
      </div>
      <button className="v4-search" onClick={() => router.open({ kind: "quickSearch" })} aria-label={`搜索公司或人（${shortcutLabel("K")}）`} title={rail ? `搜索（${shortcutLabel("K")}）` : undefined}
        style={rail ? { justifyContent: "center", padding: 0 } : undefined}>
        <Icon name="magnifyingglass" size={14} />
        {!rail && <><span className="grow lbl" style={{ textAlign: "left" }}>搜索公司或人</span><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)" }}>{shortcutLabel("K")}</span></>}
      </button>
      <div className="col slide-host" style={{ gap: 2 }}>
        <SlideBg />
        <nav className="col" style={{ gap: 2 }}>{sections.slice(0, 3).map(navButton)}</nav>
        {rail ? <div className="hairline" style={{ margin: "10px 8px" }} /> : <div className="v4-label lbl" style={{ padding: "16px 12px 6px" }}>档案</div>}
        <nav className="col" style={{ gap: 2 }}>{sections.slice(3).map((s, i) => navButton(s, i + 3))}</nav>
      </div>
      {rail ? <span className="grow" /> : <>
        <div className="v4-label lbl" style={{ padding: "18px 12px 4px" }}>接下来 90 天{overdue ? ` · ${overdue} 件逾期` : ""}</div>
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
      </>}
      <SidebarFooter rail={rail} />
      {rail && fly.fly && <FlyoutCard id={fly.fly.id} top={fly.fly.top} shown={fly.shown} onEnter={fly.hold} onLeave={fly.leave} done={fly.hide} soon={soon} />}
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
    case "verify": return <VerifyView />;
  }
}

export function Shell() {
  const { store, router } = useApp();
  const uiStyle = useUIStyle();
  const blocked = store.isLoading || store.isImporting || store.loadFailed;
  return (
    <div className="row" style={{ height: "100%", alignItems: "stretch" }} key={uiStyle}>
      <Sidebar />
      <main className="col grow" style={{ position: "relative", minWidth: 0, background: "var(--canvas)" }} {...(blocked && !store.isImporting ? { inert: "" } as any : {})}>
        <div className="drag-region" data-tauri-drag-region style={{ height: platform().os === "mac" ? 28 : 6, flex: "none" }} />
        <div className="col grow page-in" key={router.section === "parties" ? "agents" : router.section} style={{ minHeight: 0 }}><Page /></div>
      </main>
      <SheetHost />
      {router.settings && <SettingsView />}
      {store.toast && (
        <div className={`toast ${store.toast.action ? "with-action" : ""} ${store.toast.leaving ? "out" : ""}`} key={store.toast.id} role="status"
          onMouseEnter={() => store.pauseToast()} onMouseLeave={() => store.resumeToast()}>
          <span className="dot" style={{ background: store.toast.kind === "success" ? "var(--lime)" : "var(--danger)", color: store.toast.kind === "success" ? "var(--on-lime)" : "#fff" }}>
            <Icon name={store.toast.kind === "success" ? "checkmark" : "exclamationmark.circle.fill"} size={10} strokeWidth={3.5} />
          </span>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{store.toast.text}</span>
          {store.toast.action && <button onClick={() => { const a = store.toast!.action!; store.dismissToast(); a(); }}>{store.toast.actionTitle}</button>}
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
