// 档案矩阵：每个集团一张卡片，公司为行、档案类别为列。移植自 OverviewView.swift。

import { useState } from "react";
import { type ArchiveItem, type ArchiveState, type Company, type GroupRow, archiveItemName, archiveStateLabel, hasFile, isNotApplicable, itemMarkLabel, itemMarks, stateNeedsAttention, stateRank } from "../domain/models";
import { percentLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { ungrouped } from "../state/store";
import { Icon } from "../ui/Icon";
import { ActionMenu, Button, EmptyStateView, JurisdictionBadge, type MenuEntry, Segmented, divider, item, useContextMenu } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { GroupIcon } from "./Shell";

const nameWidth = 260, progressWidth = 84, cellWidth = 72, maxColumns = 9;
interface Block { id: string; title: string; subtitle: string; groupID?: string; rows: GroupRow[]; categories: string[] }

export function ProgressTrack({ value, width = 48 }: { value: number; width?: number }) {
  return <span aria-hidden style={{ display: "block", width, height: 5, borderRadius: 3, background: "var(--band)", overflow: "hidden" }}>
    <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: "var(--lime)", borderRadius: 3 }} />
  </span>;
}

export function MatrixView() {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  if (!store.data.companies.length) return (
    <div className="col grow" style={{ justifyContent: "center" }}>
      <EmptyStateView symbol="building.2" title="还没有公司" message="先新建一个集团（从实控人或顶层公司开始），再逐层添加公司；也可以载入示例数据。" actionTitle="新建集团" action={() => router.open({ kind: "newGroup" })} />
    </div>
  );
  const filter = router.groupFilter;
  const allowed = store.companyIDsForFilter(filter);
  const shownCompanies = store.data.companies.filter((c) => !allowed || allowed.has(c.id));
  const archives = new Map(shownCompanies.map((c) => [c.id, c.status === "forming" ? store.archive(c).filter((i) => hasFile(i.state)) : store.archive(c)]));
  const order = new Map(store.overviewCategories(store.data.companies).map((c, i) => [c, i]));
  const columns = (rows: GroupRow[]) => store.overviewCategories(rows.map((r) => store.company(r.companyID)).filter(Boolean) as Company[]).slice(0, maxColumns)
    .sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const blocks: Block[] = [];
  for (const g of filter == null ? store.data.groups : store.data.groups.filter((g) => g.id === filter)) {
    const rows = store.rowsOf(g);
    blocks.push({ id: g.id, title: g.name, subtitle: g.tops.length ? `顶层：${store.topLabel(g)}` : "还没有设置顶层", groupID: g.id, rows, categories: columns(rows) });
  }
  if (filter == null || filter === ungrouped) {
    const un = store.ungroupedCompanies;
    if (un.length) {
      const rows = un.map((c) => ({ companyID: c.id, depth: 0, viaNominee: false, unconnected: false }));
      blocks.push({ id: ungrouped, title: "未归入集团", subtitle: "这些公司还不属于任何集团", rows, categories: columns(rows) });
    }
  }
  const q = query.trim().toLowerCase();
  const visible = (c: Company, items: ArchiveItem[]) => {
    if (q && ![c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase().includes(q) && !store.jurisdictionName(c.jurisdiction).toLowerCase().includes(q)) return false;
    if (onlyAttention && !items.some((i) => stateNeedsAttention(i.state) || i.state.kind === "missing")) return false;
    return true;
  };
  const filtering = !!q || onlyAttention;
  const shown = blocks.map((b) => ({ ...b, rows: b.rows.filter((r) => { const c = store.company(r.companyID); return !!c && visible(c, archives.get(c.id) ?? []); }) }))
    .filter((b) => b.rows.length || !filtering);

  const all = shownCompanies.flatMap((c) => archives.get(c.id) ?? []).filter((i) => !isNotApplicable(i.state));
  const n = (k: ArchiveState["kind"]) => all.filter((i) => i.state.kind === k).length;
  const stat = (num: string, label: string, color?: string, action?: () => void) => {
    const inner = <><span className="t-section num" style={{ color: color ?? "var(--ink)" }}>{num}</span><span className="t-body muted">{label}</span></>;
    return action ? <button className="row baseline gap4" onClick={action} title="查看即将到期和已过期的文件">{inner}</button> : <span className="row baseline gap4">{inner}</span>;
  };
  const toFiles = () => { router.filesFilter = 1; router.go("files"); };
  return (
    <div className="scroll grow">
      <div className="col gap16" style={{ padding: "0 var(--page-edge) var(--page-edge)" }}>
        <div className="col gap8" style={{ paddingBottom: 8 }}>
          <div className="row gap16">
            <span title="只看待处理：只显示有过期、即将到期、需要更新或未归档条目的公司">
              <Segmented options={[[false, "全部"], [true, "只看待处理"]]} value={onlyAttention} onChange={setOnlyAttention} />
            </span>
            <span className="spacer" />
            <label className="row gap8" style={{ width: 240, height: 34, padding: "0 12px", borderRadius: 999, background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
              <Icon name="magnifyingglass" size={12} className="muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索公司、编号或法域" className="grow" style={{ border: 0, outline: "none", background: "transparent", font: "inherit", color: "inherit", minWidth: 0 }} />
              {query && <button className="muted" aria-label="清除搜索" onClick={() => setQuery("")}><Icon name="xmark.circle.fill" /></button>}
            </label>
          </div>
          <div className="row wrap" style={{ gap: 18 }}>
            {stat(String(shownCompanies.length), "家公司")}
            {stat(`${all.filter((i) => hasFile(i.state)).length}/${all.length}`, "条目已归档")}
            {n("expired") > 0 && stat(String(n("expired")), "份已过期", "var(--danger)", toFiles)}
            {n("expiring") > 0 && stat(String(n("expiring")), "份 30 天内到期", "var(--amber-text)", toFiles)}
            {n("missing") > 0 && stat(String(n("missing")), "条未归档")}
          </div>
        </div>
        {shown.map((b) => <Card key={b.id} b={b} archives={archives} />)}
        {!shown.length && <div className="surface"><EmptyStateView symbol={onlyAttention ? "checkmark" : "magnifyingglass"} title={onlyAttention ? "没有需要处理的公司" : "没有找到符合条件的公司"} message={onlyAttention ? "当前范围内的公司档案都已就绪。" : "换个关键词，或清除搜索后再看。"} /></div>}
        <div className="row wrap" style={{ gap: 18, padding: "8px 0 0 4px" }}>
          {([{ kind: "valid" }, { kind: "expiring", days: 30 }, { kind: "expired", days: 1 }, { kind: "needsUpdate" }, { kind: "missing" }, { kind: "marked", mark: "restricted" }] as ArchiveState[]).map((s) => (
            <span key={s.kind} className="row gap6"><MatrixTile state={s} size={18} /><span className="t-meta muted">{({ valid: "已归档", expiring: "即将到期", expired: "已过期", needsUpdate: "需要更新", missing: "未归档" } as Record<string, string>)[s.kind] ?? "已标记原因"}</span></span>
          ))}
          <span className="row gap6"><NotManaged /><span className="t-meta muted">不管理这一类</span></span>
        </div>
      </div>
    </div>
  );
}

function Card({ b, archives }: { b: Block; archives: Map<string, ArchiveItem[]> }) {
  const { store, router } = useApp();
  const items = b.rows.flatMap((r) => archives.get(r.companyID) ?? []).filter((i) => !isNotApplicable(i.state));
  const have = items.filter((i) => hasFile(i.state)).length;
  const gid = b.groupID;
  const body = (
    <div className="col gap16 surface" style={{ padding: 24 }}>
      <div className="row gap12">
        <GroupIcon groupID={b.id} size={32} />
        <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
          <span className="t-section ellipsis" title={b.title}>{b.title}</span>
          <span className="t-meta muted ellipsis">{b.subtitle}</span>
        </div>
        {items.length > 0 && <span className="row gap10"><span className="t-meta muted num">已归档 {have}/{items.length}</span><ProgressTrack value={have / Math.max(items.length, 1)} width={72} /></span>}
        {gid && <ActionMenu icon="ellipsis" kind="quiet" size="small" align="end" ariaLabel="集团操作" entries={[
          item("上传材料…", "square.and.arrow.down", () => void router.chooseFiles({ kind: "group", id: gid })),
          item("在此集团新建公司…", "building.2", () => router.open({ kind: "newCompanyInGroup", group: gid })),
          item("编辑集团…", "pencil", () => router.open({ kind: "editGroup", group: gid })),
          item("管理成员…", "checklist", () => router.open({ kind: "groupMembers", group: gid })),
          divider,
          item("查看股权结构", "point.3.connected.trianglepath.dotted", () => router.openStructure({ group: gid })),
        ]} />}
      </div>
      <div style={{ overflowX: "auto" }}>
        <div className="col" style={{ minWidth: nameWidth + progressWidth + b.categories.length * cellWidth + 20 }}>
          <div className="row t-micro muted" style={{ minHeight: 36, padding: "0 10px", borderRadius: "var(--r-row)", background: "var(--band)" }}>
            <span style={{ width: nameWidth, flex: "none" }}>公司</span>
            <span style={{ width: progressWidth, flex: "none" }}>已归档</span>
            {b.categories.map((c) => <span key={c} title={c} style={{ width: cellWidth, flex: "none", textAlign: "center", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c}</span>)}
          </div>
          {b.rows.map((r, i) => {
            const c = store.company(r.companyID);
            if (!c) return null;
            return <div key={r.companyID + i}>{i > 0 && <div className="hairline" style={{ marginLeft: 10 }} />}<MatrixRow c={c} r={r} groupID={gid} categories={b.categories} items={archives.get(c.id) ?? []} /></div>;
          })}
          {!b.rows.length && gid && <div className="row gap10" style={{ padding: "14px 0 14px 10px" }}>
            <span className="muted">这个集团还没有公司。</span>
            <Button size="small" onClick={() => router.open({ kind: "newCompanyInGroup", group: gid })}>在此集团新建公司…</Button>
          </div>}
        </div>
      </div>
    </div>
  );
  return gid ? <DropTarget message={`松开即可归档到${b.title}`} onDrop={(paths) => router.startImport(paths, { kind: "group", id: gid })}>{body}</DropTarget> : body;
}

function MatrixRow({ c, r, groupID, categories, items }: { c: Company; r: GroupRow; groupID?: string; categories: string[]; items: ArchiveItem[] }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const others = store.groupsContaining(c.id).filter((g) => g.id !== groupID);
  const progress = items.filter((i) => !isNotApplicable(i.state));
  const have = progress.filter((i) => hasFile(i.state)).length;
  const open = (tab = 0) => { router.companyTab = tab; router.openCompany(c.id); };
  return (
    <div className="row hover-band" style={{ height: 56, padding: "0 10px", borderRadius: "var(--r-row)" }} onContextMenu={(e) => ctx.open(e, [
      item("打开档案", undefined, () => open()),
      divider,
      item("添加上级（股东）…", undefined, () => router.open({ kind: "addRelation", companyID: c.id, upward: true })),
      item("添加下级公司…", undefined, () => router.open({ kind: "addRelation", companyID: c.id, upward: false })),
    ])}>
      <button className="row gap8" style={{ width: nameWidth, flex: "none", textAlign: "left", minWidth: 0 }} title={c.name} onClick={() => open()}>
        {r.depth > 0 && <span aria-hidden style={{ width: 10, height: 14, marginLeft: (r.depth - 1) * 18 + 4, marginTop: -12, flex: "none", borderLeft: "1px solid var(--edge)", borderBottom: "1px solid var(--edge)", borderBottomLeftRadius: 5, opacity: .7 }} />}
        <JurisdictionBadge code={c.jurisdiction} size={26} />
        <span className="col" style={{ gap: 1, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
          <span className="row gap6 muted ellipsis" style={{ fontSize: 11.5 }}>
            {r.percent != null && <span>{r.viaNominee ? "上级经代持" : "上级持股"} {percentLabel(r.percent)}</span>}
            {r.unconnected && <span className="amber-text">未连上持股关系</span>}
            {others.length > 0 && <span>也属于 {others.map((g) => g.name).join("、")}</span>}
            {c.registrationNumber && <span className="num">{c.registrationNumber}</span>}
          </span>
        </span>
      </button>
      <span className="col" style={{ width: progressWidth, flex: "none", gap: 5 }}>
        <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>{have}/{progress.length}</span>
        <ProgressTrack value={have / Math.max(progress.length, 1)} width={44} />
      </span>
      {categories.map((cat) => <span key={cat} style={{ width: cellWidth, flex: "none" }}><Cell c={c} items={items.filter((i) => (i.type?.category ?? "其他") === cat)} /></span>)}
      {ctx.node}
    </div>
  );
}

function Cell({ c, items }: { c: Company; items: ArchiveItem[] }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const it = items.length ? items.reduce((m, x) => (stateRank(x.state) < stateRank(m.state) ? x : m)) : undefined;
  if (!it || isNotApplicable(it.state)) return <span className="col" style={{ minHeight: 46, justifyContent: "center", alignItems: "center" }} title={items.length ? "已标记为不适用" : `${c.name} 不管理这一类条目`}><NotManaged /></span>;
  const s = it.state;
  const caption = s.kind === "expiring" ? `${s.days} 天后` : s.kind === "expired" ? "已过期" : s.kind === "needsUpdate" ? "需更新" : s.kind === "noDate" ? "无日期" : s.kind === "missing" ? " " : s.kind === "marked" ? itemMarkLabel[s.mark]
    : it.document?.issueDate ? it.document.issueDate.slice(0, 7).replace("-", ".") : "已归档";
  const color = s.kind === "expired" ? "var(--danger)" : s.kind === "expiring" || s.kind === "needsUpdate" ? "var(--amber-text)" : "var(--muted)";
  const menu: MenuEntry[] = it.document ? [item("打开文件", undefined, () => void store.openDocument(it.document!))]
    : [...itemMarks.map((m) => item(`标记为${itemMarkLabel[m]}`, undefined, () => store.setMark(m, it.typeID, c.id))), item("清除标记", undefined, () => store.setMark(null, it.typeID, c.id))];
  return (
    <button className="col matrix-cell" style={{ width: "100%", minHeight: 46, gap: 4, alignItems: "center", justifyContent: "center" }}
      title={`${archiveItemName(it)}：${archiveStateLabel(s)}${it.note ? `\n备注：${it.note}` : ""}`} aria-label={`${archiveItemName(it)}，${archiveStateLabel(s)}`}
      onClick={() => (it.document ? router.open({ kind: "document", id: it.document.id }) : (router.companyTab = 0, router.openCompany(c.id)))}
      onContextMenu={(e) => { e.stopPropagation(); ctx.open(e, menu); }}>
      <MatrixTile state={s} size={26} />
      <span className="num" style={{ fontSize: 10.5, fontWeight: 500, color, whiteSpace: "nowrap" }}>{caption}</span>
      {ctx.node}
    </button>
  );
}

export function MatrixTile({ state, size = 26 }: { state: ArchiveState; size?: number }) {
  const s = state;
  const unverified = s.kind === "marked" && s.mark === "unverified";
  const [fill, tint] = s.kind === "valid" || s.kind === "noDate" ? ["var(--lime-soft)", "var(--lime-text)"]
    : s.kind === "expiring" || s.kind === "needsUpdate" || unverified ? ["var(--amber-soft)", "var(--amber-text)"]
      : s.kind === "expired" ? ["var(--danger-soft)", "var(--danger)"] : ["var(--band)", "var(--muted)"];
  const symbol = s.kind === "valid" || s.kind === "noDate" ? "checkmark" : s.kind === "expiring" ? "clock" : s.kind === "expired" ? "exclamationmark" : s.kind === "needsUpdate" ? "arrow.triangle.2.circlepath"
    : s.kind === "missing" ? null : ({ notObtained: "questionmark", restricted: "lock.fill", unverified: "questionmark", external: "building.columns", notApplicable: "minus" } as const)[s.mark];
  return <span className="matrix-tile" aria-hidden style={{ width: size, height: size, borderRadius: size * 0.3, background: fill, color: tint, display: "grid", placeItems: "center", flex: "none" }}>
    {symbol && <Icon name={symbol} size={size * 0.44} strokeWidth={2.6} />}
  </span>;
}

const NotManaged = () => <span aria-label="不适用" style={{ fontSize: 13, fontWeight: 500, color: "color-mix(in srgb, var(--muted) 45%, transparent)" }}>—</span>;
