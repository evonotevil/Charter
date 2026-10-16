// 总览：现在要处理几件事 → 随时能出哪些材料 → 接下来 30 天 → 在等回件。移植自 DashboardView.swift。

import { useState } from "react";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import { type ArchiveState, type Document, type NodeRef, isHandedOff, ref } from "../domain/models";
import { type Obligation, daysLeft, expiryOf } from "../domain/engine";
import { useApp } from "../state/hooks";
import { ungrouped } from "../state/store";
import { Icon } from "../ui/Icon";
import { ActionMenu, Avatar, Button, ConfirmSheet, JurisdictionBadge, type MenuEntry, Pill, ProgressCapsule, Skeleton, divider, item, useContextMenu } from "../ui/kit";
import { DropZone } from "../ui/drop";
import { installSampleData } from "../state/sample";
import {
  NextStepControls, type PurposeReadiness, PurposeReadinessAction, ReissueRequestSheet, SectionHeader, StatusPill, Surface, TrustBadge,
  WaitingRequestsSection, computeReadiness, stateColor, stateLine,
} from "./common";

interface Row { document: Document; owner: NodeRef; name: string; state: ArchiveState }
type Bucket = 0 | 1 | 2 | 3;
const bucketTitle = ["已逾期", "本周", "30 天内", "需更新/待核对"];
const bucketColor = ["var(--danger)", "var(--amber-text)", "var(--muted)", "var(--muted)"];
interface Entry { row?: Row; obligation?: Obligation; date?: Day; bucket: Bucket; id: string }
const perBucket = 6;

function rank(s: ArchiveState) { return s.kind === "expired" ? 0 : s.kind === "needsUpdate" ? 1 : s.kind === "expiring" ? 2 : 3; }

