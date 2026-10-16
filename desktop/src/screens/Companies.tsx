// 公司页：列表 + 详情；矩阵与结构在单独文件。移植自 CompaniesView.swift / CompanyArchiveView.swift。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import {
  type ArchiveItem, type ArchiveState, type Company, type Document, type DocumentType, type GroupRow, type NodeRef,
  archiveItemName, changeKindLabel, companyStatusLabel, hasFile, isActiveOn, isNotApplicable, itemMarkLabel, itemMarks, ref, stateNeedsAttention,
} from "../domain/models";
import { daysLeft, expiryLabel, obligationDone, percentLabel } from "../domain/engine";
import { isMember, sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import { nonArchiveTypeIDs, ungrouped } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import {
  ActionMenu, Avatar, Button, Checkbox, CountBadge, EmptyStateView, FieldRow, FormGroup, JurisdictionBadge, type MenuEntry, Modal, Pill,
  Popover, ProgressCapsule, RadioGroup, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, header, item, useContextMenu,
} from "../ui/kit";
import { DropTarget, DropZone, useDropTarget } from "../ui/drop";
import { GroupIcon } from "./Shell";
import {
  CompanyWaitingLine, FileThumb, ObligationRow, ReissueRequestSheet, StatusPill, TrustBadge, stateColor, stateLine, useStageFile,
} from "./common";
import { MatrixView } from "./Matrix";
import { StructureView } from "./Structure";

const isForming = (c: Company) => c.status === "forming";
const searchText = (c: Company) => [c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase();

export function CompaniesView() {
  const { router } = useApp();
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="row" style={{ padding: `24px var(--page-edge) ${router.companiesMode === "structure" ? 0 : 24}px` }}>
        <h1 className="t-page">公司</h1>
        <span className="spacer" />
        <span title="列表：逐家查看；矩阵：公司 × 档案类别一览；结构：股权结构图">
          <Segmented options={[["list", "列表"], ["matrix", "矩阵"], ["structure", "结构"]]} value={router.companiesMode} onChange={(m) => router.set("companiesMode", m)} />
        </span>
      </div>
      <div className="col grow" style={{ minHeight: 0 }}>
        {router.companiesMode === "list" ? <CompanyList /> : router.companiesMode === "matrix" ? <MatrixView /> : <StructureView />}
      </div>
    </div>
  );
}

// MARK: - 左侧列表

function CompanyList() {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = (c: Company) => !q || searchText(c).includes(q) || store.jurisdictionName(c.jurisdiction).toLowerCase().includes(q);
  const filter = router.groupFilter;
  const scope = store.companyIDsForFilter(filter);
  const filtered = store.data.companies.filter((c) => matches(c) && (!scope || scope.has(c.id))).sort((a, b) => a.name.localeCompare(b.name, "zh"));

  const sections: { id: string; title: string; rows: GroupRow[] }[] = [];
  for (const g of filter == null ? store.data.groups : store.data.groups.filter((g) => g.id === filter)) {
    const rows = store.rowsOf(g).filter((r) => { const c = store.company(r.companyID); return !!c && matches(c); });
    if (rows.length) sections.push({ id: g.id, title: g.name, rows });
  }
  if (filter == null || filter === ungrouped) {
    const un = store.ungroupedCompanies.filter(matches).map((c) => ({ companyID: c.id, depth: 0, viaNominee: false, unconnected: false }));
    if (un.length) sections.push({ id: ungrouped, title: "未归入集团", rows: un });
  }
  const firstSection = new Map<string, { id: string; title: string }>();
  for (const s of sections) for (const r of s.rows) if (!firstSection.has(r.companyID)) firstSection.set(r.companyID, { id: s.id, title: s.title });

  // 默认选中最需要处理的公司
  useEffect(() => {
    const id = router.selectedCompanyID;
    if (id && store.company(id) && (!scope || scope.has(id))) return;
    const key = (c: Company): number[] => {
      const items = store.archive(c);
      const counted = items.filter((i) => !isNotApplicable(i.state));
      return [items.some((i) => i.state.kind === "expired") ? 0 : 1, items.some((i) => i.state.kind === "expiring") ? 0 : 1,
        items.some((i) => i.state.kind === "needsUpdate" || i.state.kind === "noDate") ? 0 : 1, counted.length ? counted.filter((i) => hasFile(i.state)).length / counted.length : 2];
    };
    const cmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    let best: Company | undefined, bk: number[] | undefined;
    for (const c of filtered) { const k = key(c); if (!bk || cmp(k, bk) < 0) { best = c; bk = k; } }
    router.set("selectedCompanyID", best?.id ?? null);
  }, [filter]);

  // ⌘F 聚焦搜索；上下键切换
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); return; }
      if (router.sheet || router.settings) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!filtered.length) return;
      e.preventDefault();
      const cur = filtered.findIndex((c) => c.id === router.selectedCompanyID);
      const start = cur < 0 ? (e.key === "ArrowDown" ? -1 : filtered.length) : cur;
      const next = Math.min(Math.max(start + (e.key === "ArrowDown" ? 1 : -1), 0), filtered.length - 1);
      router.set("selectedCompanyID", filtered[next].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const selected = router.selectedCompanyID ? store.company(router.selectedCompanyID) : undefined;
  const group = filter && filter !== ungrouped ? store.group(filter) : undefined;
  const list = (
    <div className="col surface" style={{ padding: 12, gap: 8, height: "100%", minHeight: 0 }}>
      <label className="row gap8" style={{ height: 38, padding: "0 14px", borderRadius: 999, background: "var(--band)", flex: "none" }} title="搜索公司（Ctrl/⌘ F）">
        <Icon name="magnifyingglass" className="muted" />
        <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索公司、编号或法域" className="grow" style={{ border: 0, background: "transparent", outline: "none", font: "inherit", color: "inherit", minWidth: 0 }} />
        {query && <button className="muted" onClick={() => setQuery("")} aria-label="清除"><Icon name="xmark.circle.fill" /></button>}
      </label>
      <div className="scroll grow col" style={{ gap: 2, minHeight: 0 }}>
        {sections.map((sec) => (
          <div key={sec.id} className="col" style={{ gap: 2 }}>
            <div className="row gap8" style={{ padding: "16px 8px 4px" }}>
              <GroupIcon groupID={sec.id} size={18} />
              <span className="t-micro muted ellipsis grow">{sec.title}</span>
              {sec.id !== ungrouped && filter === sec.id && <Button kind="quiet" size="small" title={`归档到${sec.title}的公司。拖入文件即可归档到这里`} onClick={() => void router.chooseFiles({ kind: "group", id: sec.id })}>上传材料…</Button>}
            </div>
            {sec.rows.map((r) => {
              const c = store.company(r.companyID);
              if (!c) return null;
              const first = firstSection.get(c.id);
              return <CompanyRailRow key={sec.id + c.id} c={c} r={r} alsoIn={first && first.id !== sec.id ? first.title : undefined} />;
            })}
          </div>
        ))}
        {!sections.length && (
          <div className="col gap10" style={{ alignItems: "center", padding: 16 }}>
            <span className="muted" style={{ fontSize: 13 }}>{q ? `没有找到“${query}”` : `${store.filterName(filter)}还没有公司`}</span>
            {!q && filter && filter !== ungrouped && <Button kind="primary" size="small" onClick={() => router.open({ kind: "newCompanyInGroup", group: filter })}>在此集团新建公司</Button>}
            {filter && <Button size="small" onClick={() => router.set("groupFilter", null)}>显示全部公司</Button>}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="row grow" style={{ alignItems: "stretch", minHeight: 0 }}>
      <div style={{ width: "clamp(240px, calc(100% - 560px), 300px)", flex: "none", margin: "0 0 var(--page-edge) var(--page-edge)", minHeight: 0 }}>
        {group ? <DropTarget message={`松开即可归档到${group.name}`} onDrop={(paths) => router.startImport(paths, { kind: "group", id: group.id })} style={{ height: "100%" }}>{list}</DropTarget> : list}
      </div>
      <div className="col grow" style={{ minWidth: 520, minHeight: 0 }}>
        {selected ? <CompanyDetail key={selected.id} company={selected} /> : (
          <div className="surface col grow" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px" }}>
            <EmptyStateView symbol="building.2" title="选择公司" message="从左侧列表选择公司，或新建公司。" actionTitle="新建公司" action={() => router.open({ kind: "newCompany" })} />
          </div>
        )}
      </div>
    </div>
  );
}

function alertInfo(store: ReturnType<typeof useApp>["store"], c: Company): { severity: 0 | 1 | 2; text: string } {
  const alerts: string[] = [];
  const o = store.complianceOn ? store.openObligations.find((x) => x.company.id === c.id) : undefined;
  const left = o ? daysLeft(o, store.today) : 999;
  if (o && left <= 30) alerts.push(left < 0 ? `合规事项“${o.rule.name}”已逾期` : `合规事项“${o.rule.name}”${left} 天后到期`);
  const items = store.archive(c);
  const n = (k: ArchiveState["kind"]) => items.filter((i) => i.state.kind === k).length;
  if (n("expired")) alerts.push(`${n("expired")} 份已过期`);
  if (n("needsUpdate")) alerts.push(`${n("needsUpdate")} 份需更新`);
  if (n("expiring")) alerts.push(`${n("expiring")} 份即将到期`);
  if (n("noDate")) alerts.push(`${n("noDate")} 份日期待核对`);
  const severity = left < 0 || n("expired") ? 2 : items.some((i) => stateNeedsAttention(i.state)) || left <= 30 ? 1 : 0;
  return { severity, text: alerts.join("，") };
}

function CompanyRailRow({ c, r, alsoIn }: { c: Company; r: GroupRow; alsoIn?: string }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const dup = !!alsoIn;
  const on = router.selectedCompanyID === c.id && !dup;
  const { severity, text } = alertInfo(store, c);
  const items = store.archive(c).filter((i) => !isNotApplicable(i.state));
  const parts = [store.jurisdictionName(c.jurisdiction), isForming(c) ? "设立中" : `档案 ${items.filter((i) => hasFile(i.state)).length}/${items.length}`];
  if (r.percent != null) parts.push(`上级持股 ${percentLabel(r.percent)}`);
  const sub = alsoIn ? `也属于 ${alsoIn}` : parts.join("，");
  const menu: MenuEntry[] = [
    item("复制注册编号", "doc.on.doc", () => void platform().copyText(c.registrationNumber)),
    item("导出材料…", "archivebox", () => router.open({ kind: "exportAll", companyID: c.id })),
    item("在股权结构中打开", "point.3.connected.trianglepath.dotted", () => { router.groupFilter = store.groupsContaining(c.id)[0]?.id ?? null; router.openStructure(); }),
  ];
  return (
    <button className={`row gap10 ${on ? "" : "hover-band"}`} onClick={() => router.set("selectedCompanyID", c.id)} onContextMenu={(e) => ctx.open(e, menu)}
      title={c.name} aria-current={on || undefined}
      style={{ minHeight: 48, padding: `8px 8px 8px ${8 + Math.min(r.depth, 4) * 12}px`, borderRadius: "var(--r-row)", textAlign: "left", width: "100%",
        background: on ? "var(--selection)" : undefined, color: on ? "var(--on-selection)" : "var(--ink)", opacity: dup ? 0.55 : 1, transition: "background .15s" }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, flex: "none", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700,
        background: on ? "color-mix(in srgb, var(--on-selection) 16%, transparent)" : "var(--band)" }}>{c.jurisdiction}</span>
      <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.name}</span>
        <span className="ellipsis" style={{ fontSize: 11.5, opacity: on ? 0.72 : 1, color: on ? undefined : "var(--muted)" }}>{sub}</span>
      </span>
      {severity > 0 && !dup && <span title={text} aria-label={text} style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: severity === 2 ? "var(--danger)" : "var(--amber)" }} />}
      {ctx.node}
    </button>
  );
}

