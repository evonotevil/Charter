// 公司页：列表 + 详情；矩阵与结构在单独文件。移植自 CompaniesView.swift / CompanyArchiveView.swift。

import { companyTint } from "../ui/uistyle";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import {
  type ArchiveItem, type ArchiveState, type Company, type Document, type DocumentType, type GroupRow, type NodeRef,
  archiveItemName, changeKindLabel, companyStatusLabel, hasFile, isActiveOn, isNotApplicable, itemMarkLabel, itemMarks, ref, stateNeedsAttention, latinPad, latinPadStart, archiveCounts, inView } from "../domain/models";
import { daysLeft, expiryLabel, obligationDone, percentLabel } from "../domain/engine";
import { isMember, sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import { nonArchiveTypeIDs, ungrouped } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import {
  ActionMenu, Avatar, Banner, Button, Card, Checkbox, CountBadge, EmptyStateView, Metrics, PageHeader, ProgressTrack, FieldRow, FormGroup, JurisdictionBadge, type MenuEntry, Modal, Pill,
  Popover, ProgressCapsule, RadioGroup, Segmented, SelectField, SheetScaffold, Switch, TextField, divider, header, item, useContextMenu,
} from "../ui/kit";
import { DropTarget, DropZone, useDropTarget } from "../ui/drop";
import { GroupIcon } from "./Shell";
import {
  CompanyWaitingLine, FileThumb, ObligationRow, ReissueRequestSheet, StatusPill, TrustBadge, stateColor, stateLine, useStageFile,
} from "./common";
import { SlideBg } from "../ui/motion";
import { CompanyPage } from "./CompanyPage";

const isForming = (c: Company) => c.status === "forming";
const searchText = (c: Company) => [c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase();

/** 集团筛选：公司总览、股权结构、文件共用 router.groupFilter。集团色只出现在圆点上。 */
export function GroupFilter() {
  const { store, router } = useApp();
  const group = router.groupFilter;
  const gs = [...store.data.groups].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="row gap8 wrap" role="group" aria-label="按集团筛选">
      <div className="seg slide-host">
        <SlideBg />
        <button aria-pressed={!group} className={!group ? "on" : ""} onClick={() => router.set("groupFilter", null)}>全部</button>
        {gs.map((x) => (
          <button key={x.id} aria-pressed={group === x.id} className={group === x.id ? "on" : ""} onClick={() => router.set("groupFilter", x.id)}>
            <span className="gdot" style={{ background: store.brandColor(x) }} />{x.name}
          </button>
        ))}
        {store.ungroupedCompanies.length > 0 && gs.length > 0 && <button aria-pressed={group === ungrouped} className={group === ungrouped ? "on" : ""} onClick={() => router.set("groupFilter", ungrouped)}>未归入集团</button>}
      </div>
      <ActionMenu icon="ellipsis" ariaLabel="集团" align="end" showsChevron={false} kind="quiet" size="small" entries={[
        ...(store.group(group) ? [item(`编辑“${store.group(group)!.name}”…`, "pencil", () => router.openSettings("groups", group))] : []),
        item("新建集团…", "plus", () => router.openSettings("groups", "new")),
        item("管理全部集团…", "square.stack.3d.up", () => router.openSettings("groups")),
      ]} />
    </div>
  );
}

export function CompaniesView() {
  const { store, router } = useApp();
  const c = router.companyOpen && router.selectedCompanyID ? store.company(router.selectedCompanyID) : undefined;
  if (c) return <CompanyPage key={c.id} company={c} />;
  return <Overview />;
}

type Health = { c: Company; severity: 0 | 1 | 2; next?: ReturnType<ReturnType<typeof useApp>["store"]["openObligations"]["find"]>; held: number; total: number; configured: boolean; agent: number; text: string };

function Overview() {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"attention" | "name" | "due">("attention");
  const search = useRef<HTMLInputElement>(null);
  const f = router.groupFilter;
  const scope = store.companyIDsForFilter(f);
  const live = store.data.companies.filter((c) => (!scope || scope.has(c.id)));
  const active = live.filter((c) => c.status !== "dissolved" && c.status !== "redomiciled");
  const q = query.trim().toLowerCase();
  const rows: Health[] = useMemo(() => live.map((c) => {
    const { severity, text } = alertInfo(store, c);
    const cnt = store.companyCounts(c);
    const next = store.openObligations.filter((o) => o.company.id === c.id).sort((a, b) => (a.due < b.due ? -1 : 1))[0];
    return { c, severity, next, held: cnt.held, total: cnt.total, configured: cnt.configured, agent: cnt.agent, text };
  }), [store.data, store.today, f]);
  const shown = rows.filter((r) => !q || searchText(r.c).includes(q) || store.jurisdictionName(r.c.jurisdiction).toLowerCase().includes(q))
    .sort((a, b) => sort === "name" ? a.c.name.localeCompare(b.c.name, "zh")
      : sort === "due" ? (a.next?.due ?? "9999").localeCompare(b.next?.due ?? "9999")
      : b.severity - a.severity || (a.next?.due ?? "9999").localeCompare(b.next?.due ?? "9999") || a.c.name.localeCompare(b.c.name, "zh"));
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const obligations = store.openObligations.filter((o) => !scope || scope.has(o.company.id));
  const overdue = obligations.filter((o) => o.due < store.today).length;
  const soon = obligations.filter((o) => o.due >= store.today && D.daysBetween(store.today, o.due) <= 30).length;
  const miss = store.missingSummary(f);
  const unv = store.unverified.filter((x) => !scope || scope.has(x.item.companyID)).length;
  const conf = rows.filter((r) => r.configured);
  const unconfigured = rows.length - conf.length;
  const held = conf.reduce((s, r) => s + r.held, 0), total = conf.reduce((s, r) => s + r.total, 0);
  const pct = total ? Math.round((held / total) * 100) : null;
  const bad = rows.filter((r) => r.severity === 2).length, warn = rows.filter((r) => r.severity === 1).length;
  // 只有逾期、过期、待核实、缺件、未配置都为 0 时才算“没有待办”；按紧急程度列出
  const todo: { text: string; go: () => void; label: string }[] = [
    overdue ? { text: `${overdue} 件申报已逾期`, go: () => router.go("due"), label: "打开申报日历" } : null,
    bad ? { text: `${bad} 家公司有文件过期`, go: () => router.go("files"), label: "查看文件" } : null,
    unv ? { text: `${unv} 条股权或任职待核实`, go: () => router.go("verify"), label: "去核实" } : null,
    soon ? { text: `30 天内有 ${soon} 件要申报`, go: () => router.go("due"), label: "打开申报日历" } : null,
    miss.companies ? { text: `${miss.companies} 家公司缺我负责的文件（共 ${miss.items} 项）`, go: () => router.go("files"), label: "查看缺的文件" } : null,
    warn ? { text: `${warn} 家公司有文件快到期`, go: () => router.go("files"), label: "查看文件" } : null,
    unconfigured ? { text: `${unconfigured} 家公司未配置材料范围`, go: () => router.open({ kind: "scope", ownerKind: "company", owners: rows.filter((r) => !r.configured).map((r) => r.c.id) }), label: "设置材料范围" } : null,
  ].filter((x): x is { text: string; go: () => void; label: string } => !!x);
  const tone = overdue || bad ? "bad" : "warn";

  if (!store.data.companies.length) return (
    <div className="page"><div className="page-inner">
      <PageHeader title="公司总览" />
      <Card><EmptyStateView symbol="building.2" title="还没有公司" message="新建第一家公司，或上传营业执照、注册证书等材料，Charter 会认出公司信息。" actionTitle="新建公司" action={() => router.open({ kind: "newCompany" })} /></Card>
    </div></div>
  );
  const group = f && f !== ungrouped ? store.group(f) : undefined;
  const page = (
    <div className="page"><div className="page-inner">
      <PageHeader crumb={store.filterName(f)} title="公司总览" subtitle={`范围：${store.filterName(f)} · ${active.length} 家公司`}>
        <Button icon="checklist" onClick={() => router.open({ kind: "scope", ownerKind: "company", owners: rows.map((r) => r.c.id) })}>设置材料范围</Button>
        <Button icon="square.and.arrow.down" onClick={() => void router.chooseFiles(group ? { kind: "group", id: group.id } : null)}>上传材料</Button>
        <Button kind="primary" icon="plus" onClick={() => router.open(group ? { kind: "newCompanyInGroup", group: group.id } : { kind: "newCompany" })}>新建公司</Button>
      </PageHeader>
      {store.data.groups.length > 0 && <GroupFilter />}
      {todo.length ? (
        <Banner tone={tone} title={todo[0].text} actions={<Button onClick={todo[0].go}>{todo[0].label}</Button>}>
          {todo.length > 1 && <span className="col gap4">{todo.slice(1).map((t) => <button key={t.text} className="link" style={{ alignSelf: "flex-start", textAlign: "left", color: "inherit", textDecoration: "underline", textUnderlineOffset: 3, fontWeight: 600 }} onClick={t.go}>{t.text}</button>)}</span>}
        </Banner>
      ) : (
        <span className="t-meta muted row gap6" style={{ padding: "2px 2px 6px" }}><Icon name="checkmark" size={12} />没有待处理事项：没有逾期、过期、待核实，我负责的材料都已归档。</span>
      )}
      <Metrics stats={[
        { label: "家公司", value: active.length, icon: "building.2", onClick: undefined },
        { label: "30 天内申报", value: soon + overdue, unit: "件", tone: overdue ? "bad" : "warn", icon: "calendar", onClick: () => router.go("due") },
        // 5.3.1：有未配置公司时，主数字是“已配置 x/y 家”，完整度退为小字，避免 100% 压过未配置
        unconfigured
          ? { label: `已配置材料范围 · 已配置项 ${pct === null ? "—" : `${pct}%`}`, value: conf.length, unit: `/ ${rows.length} 家`, tone: "warn", icon: "doc.on.doc", onClick: () => router.open({ kind: "scope", ownerKind: "company", owners: rows.filter((r) => !r.configured).map((r) => r.c.id) }) }
          : pct === null
            ? { label: "没有我负责的材料", value: 0, unit: "项", icon: "doc.on.doc", onClick: undefined }
            : { label: "我负责的材料齐全度", value: pct, unit: "%", tone: pct < 100 ? "warn" : undefined, icon: pct === 100 ? "checkmark.circle.fill" : "doc.on.doc", onClick: () => router.go("files") },
        { label: "待核实", value: unv, unit: "条", tone: "warn", icon: "checkmark.shield", onClick: () => router.go("verify") },
      ]} />
      <Card flush>
        <div className="card-head pad">
          <h2 className="t-card">公司</h2>
          <div className="toolbar">
            <label className="search" style={{ width: 240 }} title="搜索公司（Ctrl/⌘ F）">
              <Icon name="magnifyingglass" size={14} />
              <input ref={search} className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索公司、编号或法域" />
            </label>
            <SelectField<typeof sort> minWidth={140} value={sort} onChange={setSort} options={[["attention", "需处理在前"], ["due", "按到期日"], ["name", "按名称"]]} />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>公司</th><th>下一项申报</th><th>我负责的材料</th><th>状态</th><th><span className="sr-only">打开</span></th></tr></thead>
            <tbody>
              {shown.map((r) => <OverviewRow key={r.c.id} h={r} />)}
            </tbody>
          </table>
          {!shown.length && <div className="muted" style={{ padding: 24, textAlign: "center" }}>没有找到“{query}”</div>}
        </div>
        <div className="tfoot"><span>显示 {shown.length} / {rows.length} 家</span><span>点按一行打开公司</span></div>
      </Card>
    </div></div>
  );
  return group ? <DropTarget message={`松开即可归档到${latinPadStart(group.name)}`} onDrop={(paths) => router.startImport(paths, { kind: "group", id: group.id })} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{page}</DropTarget> : page;
}

function OverviewRow({ h }: { h: Health }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const { c, next, severity } = h;
  const left = next ? D.daysBetween(store.today, next.due) : null;
  const gs = store.groupsContaining(c.id);
  const menu: MenuEntry[] = [
    item("打开公司", "building.2", () => router.openCompany(c.id)),
    item("复制注册编号", "doc.on.doc", () => void platform().copyText(c.registrationNumber)),
    item("导出材料…", "archivebox", () => router.open({ kind: "exportAll", companyID: c.id })),
    item("在股权结构中查看", "point.3.connected.trianglepath.dotted", () => router.update((r) => { r.section = "structure"; r.selectedCompanyID = c.id; })),
  ];
  const statusPill = c.status !== "active" ? <Pill text={companyStatusLabel[c.status]} kind="neutral" />
    : severity === 2 ? <Pill text="需处理" kind="bad" /> : severity === 1 ? <Pill text="留意" kind="warn" /> : <Pill text="正常" kind="valid" />;
  return (
    <tr className="click" onClick={() => router.openCompany(c.id)} onContextMenu={(e) => ctx.open(e, menu)} title={h.text || c.name}>
      <td>
        <span className="row gap12">
          <JurisdictionBadge code={c.jurisdiction} size={34} tint={companyTint(store, c.id)} />
          <span className="col" style={{ minWidth: 0 }}>
            <span className="t-row name-2">{c.name}</span>
            <span className="t-meta muted row gap6">{gs.map((g) => <span key={g.id} className="gdot" style={{ background: store.brandColor(g) }} title={g.name} />)}{store.jurisdictionName(c.jurisdiction)}{c.registrationNumber ? ` · ${c.registrationNumber}` : ""}</span>
          </span>
        </span>
      </td>
      <td>{next && left !== null ? <span className="col"><span className="ellipsis" style={{ maxWidth: 240, fontWeight: 600 }}>{next.rule.name}</span>
        <span className="t-meta num" style={{ color: left < 0 ? "var(--red-text)" : left <= 30 ? "var(--amber-text)" : "var(--muted)", fontWeight: left <= 30 ? 700 : 400 }}>{D.short(next.due)} · {left < 0 ? `逾期 ${-left} 天` : left === 0 ? "今天" : `${left} 天后`}</span></span>
        : <span className="muted">—</span>}</td>
      <td>{h.configured && h.total ? <span className="row gap8"><ProgressTrack value={h.held / h.total} width={64} /><span className="t-meta num muted">{h.held}/{h.total}</span></span>
        : <span className="st miss" title="还没有设置哪些材料由你保管">{h.configured ? "没有我负责的" : "未配置"}</span>}</td>
      <td>{statusPill}</td>
      <td className="r"><Icon name="chevron.right" size={14} className="chev-r" /></td>
    </tr>
  );
}

function alertInfo(store: ReturnType<typeof useApp>["store"], c: Company): { severity: 0 | 1 | 2; text: string } {
  const alerts: string[] = [];
  const o = store.complianceOn ? store.openObligations.find((x) => x.company.id === c.id) : undefined;
  const left = o ? daysLeft(o, store.today) : 999;
  if (o && left <= 30) alerts.push(left < 0 ? `合规事项“${o.rule.name}”已逾期` : `合规事项“${o.rule.name}”${left} 天后到期`);
  const items = store.archive(c).filter((i) => inView(i.custody));
  const n = (k: ArchiveState["kind"]) => items.filter((i) => i.state.kind === k).length;
  if (n("expired")) alerts.push(`${n("expired")} 份已过期`);
  if (n("needsUpdate")) alerts.push(`${n("needsUpdate")} 份需更新`);
  if (n("expiring")) alerts.push(`${n("expiring")} 份即将到期`);
  if (n("noDate")) alerts.push(`${n("noDate")} 份日期待核对`);
  const severity = left < 0 || n("expired") ? 2 : items.some((i) => stateNeedsAttention(i.state)) || left <= 30 ? 1 : 0;
  return { severity, text: alerts.join("，") };
}

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
