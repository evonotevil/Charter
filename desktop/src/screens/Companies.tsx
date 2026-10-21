// 公司页：列表 + 详情；矩阵与结构在单独文件。移植自 CompaniesView.swift / CompanyArchiveView.swift。

import { companyTint } from "../ui/uistyle";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import {
  type ArchiveItem, type ArchiveState, type Company, type Document, type DocumentType, type GroupRow, type NodeRef,
  archiveItemName, changeKindLabel, companyStatusLabel, hasFile, isActiveOn, isNotApplicable, itemMarkLabel, itemMarks, ref, stateNeedsAttention, latinPad, latinPadStart, archiveCounts } from "../domain/models";
import { daysLeft, expiryLabel, obligationDone, percentLabel } from "../domain/engine";
import { isMember, sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import { nonArchiveTypeIDs, ungrouped } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import {
  ActionMenu, Avatar, Button, Checkbox, CountBadge, EmptyStateView, PageHeader, FieldRow, FormGroup, JurisdictionBadge, type MenuEntry, Modal, Pill,
  Popover, ProgressCapsule, RadioGroup, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, header, item, useContextMenu,
} from "../ui/kit";
import { DropTarget, DropZone, useDropTarget } from "../ui/drop";
import { GroupIcon } from "./Shell";
import {
  CompanyWaitingLine, FileThumb, ObligationRow, ReissueRequestSheet, StatusPill, TrustBadge, stateColor, stateLine, useStageFile,
} from "./common";
import { BrandPills } from "./Structure";
import { CompanyPage } from "./CompanyPage";

const isForming = (c: Company) => c.status === "forming";
const searchText = (c: Company) => [c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase();

function CompaniesHeader() {
  const { store, router } = useApp();
  const f = router.groupFilter;
  const scope = store.companyIDsForFilter(f);
  const live = store.data.companies.filter((c) => c.status !== "dissolved" && c.status !== "redomiciled" && (!scope || scope.has(c.id)));
  const miss = store.missingSummary(f);
  const attention = store.attentionCount(f);
  const unv = store.unverified.filter((x) => !scope || scope.has(x.item.companyID)).length;
  return (
    <PageHeader title="公司" scope={`${store.filterName(f)} · ${live.length} 家`} stats={[
      { label: "缺件", value: miss.companies, unit: `家 · ${miss.items} 项`, tone: miss.companies ? "warn" : undefined, onClick: miss.companies ? () => router.go("files") : undefined },
      { label: "文件需处理", value: attention, unit: "份", tone: attention ? "warn" : undefined, onClick: attention ? () => router.update((r) => { r.section = "files"; r.filesFilter = 2; }) : undefined },
      { label: "待核实", value: unv, unit: "条", tone: unv ? "accent" : undefined, onClick: () => router.go("verify") },
    ]}><BrandPills /></PageHeader>
  );
}

export function CompaniesView() {
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div style={{ padding: "var(--page-edge) var(--page-edge) 24px" }}>
        <CompaniesHeader />
      </div>
      <div className="col grow" style={{ minHeight: 0 }}><CompanyList /></div>
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
        items.some((i) => i.state.kind === "needsUpdate" || i.state.kind === "noDate") ? 0 : 1, counted.length ? archiveCounts(items).held / counted.length : 2];
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
            {!q && filter && filter !== ungrouped && <Button size="small" onClick={() => router.open({ kind: "newCompanyInGroup", group: filter })}>在此集团新建公司</Button>}
            {filter && <Button size="small" onClick={() => router.set("groupFilter", null)}>显示全部公司</Button>}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="row grow" style={{ alignItems: "stretch", minHeight: 0 }}>
      <div style={{ width: "clamp(240px, calc(100% - 560px), 300px)", flex: "none", margin: "0 0 var(--page-edge) var(--page-edge)", minHeight: 0 }}>
        {group ? <DropTarget message={`松开即可归档到${latinPadStart(group.name)}`} onDrop={(paths) => router.startImport(paths, { kind: "group", id: group.id })} style={{ height: "100%" }}>{list}</DropTarget> : list}
      </div>
      <div className="col grow" style={{ minWidth: 520, minHeight: 0 }}>
        {selected ? <CompanyPage key={selected.id} company={selected} /> : (
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
  const cnt = archiveCounts(store.archive(c));
  const parts = [store.jurisdictionName(c.jurisdiction), isForming(c) ? "设立中" : `档案 ${cnt.held}/${cnt.total}${cnt.missing ? `，缺 ${cnt.missing}` : ""}`];
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
        background: on ? "color-mix(in srgb, var(--on-selection) 16%, transparent)" : "var(--band)", ...(on ? null : companyTint(store, c.id)) }}>{c.jurisdiction}</span>
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





export function ChangeRowMenu({ companyID, appointmentID, holdingID }: { companyID: string; appointmentID?: string; holdingID?: string }) {
  const { router } = useApp();
  return <ActionMenu icon="ellipsis" kind="quiet" size="small" align="end" ariaLabel="更多操作" entries={[
    item(holdingID ? "记录变更（股权转让）…" : "记录变更（离任或变更）…", "arrow.triangle.2.circlepath",
      () => router.open({ kind: "changeFrom", companyID, changeKind: holdingID ? "shareholderChange" : "directorChange", appointmentID, holdingID })),
  ]} />;
}


// MARK: - 档案清单








// MARK: - 历史版本



// MARK: - 合规事项


// MARK: - 变更记录


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