// MARK: - 公司详情

function CompanyDetail({ company }: { company: Company }) {
  const { store, router } = useApp();
  const [width, setWidth] = useState(1000);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const norm = (t: number) => (t === 1 ? 0 : t === 4 && !store.complianceOn ? 0 : t);
  const tab = norm(router.companyTab);
  const tabs: [number, string][] = [[0, "档案"], [3, "变更记录"], [2, "历史版本"], ...(store.complianceOn ? [[4, "合规事项"] as [number, string]] : [])];
  const wide = width >= 1120;
  const cref = ref("company", company.id);
  return (
    <DropTarget message={`松开即可归档到 ${company.name}`} onDrop={(paths) => router.startImport(paths, { kind: "company", id: company.id })} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div ref={box} className="scroll grow">
        <div className="surface" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px", maxWidth: 1200 }}>
          <div style={{ padding: 24 }}><Hero company={company} /></div>
          <div className="hairline" />
          <KeyFacts company={company} />
          {store.openRequestsFor(cref).length > 0 && <><div className="hairline" /><div style={{ padding: "12px 24px" }}><CompanyWaitingLine companyID={company.id} /></div></>}
          <div className="hairline" />
          <div className="row" style={{ padding: "16px 24px" }}><Segmented options={tabs} value={tab} onChange={(t) => router.set("companyTab", t)} /></div>
          <div className="hairline" />
          <div key={tab} className="appear">
            {tab === 0 ? (wide ? (
              <div className="row" style={{ alignItems: "stretch" }}>
                <div className="grow" style={{ padding: 24, minWidth: 0 }}><CompanyArchiveView company={company} /></div>
                <div style={{ width: 1, background: "var(--hairline)" }} />
                <div style={{ width: 300, padding: 24, flex: "none" }}><SidePanel company={company} /></div>
              </div>
            ) : (
              <div className="col">
                <div style={{ padding: 24 }}><CompanyArchiveView company={company} /></div>
                <div className="hairline" />
                <div style={{ padding: 24 }}><SidePanel company={company} /></div>
              </div>
            )) : <div style={{ padding: 24 }}>{tab === 2 ? <VersionsTab company={company} /> : tab === 4 ? <ObligationsTab company={company} /> : <HistoryTab company={company} />}</div>}
          </div>
        </div>
      </div>
    </DropTarget>
  );
}