export function Dashboard() {
  const { store, router } = useApp();
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (store.isLoading) return <div className="scroll grow"><DashboardSkeleton /></div>;
  if (!store.data.companies.length) return <FirstRunView />;

  const filter = router.groupFilter;
  const scope = store.companyIDsForFilter(filter);
  const companies = store.data.companies.filter((c) => !scope || scope.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const today = store.today;

  const attention: Row[] = store.attentionCompanyDocuments(filter).map((d) => {
    const f = store.freshness(d);
    const state: ArchiveState = f.kind === "expired" ? { kind: "expired", days: f.days } : f.kind === "expiring" ? { kind: "expiring", days: f.days } : f.kind === "unknown" ? { kind: "noDate" } : { kind: "needsUpdate" };
    return { document: d, owner: d.owner, name: store.docType(d.typeID)?.name ?? "文件", state };
  }).sort((a, b) => rank(a.state) - rank(b.state) || store.nameOf(a.owner).localeCompare(store.nameOf(b.owner), "zh"));

  const obligations = store.complianceOn ? store.openObligations.filter((o) => (!scope || scope.has(o.company.id)) && store.needsMe(o) && (daysLeft(o, today) <= 30 || store.waitingTooLong(o))) : [];
  const waitingObligations = store.complianceOn ? store.openObligations.filter((o) => (!scope || scope.has(o.company.id)) && isHandedOff(o.record?.status ?? "pending") && !store.waitingTooLong(o)).sort((a, b) => (a.due < b.due ? -1 : 1)) : [];

  const entries: Entry[] = [];
  for (const r of attention) {
    const expiry = expiryOf(r.document, store.docType(r.document.typeID));
    const bucket: Bucket = r.state.kind === "expired" ? 0 : r.state.kind === "expiring" ? (expiry ? (D.daysBetween(today, expiry) <= 7 ? 1 : 2) : 3) : 3;
    entries.push({ row: r, date: expiry, bucket, id: `d-${r.document.id}` });
  }
  for (const o of obligations) {
    const left = daysLeft(o, today);
    entries.push({ obligation: o, date: o.due, bucket: left < 0 ? 0 : left <= 7 || store.waitingTooLong(o) ? 1 : 2, id: `o-${o.key}` });
  }
  entries.sort((a, b) => a.bucket - b.bucket || (a.date && b.date ? (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1) : a.date ? -1 : b.date ? 1 : a.id < b.id ? -1 : 1));

  const openRow = (r: Row) => {
    if (r.owner.kind === "company") { router.companyTab = 0; router.openCompany(r.owner.id); }
    else router.open({ kind: "document", id: r.document.id });
  };
  const openEntry = (e: Entry) => { if (e.row) openRow(e.row); else if (e.obligation) router.open({ kind: "obligation", key: e.obligation.key }); };

  // 用途准备度
  const all = computeReadiness(store, companies.map((c) => c.id));
  const purposes = store.data.library.packets.map((t) => ({
    template: t,
    rows: all.filter((r) => r.templateID === t.id).sort((a, b) => (a.complete !== b.complete ? (a.complete ? 1 : -1) : a.missing.length - b.missing.length || a.companyName.localeCompare(b.companyName, "zh"))),
  })).filter((p) => p.rows.length);

  return (
    <div className="scroll grow">
      <div className="col appear" style={{ gap: 40, padding: "var(--page-edge)", maxWidth: 1240, margin: "0 auto", width: "100%" }}>
        <div className="col gap24">
          <Header />
          <Hero entries={entries} obligations={obligations} onFirst={openEntry} />
        </div>
        {purposes.length > 0 && (
          <div className="col gap12">
            <SectionHeader title="随时能出哪些材料" subtitle={`按用途检查${store.filterName(filter)}的文件包，缺的那份可以直接请负责方补发。`}>
              <Button kind="quiet" size="small" title="在公司页查看公司 × 档案类别矩阵" onClick={() => { router.companiesMode = "matrix"; router.go("companies"); }}>查看矩阵</Button>
            </SectionHeader>
            <Surface>
              {purposes.map((p, i) => {
                const open = expanded.has(p.template.id);
                const ready = p.rows.filter((r) => r.complete).length;
                const missing = p.rows.length - ready;
                return (
                  <div key={p.template.id}>
                    {i > 0 && <div className="hairline" style={{ margin: "0 16px" }} />}
                    <button className="row gap16 hover-band" style={{ width: "100%", height: 52, padding: "0 16px", borderRadius: "var(--r-row)" }}
                      aria-expanded={open} onClick={() => { const s = new Set(expanded); if (open) s.delete(p.template.id); else s.add(p.template.id); setExpanded(s); }}>
                      <span className={`chev muted ${open ? "open" : ""}`} style={{ width: 12 }}><Icon name="chevron.right" size={10} /></span>
                      <span className="t-row ellipsis" style={{ width: 160, textAlign: "left" }}>{p.template.name}</span>
                      <ProgressCapsule value={ready / Math.max(p.rows.length, 1)} style={{ width: 160 }} />
                      <span className="spacer" />
                      <span className="t-meta num" style={{ color: ready ? "var(--ink)" : "var(--muted)" }}>{ready} 家可随时导出</span>
                      {missing > 0 && <span className="t-meta num amber-text">{missing} 家还缺文件</span>}
                    </button>
                    {open && <div className="col appear" style={{ paddingLeft: 28, paddingBottom: 8 }}>
                      {p.rows.map((r) => <ReadinessRow key={r.companyID} r={r} onReissue={(owner, typeIDs) => setReissue({ owner, typeIDs })} />)}
                    </div>}
                  </div>
                );
              })}
            </Surface>
          </div>
        )}
        <Timeline entries={entries} documentTotal={attention.length} onOpenRow={openRow} onReissue={(owner, typeIDs) => setReissue({ owner, typeIDs })} />
        <WaitingRequestsSection scope={scope} obligations={waitingObligations} />
      </div>
      {reissue && <ReissueRequestSheet owner={reissue.owner} typeIDs={reissue.typeIDs} onClose={() => setReissue(null)} />}
    </div>
  );
}

function Header() {
  const { router } = useApp();
  const h = new Date().getHours();
  const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  return (
    <div className="row gap16">
      <h1 className="t-page ellipsis">{h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好"}</h1>
      <span className="spacer" />
      <button className="row gap8" onClick={() => router.open({ kind: "quickSearch" })} aria-label="查找公司或人员"
        style={{ width: 260, height: 38, padding: "0 6px 0 16px", borderRadius: 999, background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
        <Icon name="magnifyingglass" className="muted" /><span className="muted grow" style={{ textAlign: "left" }}>查找公司或人员</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "0 8px", height: 24, lineHeight: "24px", borderRadius: 999, background: "var(--band)" }}>{mod}</span>
      </button>
    </div>
  );
}

function Hero({ entries, obligations, onFirst }: { entries: Entry[]; obligations: Obligation[]; onFirst: (e: Entry) => void }) {
  const { store, router } = useApp();
  const n = entries.length;
  const personal = store.attentionPersonalCount;
  const missingHolders = store.incompleteShareholderCount(store.companyIDsForFilter(router.groupFilter));
  const rows = entries.flatMap((e) => (e.row ? [e.row] : []));
  const expired = rows.filter((r) => r.state.kind === "expired").length;
  const expiring = rows.filter((r) => r.state.kind === "expiring").length;
  const other = rows.length - expired - expiring;
  const parts: string[] = [];
  if (expired) parts.push(`${expired} 份已过期`);
  if (expiring) parts.push(`${expiring} 份即将到期`);
  if (other) parts.push(`${other} 份需更新或日期待核对`);
  if (obligations.length) {
    const late = obligations.filter((o) => daysLeft(o, store.today) < 0).length;
    parts.push(late ? `${obligations.length} 件合规事项待你处理（${late} 件已逾期）` : `${obligations.length} 件合规事项待你处理`);
  }
  const first = entries[0];
  const firstHelp = first?.row ? `${store.nameOf(first.row.owner)}：${first.row.name}` : first?.obligation ? `${first.obligation.company.name}：${first.obligation.rule.name}` : "";
  const link = { textDecoration: "underline", fontSize: 12.5, color: "var(--on-lime)", textAlign: "left" } as const;
  return (
    <section className="row" style={{ alignItems: "flex-end", gap: 16, padding: 24, borderRadius: "var(--r-surface)", background: "var(--lime)", color: "var(--on-lime)" }}>
      <div className="col grow" style={{ gap: 8, alignItems: "flex-start" }}>
        {n > 0 ? <>
          <div className="row baseline gap8"><span className="t-display num">{n}</span><span className="t-section">{obligations.length ? "项需处理" : "份文件需处理"}</span></div>
          <span className="t-body" style={{ opacity: .7 }}>{parts.join("，")}</span>
        </> : <>
          <span className="t-display">一切就绪</span>
          <span className="t-body" style={{ opacity: .7 }}>{store.complianceOn ? "当前范围内没有需要处理的文件，30 天内也没有待你办理的合规事项。" : "当前范围内没有过期、即将到期或需要更新的公司文件。"}</span>
        </>}
        {personal > 0 && <button style={link} onClick={() => { router.filesFilter = 2; router.filesOwnerKind = "person"; router.go("files"); }}>另有 {personal} 份个人文件需处理</button>}
        {missingHolders > 0 && <button style={link} title="在股权结构中打开“核对股东”"
          onClick={() => router.openStructure({ group: router.groupFilter === ungrouped ? null : router.groupFilter, check: true })}>有 {missingHolders} 家公司股东不完整</button>}
      </div>
      {first ? (
        <button className="row gap6" onClick={() => onFirst(first)} title={firstHelp}
          style={{ height: 30, padding: "0 14px", borderRadius: 999, background: "var(--emphasis)", color: "var(--on-emphasis)", fontSize: 13, fontWeight: 600, flex: "none" }}>
          先处理第一项<Icon name="arrow.right" size={11} />
        </button>
      ) : <span aria-hidden style={{ width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--on-lime) 10%, transparent)" }}><Icon name="checkmark" size={18} /></span>}
    </section>
  );
}

function ReadinessRow({ r, onReissue }: { r: PurposeReadiness; onReissue: (o: NodeRef, t: string[]) => void }) {
  const { router } = useApp();
  return (
    <div className="row gap16" style={{ padding: "10px 16px" }}>
      <button className="row gap10" style={{ width: 240, flex: "none" }} title={`打开${r.companyName}的档案`} onClick={() => { router.companyTab = 0; router.openCompany(r.companyID); }}>
        <JurisdictionBadge code={r.jurisdiction} size={24} /><span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{r.companyName}</span>
      </button>
      <span className="t-meta muted grow" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={r.complete ? "" : r.missingDetail.join("\n")}>
        {r.complete ? "齐全，可随时导出" : "还缺：" + r.missing.join("、")}
      </span>
      <span className="row" style={{ width: 140, justifyContent: "flex-end", flex: "none" }}><PurposeReadinessAction row={r} onReissue={onReissue} /></span>
    </div>
  );
}

function Timeline({ entries, documentTotal, onOpenRow, onReissue }: { entries: Entry[]; documentTotal: number; onOpenRow: (r: Row) => void; onReissue: (o: NodeRef, t: string[]) => void }) {
  const { store, router } = useApp();
  const groups = ([0, 1, 2, 3] as Bucket[]).map((b) => { const all = entries.filter((e) => e.bucket === b); return { b, shown: all.slice(0, perBucket), total: all.length }; }).filter((g) => g.total);
  const truncated = groups.some((g) => g.shown.length < g.total);
  return (
    <div className="col gap12">
      <SectionHeader title="接下来 30 天" subtitle={store.complianceOn ? "文件到期与合规截止，按日期排列" : "文件到期与需要更新的文件，按日期排列"} />
      <Surface>
        {!groups.length && <div className="t-body muted" style={{ padding: 16 }}>{store.complianceOn ? "30 天内没有到期的文件，也没有待你办理的合规截止。" : "30 天内没有到期或需要更新的文件。"}</div>}
        {groups.map((g, gi) => (
          <div key={g.b}>
            {gi > 0 && <div className="hairline" />}
            <div className="row gap8" role="heading" aria-level={3} style={{ height: 32, padding: "0 16px", background: "color-mix(in srgb, var(--band) 50%, transparent)" }}>
              <span className="t-micro" style={{ color: bucketColor[g.b] }}>{bucketTitle[g.b]}</span>
              <span className="mono muted" style={{ fontSize: 11.5 }}>{g.total}</span>
            </div>
            {g.shown.map((e, i) => (
              <div key={e.id}>
                {i > 0 && <div className="hairline" style={{ margin: "0 16px" }} />}
                {e.row ? <AttentionRow r={e.row} onOpen={onOpenRow} onReissue={onReissue} /> : e.obligation ? <ObligationLine o={e.obligation} /> : null}
              </div>
            ))}
          </div>
        ))}
      </Surface>
      {(store.complianceOn || truncated) && (
        <div className="row gap8" style={{ justifyContent: "flex-end" }}>
          {truncated && documentTotal > 0 && <Button kind="quiet" size="small" onClick={() => { router.filesFilter = 2; router.filesOwnerKind = "company"; router.go("files"); }}>查看全部 {documentTotal} 份需处理文件</Button>}
          {store.complianceOn && <Button kind="quiet" size="small" title="打开合规日历：按月排列所有截止日，可筛选、交办或导出" onClick={() => router.openCalendar()}>查看全部日程</Button>}
        </div>
      )}
    </div>
  );
}

/** 两种行共用的操作列宽度，保证状态与日期列对齐。 */
const ACTIONS = 280;

function AttentionRow({ r, onOpen, onReissue }: { r: Row; onOpen: (r: Row) => void; onReissue: (o: NodeRef, t: string[]) => void }) {
  const { store, router } = useApp();
  const c = r.owner.kind === "company" ? store.company(r.owner.id) : undefined;
  const waiting = store.openRequest(r.owner, r.document.typeID);
  const menu: MenuEntry[] = [
    waiting ? item(`已在等${store.party(waiting.partyID)?.name ?? "负责方"}补发`, "hourglass", () => {}, { disabled: true })
      : item("请负责方补发…", "paperplane", () => onReissue(r.owner, [r.document.typeID])),
    item("查看文件详情", "doc.text.magnifyingglass", () => router.open({ kind: "document", id: r.document.id })),
  ];
  const expiry = expiryOf(r.document, store.docType(r.document.typeID));
  return (
    <div className="row">
      <button className="row hover-band grow" style={{ height: 56, padding: "0 16px", borderRadius: "var(--r-row)", textAlign: "left", minWidth: 0 }} onClick={() => onOpen(r)}>
        <span className="row gap10 grow" style={{ minWidth: 0 }} title={store.nameOf(r.owner)}>
          {c ? <JurisdictionBadge code={c.jurisdiction} size={28} /> : <Avatar name={store.nameOf(r.owner)} size={28} />}
          <span className="col" style={{ gap: 1, minWidth: 0 }}>
            <span className="t-row ellipsis">{store.nameOf(r.owner)}</span>
            <span className="mono muted" style={{ fontSize: 11.5 }}>{c ? c.registrationNumber : "人员"}</span>
          </span>
        </span>
        <span className="ellipsis" style={{ width: 190, fontSize: 13.5, flex: "none" }}>{r.name}</span>
        <span style={{ width: 110, flex: "none" }}><StatusPill state={r.state} /></span>
        <span className="mono" style={{ width: 96, flex: "none", fontSize: 12.5, color: stateColor(r.state) }}>{expiry ?? "—"}</span>
      </button>
      <span className="row" style={{ width: ACTIONS, flex: "none", justifyContent: "flex-end", padding: "0 4px" }}>
        {waiting ? <span className="t-meta muted ellipsis" title="已复制请补发文字，跟进日到了会提醒">在等{store.party(waiting.partyID)?.name ?? "负责方"}补发</span>
          : <Button size="small" onClick={() => onReissue(r.owner, [r.document.typeID])}>请补发</Button>}
      </span>
      <span style={{ width: 32, marginRight: 8 }}><ActionMenu icon="ellipsis" kind="quiet" size="small" entries={menu} align="end" ariaLabel="更多操作" /></span>
    </div>
  );
}

function ObligationLine({ o }: { o: Obligation }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const left = daysLeft(o, store.today);
  const late = store.waitingTooLong(o);
  const menu: MenuEntry[] = [
    ...(left < 0 && store.trust(o).kind !== "confirmed" && !isHandedOff(o.record?.status ?? "pending")
      ? [item("向负责方确认截止日…", "checkmark.seal", () => router.open({ kind: "confirmRule", ruleID: o.rule.id, companyID: o.company.id }))] : []),
    item("事项详情", "info.circle", () => router.open({ kind: "obligation", key: o.key })),
    item("打开公司", "building.2", () => router.openCompany(o.company.id)),
    divider,
    item("标记完成", "checkmark", () => store.complete(o)),
  ];
  return (
    <div className="row" onContextMenu={(e) => ctx.open(e, menu)}>
      <button className="row hover-band grow" style={{ height: 56, padding: "0 8px 0 16px", borderRadius: "var(--r-row)", textAlign: "left", minWidth: 0 }} onClick={() => router.open({ kind: "obligation", key: o.key })}>
        <span className="row gap10 grow" style={{ minWidth: 0 }} title={o.company.name}>
          <JurisdictionBadge code={o.company.jurisdiction} size={28} />
          <span className="col" style={{ gap: 1, minWidth: 0 }}>
            <span className="t-row ellipsis">{o.company.name}</span>
            <span className="ellipsis" style={{ fontSize: 11.5, color: late ? "var(--amber-text)" : "var(--muted)" }}>{stateLine(store, o)}</span>
          </span>
        </span>
        <span className="row gap4" style={{ width: 190, flex: "none", minWidth: 0 }}><span className="ellipsis" style={{ fontSize: 13.5 }}>{o.rule.name}</span><TrustBadge trust={store.trust(o)} /></span>
        <span style={{ width: 110, flex: "none" }}><Pill text={left < 0 ? `逾期 ${-left} 天` : left === 0 ? "今天截止" : `${left} 天后截止`} kind={left < 0 ? "bad" : left <= 7 ? "warn" : "neutral"} /></span>
        <span className="mono" style={{ width: 96, flex: "none", fontSize: 12.5, color: left < 0 ? "var(--danger)" : "var(--ink)" }}>{o.due}</span>
      </button>
      <span className="row" style={{ width: ACTIONS, flex: "none", justifyContent: "flex-end", padding: "0 4px", overflow: "hidden" }}><NextStepControls o={o} large={false} emphasized={false} /></span>
      <span style={{ width: 32, marginRight: 8 }}><ActionMenu icon="ellipsis" kind="quiet" size="small" entries={menu} align="end" ariaLabel="更多操作" /></span>
      {ctx.node}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="col" aria-label="正在读取档案" style={{ gap: 40, padding: "var(--page-edge)", maxWidth: 1240, margin: "0 auto" }}>
      <div className="row"><Skeleton width={160} height={28} /><span className="spacer" /><Skeleton width={260} height={38} /></div>
      <Skeleton height={120} />
      <div className="col gap12"><Skeleton width={120} height={17} />
        <div className="col gap16 surface" style={{ padding: 16 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={24} />)}</div>
      </div>
    </div>
  );
}

export function FirstRunView() {
  const { store, router } = useApp();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="scroll grow">
      <div className="col appear" style={{ padding: "40px 40px 48px", maxWidth: 1000, margin: "0 auto" }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.2, margin: 0 }}>把公司文件交给 Charter，剩下的它来整理。</h1>
        <p className="muted" style={{ fontSize: 15, maxWidth: 620, marginTop: 10 }}>拖入注册证书、章程、董事名册、存续证明。Charter 会识别属于哪家公司、是什么文件、何时签发，并告诉你哪些用途已经可以随时出材料。</p>
        <div style={{ marginTop: 28 }}>
          <DropZone title="把 PDF 或照片拖到这里" subtitle="也可以拖入整个文件夹。或者点这里，选择要导入的文件。"
            action={() => void router.chooseFiles(null)} onDrop={(paths) => router.startImport(paths, null)} />
        </div>
        <div className="row surface" style={{ marginTop: 20, alignItems: "stretch", overflow: "hidden", padding: 0 }}>
          <button className="choice grow" onClick={() => router.open({ kind: "newGroup" })}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>从一家顶层公司开始</span><span className="muted" style={{ fontSize: 13 }}>手动建立集团和公司，之后再补文件。</span>
          </button>
          <span style={{ width: 1, background: "var(--hairline)" }} />
          <button className="choice grow" onClick={() => setConfirm(true)}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>先看示例数据</span><span className="muted" style={{ fontSize: 13 }}>一个虚构的远澜集团，12 家公司，可随时清空。</span>
          </button>
        </div>
        <div className="row gap8" style={{ marginTop: 18 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--lime)" }} />
          <span className="muted" style={{ fontSize: 12.5 }}>文件只保存在你的数据文件夹，识别在本机完成。</span>
        </div>
      </div>
      {confirm && <ConfirmSheet title="载入示例数据？" message="将载入一个虚构的远澜集团，12 家公司，用来先看看 Charter 的样子。之后可以在设置里随时清空。"
        confirmTitle="载入示例数据" onConfirm={() => { setConfirm(false); void installSampleData(store); }} onClose={() => setConfirm(false)} />}
    </div>
  );
}

void ref;