function Hero({ company }: { company: Company }) {
  const { store, router } = useApp();
  const groups = store.groupsContaining(company.id);
  const id = company.id;
  const edit: MenuEntry[] = [
    item("编辑公司资料…", "pencil", () => router.open({ kind: "editCompany", companyID: id })),
    item("记录变更…", "arrow.triangle.2.circlepath", () => router.open({ kind: "change", companyID: id })),
    divider,
    item("添加上级（股东）…", "arrow.up", () => router.open({ kind: "addRelation", companyID: id, upward: true })),
    item("添加下级公司…", "arrow.down", () => router.open({ kind: "addRelation", companyID: id, upward: false })),
  ];
  if (store.data.groups.length) {
    edit.push(divider, header("集团归属"));
    for (const g of store.data.groups) {
      const m = store.membership(id, g);
      if (isMember(m)) edit.push(item(`从${g.name}移出（${sourceLabel(m)}）`, "minus.circle", () => {
        let text = "";
        const u = store.undoable("移出集团", () => { text = store.moveOut(id, g.id); });
        store.showToast(text, u ? () => store.undoID(u) : undefined);
      }));
      else if (m.kind === "excluded") edit.push(item(`恢复到${g.name}（已排除）`, "arrow.uturn.backward", () => { store.restoreToGroup(id, g.id); store.showToast(`已恢复为按股权归入${g.name}`); }));
      else edit.push(item(`归入「${g.name}」`, "plus.circle", () => { store.addToGroup(id, g.id); store.showToast(`已归入${g.name}`); }));
    }
  }
  return (
    <div className="row wrap" style={{ gap: 16, alignItems: "flex-start" }}>
      <div className="row start gap16 grow" style={{ minWidth: 280 }}>
        <JurisdictionBadge code={company.jurisdiction} size={54} highlighted />
        <div className="col gap8" style={{ minWidth: 0 }}>
          <h2 className="t-title selectable" title={company.name} style={{ margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{company.name}</h2>
          <div className="row gap6 wrap">
            <Pill text={store.jurisdictionName(company.jurisdiction)} />
            {company.entityForm && <Pill text={company.entityForm} />}
            {company.status !== "active" && <Pill text={companyStatusLabel[company.status]} kind="strong" />}
            {groups.map((g) => <GroupTag key={g.id} groupID={g.id} companyID={company.id} />)}
          </div>
        </div>
      </div>
      <div className="row gap8 wrap">
        <ActionMenu title="编辑与上下级" entries={edit} />
        <Button icon="archivebox" title="导出全部现行材料，也可包含历史版本" onClick={() => router.open({ kind: "exportAll", companyID: id })}>导出全部档案</Button>
        <Button title="选择 PDF、照片或文件夹，归档到这家公司。拖入文件即可归档到这里" onClick={() => void router.chooseFiles({ kind: "company", id })}>上传材料…</Button>
        <Button title="换董事、股权转让、改名或迁址：更新记录，并标出需要重开的文件" onClick={() => router.open({ kind: "change", companyID: id })}>记录变更…</Button>
        <Button kind="primary" title="按银行开户、年度审计或 KYC 用途选择材料，预览缺件后生成文件包" onClick={() => router.open({ kind: "packet", companyID: id })}>准备文件包…</Button>
      </div>
    </div>
  );
}

export function GroupTag({ groupID, companyID }: { groupID: string; companyID: string }) {
  const { store, router } = useApp();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const g = store.group(groupID);
  if (!g) return null;
  const m = store.membership(companyID, g);
  return (
    <>
      <button ref={anchor} className="row gap4" onClick={() => setOpen(!open)} title={`${g.name}：${sourceLabel(m)}`}
        style={{ height: 24, padding: "0 10px", borderRadius: 999, background: "var(--lime-soft)", color: "var(--lime-text)", fontSize: 12, fontWeight: 600 }}>
        {g.name}{m.kind === "manual" && <Icon name="hand.point.up.left" size={9} />}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <div className="col gap8" style={{ padding: 16, width: 320 }}>
          <div className="row gap8"><span style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</span><Pill text={sourceLabel(m)} kind={m.kind === "manual" ? "outline" : "neutral"} /></div>
          <span className="t-meta muted">{store.membershipExplanation(companyID, g)}</span>
          {m.kind === "derived" && <span className="t-meta muted">这是按持股关系自动纳入的。移出后会记为“已排除”，之后股权变化也不会再把它加回来。</span>}
          <div className="row gap8" style={{ paddingTop: 4 }}>
            <Button size="small" onClick={() => { setOpen(false); router.selectedCompanyID = companyID; router.openStructure({ group: g.id }); }}>在结构中查看</Button>
            {m.kind !== "top" && <Button kind="quiet" size="small" onClick={() => {
              setOpen(false);
              let text = "";
              const u = store.undoable("移出集团", () => { text = store.moveOut(companyID, g.id); });
              store.showToast(text, u ? () => store.undoID(u) : undefined);
            }}>移出集团</Button>}
            <Button kind="quiet" size="small" onClick={() => { setOpen(false); router.open({ kind: "groupMembers", group: g.id }); }}>管理成员…</Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function KeyFacts({ company }: { company: Company }) {
  const { store } = useApp();
  const items = store.archive(company).filter((i) => !isNotApplicable(i.state));
  const have = items.filter((i) => hasFile(i.state)).length;
  const fact = (label: string, value: string, mono: boolean, grow?: boolean) => (
    <div className="col" style={{ gap: 6, padding: "16px 24px", minWidth: 150, flex: grow ? "1 1 240px" : "none" }}>
      <span className="t-meta muted">{label}</span>
      <span className={`selectable ${mono ? "mono" : ""}`} style={{ fontSize: mono ? 15 : 14, fontWeight: 500, color: value ? "var(--ink)" : "var(--muted)" }}>{value || "未填写"}</span>
    </div>
  );
  return (
    <div className="row wrap facts" style={{ alignItems: "stretch" }}>
      {fact("注册编号", company.registrationNumber, true)}
      <span className="vrule" />
      {fact("成立日期", company.incorporationDate ?? "", true)}
      <span className="vrule" />
      {fact("注册地址", company.registeredAddress, false, true)}
      <span className="vrule" />
      <div className="col" style={{ gap: 6, padding: "16px 24px", minWidth: 150 }}>
        <span className="t-meta muted">档案</span>
        {isForming(company) ? <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>成立后统计</span> : <>
          <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{have}/{items.length}</span>
          <ProgressCapsule value={items.length ? have / items.length : 0} style={{ maxWidth: 140 }} />
        </>}
      </div>
    </div>
  );
}

export function ChangeRowMenu({ companyID, appointmentID, holdingID }: { companyID: string; appointmentID?: string; holdingID?: string }) {
  const { router } = useApp();
  return <ActionMenu icon="ellipsis" kind="quiet" size="small" align="end" ariaLabel="更多操作" entries={[
    item(holdingID ? "记录变更（股权转让）…" : "记录变更（离任或变更）…", "arrow.triangle.2.circlepath",
      () => router.open({ kind: "changeFrom", companyID, changeKind: holdingID ? "shareholderChange" : "directorChange", appointmentID, holdingID })),
  ]} />;
}

function SidePanel({ company }: { company: Company }) {
  const { store, router } = useApp();
  const officers = store.officers(company.id);
  const holders = store.directShareholders(company.id);
  const b = store.breakdownOf(company.id);
  const chains = store.chainsFromTops(company.id);
  const title = (t: string, n: number) => <div className="row"><span className="t-section">{t}</span><span className="spacer" />{n > 0 && <CountBadge count={n} />}</div>;
  return (
    <div className="col gap24">
      <div className="col gap10">
        {title("任职人员", officers.length)}
        {!officers.length && <span className="muted" style={{ fontSize: 13 }}>未录入</span>}
        {officers.map((a) => (
          <div key={a.id} className="row gap4">
            <button className="row gap10 grow" style={{ textAlign: "left", minWidth: 0 }} onClick={() => router.openPerson(a.personID)}>
              <Avatar name={store.nameOf(ref("person", a.personID))} />
              <span className="col" style={{ gap: 1, minWidth: 0 }}>
                <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{store.nameOf(ref("person", a.personID))}</span>
                <span className="muted ellipsis" style={{ fontSize: 11.5 }}>{a.title}{a.from ? `，自 ${a.from}` : ""}</span>
              </span>
            </button>
            <ChangeRowMenu companyID={company.id} appointmentID={a.id} />
          </div>
        ))}
      </div>
      <div className="hairline" />
      <div className="col gap10">
        {title("股东", holders.length)}
        {!holders.length && <span className="muted" style={{ fontSize: 13 }}>未录入</span>}
        {holders.map((h) => (
          <div key={h.id} className="row gap8">
            <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{store.nameOf(h.holder)}</span>
              {h.isNominee && <span className="amber-text" style={{ fontSize: 11.5, fontWeight: 600 }}>代{h.beneficialOwner ? store.nameOf(h.beneficialOwner) : "他人"}持有</span>}
            </span>
            <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{percentLabel(h.percent)}</span>
            <ChangeRowMenu companyID={company.id} holdingID={h.id} />
          </div>
        ))}
        {(b.owners.length > 0 || b.unknown > 0.005) && <>
          <div className="hairline" style={{ margin: "2px 0" }} />
          <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>穿透后</span>
          {b.owners.map((o) => (
            <div key={o.owner.kind + o.owner.id} className="row gap6">
              <span className="ellipsis" style={{ fontSize: 13 }}>{store.nameOf(o.owner)}</span>
              {o.viaNominee && <Pill text="含代持" kind="warn" />}
              <span className="spacer" /><span className="mono" style={{ fontSize: 13 }}>{percentLabel(o.percent)}</span>
            </div>
          ))}
          {b.unknown > 0.005 && <div className="row amber-text" style={{ fontSize: 13 }}><span>未识别</span><span className="spacer" /><span className="mono">{percentLabel(b.unknown)}</span></div>}
        </>}
        {chains.length > 0 && <>
          <div className="hairline" style={{ margin: "2px 0" }} />
          {chains.slice(0, 3).map((c) => <span key={c.chain.id + c.group.id} className="muted selectable" style={{ fontSize: 12 }}>{store.chainText(c.chain)}</span>)}
        </>}
        <Button kind="accent" icon="doc.on.doc" style={{ width: "100%", marginTop: 4 }} onClick={() => { void platform().copyText(store.companySummary(company)); store.showToast("公司资料摘要已复制。"); }}>复制公司资料摘要</Button>
      </div>
    </div>
  );
}

// MARK: - 档案清单

const dismissedKey = (id: string) => `nextSteps.dismissed.${id}`;
function dismissedSteps(id: string): Set<string> {
  try { return new Set(JSON.parse(platform().prefGet(dismissedKey(id)) ?? "[]")); } catch { return new Set(); }
}

export function CompanyArchiveView({ company }: { company: Company }) {
  const { store, router } = useApp();
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const cref = ref("company", company.id);
  const hasDocuments = store.data.documents.some((d) => d.owner.kind === "company" && d.owner.id === company.id);
  const [firstImpression] = useState(!hasDocuments);
  const [dismissed, setDismissed] = useState(() => dismissedSteps(company.id));
  const [showNA, setShowNA] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = width < 700;
  const items = store.archive(company);
  const ids = store.itemIDs(company);
  const listed = items.filter((i) => !i.isExtra || ids.includes(i.typeID));
  const main = listed.filter((i) => !isNotApplicable(i.state));
  const na = listed.filter((i) => isNotApplicable(i.state));
  const hidden = store.hiddenByEntityForm(company);
  const others = items.filter((i) => i.isExtra && !ids.includes(i.typeID));
  const counted = items.filter((i) => !isNotApplicable(i.state));
  const dismiss = (k: string) => { const s = new Set(dismissed); s.add(k); setDismissed(s); platform().prefSet(dismissedKey(company.id), JSON.stringify([...s].sort())); };
  const needsDirector = !isForming(company) && !dismissed.has("director") && !store.data.appointments.some((a) => a.companyID === company.id && isActiveOn(a, store.today));
  const needsParty = !dismissed.has("party") && !company.defaultPartyID;
  const rows = (list: ArchiveItem[]) => list.map((it, i) => <div key={it.typeID}>{i > 0 && <div className="hairline" />}<ArchiveRow company={company} item={it} compact={compact} /></div>);
  void cref;
  return (
    <div ref={box} className="col gap12">
      <div className="row baseline gap8 wrap">
        <span className="t-section">档案清单</span>
        <span className="t-meta muted num">{isForming(company) ? "成立后开始统计" : `${counted.filter((i) => hasFile(i.state)).length}/${counted.length} 已归档`}</span>
        <span className="spacer" />
        <Button kind="quiet" size="small" title="只为这家公司增加或去掉条目" onClick={() => router.open({ kind: "companyItems", companyID: company.id })}>自定义清单</Button>
        <button className="row gap4 muted t-meta" onClick={() => { router.archiveScope = company.jurisdiction; router.openSettings("archiveItems"); }}>
          编辑{store.jurisdictionName(company.jurisdiction)}通用清单<Icon name="arrow.up.right" size={10} />
        </button>
      </div>
      <span className="t-meta muted">按法域起始清单管理；可按实际需要调整。未持有材料可标记保管方、权限受限或不适用。</span>
      {isForming(company) ? (
        <div className="row start gap12 surface" style={{ padding: 16, background: "var(--canvas)" }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--band)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="hammer" /></span>
          <div className="col grow" style={{ gap: 4 }}>
            <span className="t-row">设立中</span>
            <span className="t-meta muted">注册证书、名册、{store.officerNoun(company.id)}和股东会在成立后产生，现在不算缺失，也不计入待处理和完成度。设立期间的申请材料可以照常上传。</span>
          </div>
          <Button size="small" title="记录成立：更新状态和成立日期" onClick={() => router.open({ kind: "changeFrom", companyID: company.id, changeKind: "statusChange" })}>已成立…</Button>
        </div>
      ) : (!hasDocuments || (firstImpression && counted.some((i) => !hasFile(i.state)))) && (
        <div className="col gap12" style={{ paddingBottom: 8 }}>
          <DropZone title={`把 ${company.name} 的文件拖进来`}
            subtitle={(counted.length ? `${store.jurisdictionName(company.jurisdiction)}公司通常需要：${counted.slice(0, 4).map(archiveItemName).join("、")}${counted.length > 4 ? `等 ${counted.length} 份。` : "。"}` : "注册证书、章程、董事名册等文件都可以拖进来。") + "Charter 会识别并逐项归位。"}
            action={() => void router.chooseFiles({ kind: "company", id: company.id })} onDrop={(paths) => router.startImport(paths, { kind: "company", id: company.id })} />
          {counted.length > 0 && <div className="col gap8" style={{ paddingTop: 4 }}>
            <span className="t-meta muted">清单预览</span>
            <div className="row wrap gap6">{counted.map((it) => {
              const done = hasFile(it.state);
              return <span key={it.typeID} className="row gap4" aria-label={`${archiveItemName(it)}，${done ? "已归档" : "未归档"}`}
                style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: done ? 600 : 400, color: done ? "var(--lime-text)" : "var(--muted)",
                  background: done ? "var(--lime-soft)" : "transparent", border: done ? "none" : "1px dashed var(--hairline)" }}>{done && <Icon name="checkmark" size={9} />}{archiveItemName(it)}</span>;
            })}</div>
          </div>}
          {(needsDirector || needsParty) && <div className="col gap8" style={{ paddingTop: 4 }}>
            <span className="t-meta muted">下一步</span>
            {needsDirector && <NextStepRow icon="person.badge.plus" title={`添加${store.officerNoun(company.id)}`} detail="任职名册和在职证明会据此核对。" onDismiss={() => dismiss("director")}>
              <Button size="small" onClick={() => router.open({ kind: "editCompany", companyID: company.id })}>添加任职人员…</Button>
            </NextStepRow>}
            {needsParty && <NextStepRow icon="person.2" title="设置负责方" detail="请补发和催办默认发给它。" onDismiss={() => dismiss("party")}>
              {store.data.parties.length ? <SelectField options={store.data.parties.map((p) => [p.id, p.name] as [string, string])} value={company.defaultPartyID ?? ""} placeholder="选择负责方" minWidth={180}
                onChange={(id) => { const name = store.party(id)?.name ?? "负责方"; store.performUndoable("设置负责方", `已把 ${name} 设为负责方`, (d) => { const c = d.companies.find((x) => x.id === company.id); if (c) c.defaultPartyID = id; }); }} />
                : <Button size="small" onClick={() => router.open({ kind: "editCompany", companyID: company.id })}>编辑公司资料…</Button>}
            </NextStepRow>}
          </div>}
          <span className="t-meta muted">也可以稍后再补，档案清单会提醒缺什么。</span>
        </div>
      )}
      <div className="col">
        <ArchiveHeaderRow compact={compact} />
        {rows(main)}
      </div>
      {(hidden.length > 0 || na.length > 0) && (
        <div className="col" style={{ paddingTop: 8 }}>
          <button className="row gap6 t-meta muted" onClick={() => setShowNA(!showNA)} title="标为不适用、或按实体类型不需要的条目。不计入缺件和完成度。" aria-expanded={showNA}>
            <span className={`chev ${showNA ? "open" : ""}`}><Icon name="chevron.right" size={9} /></span>不适用 {na.length + hidden.length} 项
          </button>
          {showNA && <div className="col" style={{ paddingTop: 6 }}>
            {rows(na)}
            {hidden.length > 0 && <div className="row baseline gap8" style={{ padding: "10px 0" }}>
              <span className="t-meta muted grow">按实体类型（{company.entityForm}）不需要：{hidden.map((t) => t.name).join("、")}</span>
              <Button kind="quiet" size="small" title="在这家公司的清单里单独加回这些条目" onClick={() => router.open({ kind: "companyItems", companyID: company.id })}>改为需要</Button>
            </div>}
          </div>}
        </div>
      )}
      {others.length > 0 && <>
        <span className="t-meta muted" style={{ paddingTop: 8 }}>其他文件</span>
        <div className="col">{rows(others)}</div>
      </>}
    </div>
  );
}

function NextStepRow({ icon, title, detail, onDismiss, children }: { icon: string; title: string; detail: string; onDismiss: () => void; children: ReactNode }) {
  return (
    <div className="row gap12" style={{ padding: "8px 12px", borderRadius: 12, background: "var(--band)" }}>
      <span className="muted" style={{ width: 20, textAlign: "center" }} aria-hidden><Icon name={icon} size={13} /></span>
      <span className="col grow" style={{ gap: 1, minWidth: 0 }}><span className="t-row">{title}</span><span className="t-meta muted ellipsis">{detail}</span></span>
      {children}
      <Button kind="quiet" size="small" icon="xmark" title="不再提示" ariaLabel={`不再提示${title}`} onClick={onDismiss} />
    </div>
  );
}

const ArchiveCols = { state: 104, date: 92, actions: 132, stateC: 88, dateC: 80, actionsC: 94 };

function ArchiveHeaderRow({ compact }: { compact: boolean }) {
  return (
    <div aria-hidden>
      <div className="row t-micro muted" style={{ gap: 12, height: 32, padding: "0 16px" }}>
        <span className="grow" style={{ paddingLeft: 28, minWidth: compact ? 90 : 120 }}>条目</span>
        <span style={{ width: compact ? ArchiveCols.stateC : ArchiveCols.state, flex: "none" }}>状态</span>
        {!compact && <span style={{ width: ArchiveCols.date, flex: "none" }}>签发</span>}
        <span style={{ width: compact ? ArchiveCols.dateC : ArchiveCols.date, flex: "none" }}>到期</span>
        <span style={{ width: compact ? ArchiveCols.actionsC : ArchiveCols.actions, flex: "none" }} />
      </div>
      <div className="hairline" />
    </div>
  );
}

export function StateGlyph({ state }: { state: ArchiveState }) {
  const [icon, color] = ((): [string, string] => {
    switch (state.kind) {
      case "valid": case "noDate": return ["checkmark.circle.fill", "color-mix(in srgb, var(--ink) 75%, transparent)"];
      case "expiring": return ["clock.badge.exclamationmark", "var(--amber-text)"];
      case "expired": return ["xmark.octagon.fill", "var(--danger)"];
      case "needsUpdate": return ["arrow.triangle.2.circlepath", "var(--amber-text)"];
      case "missing": return ["circle.dashed", "color-mix(in srgb, var(--muted) 60%, transparent)"];
      case "marked":
        switch (state.mark) {
          case "notObtained": return ["questionmark.circle", "var(--muted)"];
          case "restricted": return ["lock.circle", "var(--muted)"];
          case "unverified": return ["questionmark.diamond", "var(--amber-text)"];
          case "external": return ["building.columns", "var(--muted)"];
          default: return ["minus", "color-mix(in srgb, var(--muted) 60%, transparent)"];
        }
    }
  })();
  return <span style={{ color, display: "inline-flex" }} aria-hidden><Icon name={icon} size={15} /></span>;
}

function ArchiveRow({ company, item: it, compact }: { company: Company; item: ArchiveItem; compact: boolean }) {
  const { store, router } = useApp();
  const [startStage, stageNode, busy] = useStageFile();
  const [reissue, setReissue] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  const d = it.document;
  const owner: NodeRef = ref("company", company.id);
  const canRequest = ["missing", "expired", "expiring", "needsUpdate"].includes(it.state.kind);
  const waiting = store.openRequest(owner, it.typeID);
  const stageFile = (path?: string) => void startStage({ typeID: it.typeID, owner, replaces: d, form: d?.form ?? "扫描件", path });
  const { ref: dropRef, targeted } = useDropTarget((paths) => {
    if (paths.length > 1) router.startImport(paths, { kind: "company", id: company.id });
    else stageFile(paths[0]);
  });
  const noteShown = d?.notes || it.note;
  const local = it.type?.localNames[0];
  const sub = [local && local !== archiveItemName(it) ? local : null, noteShown ? `备注：${noteShown}` : null].filter(Boolean).join("　");
  const dateProblem = it.state.kind === "expired" || it.state.kind === "expiring";
  const menu: MenuEntry[] = [];
  if (canRequest) {
    menu.push(waiting ? item(`已在等${store.party(waiting.partyID)?.name ?? "负责方"}补发`, "hourglass", () => {}, { disabled: true }) : item("请负责方补发…", "paperplane", () => setReissue(true)), divider);
  }
  if (d) {
    menu.push(item("查看与编辑（到期日、备注）…", "doc.text.magnifyingglass", () => router.open({ kind: "document", id: d.id })),
      item("打开文件", "arrow.up.forward.app", () => void store.openDocument(d)),
      item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", "folder", () => void store.revealDocument(d)));
  } else {
    menu.push(header("标记原因"), ...itemMarks.map((m) => item(`标记为${itemMarkLabel[m]}`, "tag", () => store.setMark(m, it.typeID, company.id))));
    if (it.state.kind === "marked") menu.push(item("清除标记", "xmark.circle", () => store.setMark(null, it.typeID, company.id)));
    menu.push(divider, item("编辑备注…", "square.and.pencil", () => { setNoteText(it.note); setNoteOpen(true); }));
  }
  menu.push(divider, item("本公司不再管理此条目", "minus.circle", () => store.dropItem(it.typeID, company.id)));
  const open = () => (d ? router.open({ kind: "document", id: d.id }) : stageFile());
  return (
    <div ref={(el) => { (dropRef as React.MutableRefObject<HTMLDivElement | null>).current = el; (anchor as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      data-drop tabIndex={0} className="archive-row row" onDoubleClick={() => d && router.open({ kind: "document", id: d.id })}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); }}
      aria-label={`${archiveItemName(it)}，${stateText(it.state)}，到期日 ${d ? expiryLabel(d, it.type) : "—"}`}
      style={{ gap: 12, padding: "8px 16px", minHeight: 56, borderRadius: "var(--r-row)", fontSize: 12.5,
        background: targeted ? "var(--lime-soft)" : undefined, outline: targeted ? "1.5px dashed color-mix(in srgb, var(--lime-text) 60%, transparent)" : undefined }}>
      <div className="row gap10 grow" style={{ minWidth: compact ? 90 : 120 }}>
        <span style={{ width: 18, flex: "none" }}><StateGlyph state={it.state} /></span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <div className="row gap6 wrap">
            <span className="t-row" title={archiveItemName(it)} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{archiveItemName(it)}</span>
            {it.olderVersions > 0 && <span className="tag">旧版 {it.olderVersions}</span>}
            {waiting ? <span className="tag ellipsis" title={`已等 ${store.daysWaiting(waiting)} 天，${D.short(waiting.followUpOn)}跟进`}>在等{store.party(waiting.partyID)?.name ?? "负责方"}补发</span>
              : canRequest && <span className="row-hover"><Button kind="quiet" size="small" title="请负责方补发这一份" onClick={() => setReissue(true)}>请补发</Button></span>}
          </div>
          {sub && <span className="muted ellipsis" style={{ fontSize: 12 }} title={sub}>{sub}</span>}
        </div>
      </div>
      <span style={{ width: compact ? ArchiveCols.stateC : ArchiveCols.state, flex: "none" }}><StatusPill state={it.state} /></span>
      {!compact && <span className="t-meta num" style={{ width: ArchiveCols.date, flex: "none", color: d ? "var(--ink)" : "var(--muted)" }}>{d?.issueDate ?? "—"}</span>}
      <span className="t-meta num" style={{ width: compact ? ArchiveCols.dateC : ArchiveCols.date, flex: "none", color: dateProblem ? stateColor(it.state) : "var(--muted)" }}>{d ? expiryLabel(d, it.type) : "—"}</span>
      <span className={`row gap6 ${d ? "row-actions" : ""}`} style={{ width: compact ? ArchiveCols.actionsC : ArchiveCols.actions, flex: "none", justifyContent: "flex-end" }}>
        {busy ? <span className="muted t-meta">正在识别…</span> : <Button size="small" onClick={() => stageFile()}>{d ? "归档新版" : "归档"}</Button>}
        <ActionMenu icon="ellipsis" kind="quiet" size="small" entries={menu} align="end" ariaLabel="更多操作" />
      </span>
      {stageNode}
      {reissue && <ReissueRequestSheet owner={owner} typeIDs={[it.typeID]} onClose={() => setReissue(false)} />}
      <Popover anchor={anchor} open={noteOpen} onClose={() => setNoteOpen(false)} align="end">
        <div className="col gap12" style={{ padding: 16 }}>
          <span className="t-row">{archiveItemName(it)}：备注</span>
          <textarea className="field" style={{ width: 340, minHeight: 72 }} autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="例如：原件由开曼代理保管，需要时邮件索取" />
          <div className="row gap8" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setNoteOpen(false)}>取消</Button>
            <Button kind="primary" onClick={() => { store.setItemNote(noteText, it.typeID, company.id); setNoteOpen(false); }}>保存</Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
const stateText = (s: ArchiveState) => ({ valid: "有效", expiring: "即将到期", expired: "已过期", needsUpdate: "需要更新", noDate: "日期待核对", marked: "已标记", missing: "未归档" })[s.kind];

// MARK: - 历史版本

function VersionsTab({ company }: { company: Company }) {
  const { store, router } = useApp();
  const docs = store.ownedDocuments(ref("company", company.id), true);
  const byType = new Map<string, Document[]>();
  for (const d of docs) byType.set(d.typeID, [...(byType.get(d.typeID) ?? []), d]);
  const groups = [...byType.entries()].filter(([, v]) => v.some((d) => d.supersededBy))
    .map(([typeID, v]) => ({ typeID, versions: v.sort((a, b) => (!a.supersededBy !== !b.supersededBy ? (a.supersededBy ? 1 : -1) : (b.issueDate ?? b.addedOn).localeCompare(a.issueDate ?? a.addedOn))) }))
    .sort((a, b) => (store.docType(a.typeID)?.name ?? "").localeCompare(store.docType(b.typeID)?.name ?? "", "zh"));
  return (
    <div className="col gap20">
      {!groups.length ? (
        <div className="col gap6" style={{ alignItems: "center", padding: "28px 0", textAlign: "center" }}>
          <Icon name="clock.arrow.circlepath" size={24} className="muted" />
          <span style={{ fontSize: 15, fontWeight: 600 }}>还没有旧版本</span>
          <span className="muted" style={{ fontSize: 13 }}>归档新版后，被取代的文件会保留在这里，可单独打开或一并导出。</span>
        </div>
      ) : groups.map((g) => (
        <div key={g.typeID} className="col gap10">
          <div className="row baseline gap8"><span style={{ fontSize: 15, fontWeight: 600 }}>{store.docType(g.typeID)?.name ?? "文件"}</span><span className="muted" style={{ fontSize: 12.5 }}>旧版 {g.versions.length - 1} 份</span></div>
          <div className="row gap14 scroll-x" style={{ alignItems: "flex-start", paddingBottom: 4 }}>{g.versions.map((d) => <VersionCard key={d.id} d={d} />)}</div>
        </div>
      ))}
      <DropTarget message={`松开即可归档到 ${company.name}`} radius={20} onDrop={(paths) => router.startImport(paths, { kind: "company", id: company.id })}>
        <div className="row gap8 muted" style={{ justifyContent: "center", height: 90, borderRadius: "var(--r-surface)", border: "1px dashed var(--hairline)" }}>
          <Icon name="arrow.down.doc" />将 PDF 或照片拖到这里，归档到这家公司名下
        </div>
      </DropTarget>
    </div>
  );
}

function VersionCard({ d }: { d: Document }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const current = !d.supersededBy;
  return (
    <button className="col gap8 version-card" style={{ width: 140, flex: "none", textAlign: "left" }} title={d.originalFileName}
      onClick={() => router.open({ kind: "document", id: d.id })}
      onContextMenu={(e) => ctx.open(e, [item("打开", "arrow.up.forward.app", () => void store.openDocument(d)), item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", "folder", () => void store.revealDocument(d))])}
      aria-label={`${store.docType(d.typeID)?.name ?? "文件"}，${current ? "现行版" : "旧版"}，${d.issueDate ?? "日期未知"}`}>
      <span className="thumbbox" style={{ width: 140, height: 148, borderRadius: 16, background: "var(--band)", display: "grid", placeItems: "center", opacity: current ? 1 : 0.75 }}>
        <FileThumb doc={d} width={96} height={124} />
      </span>
      <span className="row gap6"><Pill text={current ? "现行" : "旧版"} kind={current ? "valid" : "neutral"} /><span className="t-meta num" style={{ color: current ? "var(--ink)" : "var(--muted)" }}>{d.issueDate ?? "日期未知"}</span></span>
      {ctx.node}
    </button>
  );
}

// MARK: - 合规事项

function ObligationsTab({ company }: { company: Company }) {
  const { store, router } = useApp();
  const all = store.obligationsFor(company.id);
  const open = all.filter((o) => !obligationDone(o));
  const done = all.filter((o) => obligationDone(o)).sort((a, b) => (a.due < b.due ? 1 : -1));
  const partyOptions: [string, string][] = [["", `默认（${store.party(company.defaultPartyID)?.name ?? "未指定"}）`], ...store.data.parties.map((p) => [p.id, p.name] as [string, string])];
  const setCompany = (fn: (c: Company) => void) => store.commit((d) => { const c = d.companies.find((x) => x.id === company.id); if (c) fn(c as Company); });
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="col gap6">
        <div className="row baseline"><span className="t-section">待办</span><span className="spacer" /><span className="t-meta muted">{open.length} 件</span></div>
        {open.map((o) => <ObligationRow key={o.key} o={o} detail={`${store.scheduleText(o.rule.schedule)}，${stateLine(store, o)}`} onTap={() => router.open({ kind: "obligation", key: o.key })} />)}
      </div>
      {done.length > 0 && <div className="col gap6">
        <span className="t-section">已完成</span>
        {done.map((o) => {
          const r = store.receipt(o);
          return (
            <div key={o.key} className="row gap8 hover-band" style={{ height: 40, padding: "0 12px", borderRadius: "var(--r-row)", cursor: "pointer" }} onClick={() => router.open({ kind: "obligation", key: o.key })}>
              <Icon name="checkmark.circle.fill" /><span style={{ fontWeight: 500 }}>{o.rule.name}</span><span className="muted">截止 {D.long(o.due)}</span>
              <span className="spacer" /><span className="muted">{o.record?.completedOn ? `${D.long(o.record.completedOn)}完成` : ""}</span>
              {r && <Button kind="quiet" size="small" onClick={(e) => { e.stopPropagation(); void store.openDocument(r); }}>查看回执</Button>}
            </div>
          );
        })}
      </div>}
      <div className="col gap6">
        <div className="row baseline"><span className="t-section">适用规则</span><span className="spacer" /><span className="t-meta muted">关掉的规则不会再提醒</span></div>
        <div className="col" style={{ background: "var(--canvas)", borderRadius: 20 }}>
          {store.data.library.rules.filter((r) => r.jurisdictions.includes(company.jurisdiction)).map((r) => (
            <div key={r.id} className="row gap12" style={{ height: 52, padding: "0 12px" }}>
              <Switch checked={!company.disabledRuleIDs.includes(r.id)} disabled={!r.enabled || !(!r.entityForms?.length || r.entityForms.includes(company.entityForm))}
                onChange={(on) => setCompany((c) => { c.disabledRuleIDs = on ? c.disabledRuleIDs.filter((x) => x !== r.id) : [...c.disabledRuleIDs, r.id]; })} />
              <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="row gap6"><span style={{ fontWeight: 500 }}>{r.name}</span>
                  <button title="查看或记录这条规则的核对信息" onClick={() => router.open({ kind: "confirmRule", ruleID: r.id, companyID: company.id })}><TrustBadge trust={store.trustOf(r.id, company)} showConfirmed /></button>
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{store.scheduleText(company.ruleOverrides?.[r.id]?.schedule ?? r.schedule)}</span>
              </span>
              <SelectField options={partyOptions} value={company.rulePartyIDs[r.id] ?? ""} minWidth={200}
                onChange={(v) => setCompany((c) => { if (v) c.rulePartyIDs[r.id] = v; else delete c.rulePartyIDs[r.id]; })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// MARK: - 变更记录

function HistoryTab({ company }: { company: Company }) {
  const { store, router } = useApp();
  const cref = ref("company", company.id);
  const changes = store.data.changes.filter((c) => c.companyID === company.id).sort((a, b) => (a.effectiveOn < b.effectiveOn ? 1 : -1));
  const holdings = store.data.holdings.filter((h) => h.companyID === company.id || (h.holder.kind === "company" && h.holder.id === company.id));
  const unsynced = store.unsyncedChanges(company.id);
  const kindLabel = (k: string) => (store as any).changeLabel?.(k) ?? k;
  void kindLabel;
  return (
    <div className="col gap20">
      {!changes.length && <span className="muted">还没有变更记录。董事、股东、地址或名称有变化时，点击上方的“记录变更”。</span>}
      {unsynced.length > 0 && (
        <div className="row start gap12" style={{ padding: 16, borderRadius: 18, background: "var(--amber-soft)" }}>
          <span className="amber-text"><Icon name="exclamationmark.triangle.fill" /></span>
          <div className="col grow gap4">
            <span style={{ fontWeight: 600 }}>{unsynced.length} 条变更没有同步到董事或股东名单</span>
            <span className="muted" style={{ whiteSpace: "pre-line" }}>{unsynced.map((c) => `${D.long(c.effectiveOn)}：${c.summary || changeLabel(c.kind)}`).join("\n")}</span>
            <span className="muted">这些变更只记了一笔，名单里没有对应的就任、离任或持股变化。请在“编辑”里补上任期日期，股权结构和文件包才会准确。</span>
          </div>
          <Button onClick={() => router.open({ kind: "editCompany", companyID: company.id })}>编辑名单</Button>
        </div>
      )}
      <div className="col" style={{ gap: 22 }}>
        {changes.map((c) => {
          const ev = c.evidenceDocumentID ? store.data.documents.find((d) => d.id === c.evidenceDocumentID) : undefined;
          return (
            <div key={c.id} className="row start" style={{ gap: 22 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2.5px solid var(--ink)", marginTop: 3, flex: "none" }} />
              <span className="num" style={{ width: 100, fontWeight: 700, flex: "none" }}>{c.effectiveOn}</span>
              <div className="col" style={{ gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{c.summary || changeLabel(c.kind)}</span>
                {(c.details ?? []).map((l, i) => <span key={i}>{l}</span>)}
                <span className="row gap10 muted">{changeLabel(c.kind)}，{D.long(c.recordedOn)}录入
                  {ev && <button className="link" onClick={() => router.open({ kind: "document", id: ev.id })}>查看证明文件</button>}</span>
              </div>
            </div>
          );
        })}
      </div>
      {holdings.length > 0 && <div className="col gap8">
        <span className="t-section">持股历史</span>
        {[...holdings].sort((a, b) => ((b.from ?? "1900-01-01") > (a.from ?? "1900-01-01") ? 1 : -1)).map((h) => (
          <div key={h.id} className="row gap8" style={{ height: 40, padding: "0 14px", borderRadius: 12, background: "var(--canvas)" }}>
            <span>{h.companyID === company.id ? `${store.nameOf(h.holder)} 持有本公司` : `本公司持有 ${store.nameOf(ref("company", h.companyID))}`}</span>
            <span style={{ fontWeight: 700 }}>{percentLabel(h.percent)}</span>
            {h.isNominee && <Pill text="代持" kind="warn" />}
            <span className="spacer" /><span className="muted num">{h.from ?? "?"} 至 {h.to ?? "今"}</span>
          </div>
        ))}
      </div>}
      {void cref}
    </div>
  );
}
const changeLabel = (k: string) => changeKindLabel[k as keyof typeof changeKindLabel] ?? k;

// MARK: - 自定义清单

export interface ItemDraft { name: string; category: string; validity: DocumentType["validity"]; months: number }
export const newItemDraft = (): ItemDraft => ({ name: "", category: "", validity: "permanent", months: 6 });

export function ArchiveItemFields({ draft, onChange }: { draft: ItemDraft; onChange: (d: ItemDraft) => void }) {
  const { store } = useApp();
  const cats = [...new Set(store.data.library.documentTypes.map((t) => t.category).filter(Boolean))].sort();
  const months = [...new Set([1, 3, 6, 12, 24, 36, draft.months])].sort((a, b) => a - b);
  return (
    <div className="col" style={{ gap: 18 }}>
      <FormGroup title="基本信息">
        <FieldRow label="名称"><TextField value={draft.name} onChange={(name) => onChange({ ...draft, name })} placeholder="例如：开曼注册办事处地址证明" autoFocus /></FieldRow>
        <FieldRow label="类别" hint="用于矩阵的列，跨法域把同类文件放在一起">
          <SelectField options={[["", "新类别（与名称相同）"] as [string, string], ...cats.map((c) => [c, c] as [string, string])]} value={draft.category} onChange={(category) => onChange({ ...draft, category })} minWidth={220} />
        </FieldRow>
      </FormGroup>
      <FormGroup title="有效期">
        <RadioGroup options={[["permanent", "长期有效"], ["monthsAfterIssue", "签发后若干个月"], ["expiryOnDocument", "按文件上的到期日"]] as [ItemDraft["validity"], string][]} value={draft.validity} onChange={(validity) => onChange({ ...draft, validity })} />
        {draft.validity === "monthsAfterIssue" && <FieldRow label="有效月数" hint="从签发日起算">
          <SelectField options={months.map((m) => [m, `${m} 个月`] as [number, string])} value={draft.months} onChange={(m) => onChange({ ...draft, months: m })} minWidth={140} />
        </FieldRow>}
      </FormGroup>
    </div>
  );
}

export function CompanyItemsSheet({ companyID, onClose }: { companyID: string; onClose: () => void }) {
  const { store } = useApp();
  const [creating, setCreating] = useState(false);
  const c = store.company(companyID);
  if (!c) return (
    <Modal onClose={onClose}><SheetScaffold title="找不到这家公司" subtitle="它可能已被删除。" width={420} trailing={<Button kind="primary" onClick={onClose}>关闭</Button>}><span /></SheetScaffold></Modal>
  );
  const jName = store.jurisdictionName(c.jurisdiction);
  const template = store.templateItems(c.jurisdiction);
  const a = c.archive ?? { added: [], removed: [], marks: {}, notes: {} };
  const current = store.itemIDs(c);
  const candidates = store.data.library.documentTypes.filter((t) => t.owner === "company" && !current.includes(t.id) && !nonArchiveTypeIDs.has(t.id) && (!t.jurisdictions.length || t.jurisdictions.includes(c.jurisdiction)));
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="自定义清单" subtitle={`只调整 ${c.name} 的档案条目。${jName}所有公司通用的条目在“设置 → 档案清单”里改。`} width={600} height={760}
        trailing={<Button kind="primary" onClick={onClose}>完成</Button>}>
        <div className="col" style={{ gap: 18 }}>
          <div className="col gap6">
            <FormGroup title={`${jName}通用条目`}>
              {!template.length && <span className="muted">{jName}还没有通用条目。</span>}
              {template.map((id) => <Checkbox key={id} checked={!a.removed.includes(id)} onChange={(on) => (on ? store.addItem(id, c.id) : store.removeItem(id, c.id))}>{store.docType(id)?.name ?? id}</Checkbox>)}
            </FormGroup>
            <span className="t-meta muted" style={{ paddingLeft: 4 }}>取消勾选只影响这家公司。已归档的文件不会删除，会出现在“其他文件”里。</span>
          </div>
          <FormGroup title="只给这家公司加的条目">
            {!a.added.length && <span className="muted">还没有单独加的条目。</span>}
            {a.added.map((id) => <div key={id} className="row"><span className="grow">{store.docType(id)?.name ?? id}</span><Button kind="quiet" size="small" onClick={() => store.dropItem(id, c.id)}>去掉</Button></div>)}
            <div className="row gap8">
              {candidates.length > 0 && <ActionMenu title="从已有类型添加" icon="plus" size="small" entries={candidates.map((t) => item(t.name, undefined, () => store.addItem(t.id, c.id)))} />}
              <Button size="small" icon="square.and.pencil" onClick={() => setCreating(true)}>新建条目…</Button>
            </div>
          </FormGroup>
        </div>
      </SheetScaffold>
      {creating && <NewCompanyItemSheet company={c} jName={jName} onClose={() => setCreating(false)} />}
    </Modal>
  );
}

function NewCompanyItemSheet({ company, jName, onClose }: { company: Company; jName: string; onClose: () => void }) {
  const { store } = useApp();
  const [draft, setDraft] = useState(newItemDraft());
  const [toTemplate, setToTemplate] = useState(false);
  const valid = !!draft.name.trim();
  const create = () => {
    if (!valid) return;
    const t = store.createItem({ name: draft.name.trim(), category: draft.category, jurisdiction: toTemplate ? company.jurisdiction : undefined, validity: draft.validity,
      months: draft.validity === "monthsAfterIssue" ? draft.months : undefined, scope: company.jurisdiction });
    if (!toTemplate) store.addItem(t.id, company.id);
    store.showToast(`已添加条目 ${t.name}`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="新建条目" subtitle={`加到 ${company.name} 的档案清单。`} width={520} onSubmit={create}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!valid} onClick={create}>添加条目</Button></>}>
        <div className="col gap16">
          <ArchiveItemFields draft={draft} onChange={setDraft} />
          <FormGroup title="适用范围"><Checkbox checked={toTemplate} onChange={setToTemplate}>同时加到{jName}所有公司的通用条目</Checkbox></FormGroup>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

void useMemo;
