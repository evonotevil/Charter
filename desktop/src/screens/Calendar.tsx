// 合规日历：按月排列所有截止日，可筛选、一并交办或导出清单。移植自 CalendarView.swift。

import { useEffect, useRef, useState } from "react";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import { type ObligationStatus, latinPad, normalizedStatus, obligationStatusLabel, visibleStatuses } from "../domain/models";
import { type Obligation, daysLeft, obligationDone, obligationStatus } from "../domain/engine";
import { useApp } from "../state/hooks";
import { type CalendarRange, calendarBounds, calendarRangeLabel } from "../state/router";
import { copyMessage, copyHandoff, writeCalendarFile } from "../services/packets";
import { writePDF } from "../services/files";
import { platform } from "../platform/platform";
import { ActionMenu, Button, Checkbox, DateField, EmptyStateView, JurisdictionBadge, Pill, Segmented, SelectField, divider, item, useContextMenu, PageHeader } from "../ui/kit";
import { TrustBadge, obligationMenu, obligationPill } from "./common";

const trustLabel = (k: string) => (k === "confirmed" ? "已确认" : k === "needsReview" ? "需复核" : "待核对");

export function CalendarView({ onBack }: { onBack?: () => void }) {
  const { store, router } = useApp();
  const today = store.today;
  const [range, setRange] = useState<CalendarRange>({ kind: "all" });
  const [customFrom, setCustomFrom] = useState<Day>(today);
  const [customTo, setCustomTo] = useState<Day>(D.addMonths(today, 1));
  const [group, setGroup] = useState<string | null>(null);
  const [jurisdiction, setJurisdiction] = useState<string | null>(null);
  const [partyID, setPartyID] = useState<string | null>(null);
  const [status, setStatus] = useState<ObligationStatus | null>(null);
  const [showDone, setShowDone] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const clear = () => { setRange({ kind: "all" }); setGroup(null); setJurisdiction(null); setPartyID(null); setStatus(null); };
  useEffect(() => {
    const p = router.calendarPreset;
    if (!p) return;
    clear(); setPartyID(p.partyID ?? null); setRange(p.range); setStatus(p.status ?? null);
    router.calendarPreset = null;
  }, [router.calendarPreset]);
  useEffect(() => {
    if (!onBack) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !router.sheet && !document.querySelector(".popover")) onBack(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onBack]);

  const eff: CalendarRange = range.kind === "custom" ? { kind: "custom", from: customFrom < customTo ? customFrom : customTo, to: customFrom < customTo ? customTo : customFrom } : range;
  const { from, to } = calendarBounds(eff, today);
  const scope = store.companyIDsForFilter(group);
  const list = store.allObligations.filter((o) => {
    const inRange = o.due > to ? false : from ? o.due >= from : o.due >= today || !obligationDone(o);
    return inRange && (showDone || status === "done" || !obligationDone(o)) && (!scope || scope.has(o.company.id)) && (!jurisdiction || o.company.jurisdiction === jurisdiction)
      && (!partyID || store.responsibleParty(o)?.id === partyID) && (!status || normalizedStatus(obligationStatus(o)) === status);
  });
  const party = store.party(partyID);
  const hasFilters = range.kind !== "all" || !!group || !!jurisdiction || !!partyID || !!status;
  const overdue = list.filter((o) => !obligationDone(o) && o.due < today);
  const rest = list.filter((o) => !overdue.includes(o)).sort((a, b) => (a.due < b.due ? -1 : 1));
  const monthKey = (d: Day) => d.slice(0, 7);
  const blocks: { id: string; title: string; rows: Obligation[]; alert: boolean }[] = [];
  if (overdue.length) blocks.push({ id: "overdue", title: "已逾期", rows: overdue, alert: true });
  for (const o of rest) {
    const k = monthKey(o.due);
    const b = blocks.find((x) => x.id === k);
    if (b) b.rows.push(o); else blocks.push({ id: k, title: `${D.year(o.due)}年${D.month(o.due)}月`, rows: [o], alert: false });
  }
  const rangeText = eff.kind === "all" ? "未来 12 个月" : eff.kind === "custom" ? `${D.short(eff.from)}–${D.short(eff.to)}` : `${calendarRangeLabel(eff)}（${from ? D.short(from) : "含逾期"}–${D.short(to)}）`;
  const open = list.filter((o) => !obligationDone(o));
  const n = (s: ObligationStatus) => open.filter((o) => normalizedStatus(obligationStatus(o)) === s).length;
  const parts = [n("pending") && `待交办 ${n("pending")}`, n("drafted") && `待发送 ${n("drafted")}`, n("handedOff") && `已交办 ${n("handedOff")}`,
    list.length - open.length && `已完成 ${list.length - open.length}`, overdue.length && `逾期 ${overdue.length}`].filter(Boolean);
  const pending = list.filter((o) => normalizedStatus(obligationStatus(o)) === "pending");
  const drafted = list.filter((o) => normalizedStatus(obligationStatus(o)) === "drafted");

  const exportList = async (csv: boolean) => {
    const title = ("合规事项清单_" + [party?.name, rangeText].filter(Boolean).join("_")).replace(/[\\/]/g, "-");
    const path = await platform().saveDialog({ defaultName: title + (csv ? ".csv" : ".pdf"), extensions: [csv ? "csv" : "pdf"] });
    if (!path) return;
    const sorted = [...list].sort((a, b) => (a.due !== b.due ? (a.due < b.due ? -1 : 1) : a.company.name.localeCompare(b.company.name, "zh")));
    try {
      if (csv) {
        const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const rows = ["截止日,公司,法域,事项,负责方,状态,规则核对", ...sorted.map((o) => [o.due, o.company.name, store.jurisdictionName(o.company.jurisdiction), o.rule.name,
          store.responsibleParty(o)?.name ?? "", obligationStatusLabel[obligationStatus(o)], trustLabel(store.trust(o).kind)].map(q).join(","))];
        await platform().writeText(path, "﻿" + rows.join("\r\n"));
      } else {
        const groups = new Map<string, Obligation[]>();
        for (const o of sorted) groups.set(monthKey(o.due), [...(groups.get(monthKey(o.due)) ?? []), o]);
        const sections = [...groups.entries()].map(([k, os]) => ({ heading: `${+k.slice(0, 4)}年${+k.slice(5)}月（${os.length} 件）`, alert: false,
          lines: os.map((o) => `${D.short(o.due)}　${o.company.name}　${o.rule.name}　${store.responsibleParty(o)?.name ?? "未指定"}　${obligationStatusLabel[obligationStatus(o)]}${!obligationDone(o) && o.due < today ? "　〔已逾期〕" : ""}${store.trust(o).kind === "confirmed" ? "" : "　〔规则待核对〕"}`) }));
        await platform().writeBytes(path, await writePDF("合规事项清单", `${[party?.name, rangeText].filter(Boolean).join("，")}，共 ${sorted.length} 件，${D.long(today)}导出`, sections, "标注“规则待核对”的截止日按草稿规则计算，请以负责方确认为准。"));
      }
      store.showToast(`已导出 ${sorted.length} 件事项。`);
      void platform().reveal(path);
    } catch (e) { store.setError(`导出失败：${(e as Error).message}`); }
  };

  // 未来 12 个月分布
  const counts = new Map<string, number>();
  for (const o of list) if (!obligationDone(o) && o.due >= today) counts.set(monthKey(o.due), (counts.get(monthKey(o.due)) ?? 0) + 1);
  const strip = Array.from({ length: 12 }, (_, i) => { const d = D.addMonths(D.makeDay(D.year(today), D.month(today), 1), i); return { k: monthKey(d), m: D.month(d), y: D.year(d), n: counts.get(monthKey(d)) ?? 0 }; });
  const maxN = Math.max(1, ...strip.map((s) => s.n));
  const jump = (id: string) => scroller.current?.querySelector(`[data-month="${id}"]`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  return (
    <div ref={scroller} className="scroll grow">
      <div className="col" style={{ padding: "var(--page-edge)", maxWidth: 1240, margin: "0 auto" }}>
        <div className="col gap16" style={{ paddingBottom: 24 }}>
          <div style={{ paddingBottom: 8 }}>
            <PageHeader title="合规日历" subtitle="按月排列所有截止日。筛选出的事项可一并交办或导出为清单。">
              {onBack && <Button icon="chevron.left" onClick={onBack}>返回</Button>}
            </PageHeader>
          </div>
          <div className="col gap10">
            <Segmented options={[["all", "未来 12 个月"], ["thisMonth", "本月"], ["nextMonth", "下月"], ["next3Months", "未来 3 个月"], ["custom", "自定义"]] as [CalendarRange["kind"], string][]}
              value={range.kind} onChange={(k) => setRange(k === "custom" ? { kind: "custom", from: customFrom, to: customTo } : ({ kind: k } as CalendarRange))} />
            <div className="row gap8 wrap">
              {range.kind === "custom" && <>
                <span className="muted">从</span><DateField value={customFrom} onChange={(d) => d && setCustomFrom(d)} allowsClear={false} minWidth={140} />
                <span className="muted">到</span><DateField value={customTo} onChange={(d) => d && setCustomTo(d)} allowsClear={false} minWidth={140} />
              </>}
              <SelectField options={[[null, "全部负责方"] as [string | null, string], ...store.data.parties.map((p) => [p.id, p.name] as [string, string])]} value={partyID} onChange={setPartyID} minWidth={130} />
              <SelectField options={[[null, "全部法域"] as [string | null, string], ...store.data.library.jurisdictions.map((j) => [j.code, j.name] as [string, string])]} value={jurisdiction} onChange={setJurisdiction} minWidth={110} />
              {store.data.groups.length > 1 && <SelectField options={[[null, "全部集团"] as [string | null, string], ...store.data.groups.map((g) => [g.id, g.name] as [string, string])]} value={group} onChange={setGroup} minWidth={110} />}
              <SelectField options={[[null, "全部状态"] as [ObligationStatus | null, string], ...visibleStatuses.map((s) => [s, obligationStatusLabel[s]] as [ObligationStatus, string])]} value={status} onChange={setStatus} minWidth={110} />
              <Checkbox checked={showDone} onChange={setShowDone} disabled={status === "done"}>含已完成</Checkbox>
            </div>
          </div>
          <div className="row baseline gap10">
            <span className="t-row">{(party ? latinPad(party.name) + "名下" : "") + rangeText}共 {list.length} 件</span>
            {parts.length > 0 && <span className="t-body muted">{parts.join("，")}</span>}
            <span className="spacer" />
            {hasFilters && <Button kind="quiet" size="small" onClick={clear}>清除筛选</Button>}
          </div>
          {list.length > 0 && <div className="row gap8">
            {party ? <>
              {pending.length > 0 && <>
                <Button kind="primary" title={`复制交办文字，发给${latinPad(party.name)}后点“确认已发送”`} onClick={() => { void copyHandoff(party, pending); store.draft(pending, party, "邮件"); }}>交给{latinPad(party.name)}办理（{pending.length} 件）</Button>
                <ActionMenu icon="chevron.down" ariaLabel="其他交办方式" entries={[
                  item(`复制邮件格式文字（${pending.length} 件）`, "envelope", () => { void copyHandoff(party, pending); store.draft(pending, party, "邮件"); }),
                  item("复制简短清单（企业微信、飞书等）", "doc.on.doc", () => { void copyMessage(pending); store.draft(pending, party, "消息"); }),
                  item(`已通过其他方式交办（${pending.length} 件）`, "paperplane", () => store.confirmSent(pending, party, "其他")),
                ]} />
              </>}
              {drafted.length > 0 && <Button kind={pending.length ? "secondary" : "primary"} onClick={() => store.confirmSent(drafted, undefined, drafted[0].record?.log?.[drafted[0].record.log.length - 1]?.channel)}>确认已发送（{drafted.length} 件）</Button>}
            </> : pending.length > 0 && <span className="t-body muted">选择负责方后，可将筛选出的事项一并交办。</span>}
            <span className="spacer" />
            <ActionMenu title="导出清单" icon="square.and.arrow.up" align="end" entries={[item("PDF…", "doc.text", () => void exportList(false)), item("CSV（可用 Excel 打开）…", "tablecells", () => void exportList(true)), divider,
              item("订阅到日历应用…", "calendar.badge.plus", () => void writeCalendarFile(store).then(async (path) => {
                await platform().reveal(path);
                store.showToast("已显示日历文件。用日历应用打开它即可订阅，事项变化时 Charter 会自动更新这个文件。");
              }).catch((e) => store.showToast(`无法写入日历文件：${(e as Error).message}`)))]} />
          </div>}
        </div>
        {range.kind === "all" && list.length > 0 && (
          <div className="row surface" aria-label="未来 12 个月事项分布" style={{ alignItems: "flex-end", gap: 6, height: 102, padding: "16px 24px", marginBottom: 40 }}>
            {strip.map((s) => (
              <button key={s.k} className="col grow" disabled={!s.n} title={s.n ? `${s.y}年${s.m}月：${s.n} 件` : ""} onClick={() => jump(s.k)} style={{ gap: 5, alignItems: "stretch", justifyContent: "flex-end", height: "100%" }}>
                <span className="num" style={{ fontSize: 11, fontWeight: 700, textAlign: "center", minHeight: 14 }}>{s.n || ""}</span>
                <span style={{ height: 6 + 30 * s.n / maxN, borderRadius: 3, background: s.n ? "color-mix(in srgb, var(--ink) 80%, transparent)" : "var(--band)" }} />
                <span className="muted" style={{ fontSize: 11, textAlign: "center" }}>{s.m}月</span>
              </button>
            ))}
          </div>
        )}
        {blocks.length > 0 && <div className="surface" style={{ paddingBottom: 8 }}>
          {blocks.map((b, i) => (
            <section key={b.id} data-month={b.id}>
              <div role="heading" aria-level={2} style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface)", borderRadius: i === 0 ? "var(--r-surface) var(--r-surface) 0 0" : 0 }}>
                {i > 0 && <div className="hairline" />}
                <div className="row baseline gap8" style={{ padding: `${i === 0 ? 24 : 16}px 24px 8px` }}>
                  <span className="t-section" style={{ color: b.alert ? "var(--danger)" : "var(--ink)" }}>{b.title}</span><span className="t-meta muted">{b.rows.length} 件</span>
                </div>
              </div>
              <div style={{ padding: "0 6px 4px" }}>
                {b.rows.map((o, k) => <div key={o.key}>{k > 0 && <div className="hairline" style={{ margin: "0 12px" }} />}<CalendarRow o={o} /></div>)}
              </div>
            </section>
          ))}
        </div>}
        {!list.length && <div className="surface"><EmptyStateView symbol="calendar" title="没有符合筛选条件的事项" message={hasFilters ? "试试放宽时间范围，或清除筛选。" : "接下来没有需要办理的合规事项。"} actionTitle={hasFilters ? "清除筛选" : undefined} action={clear} /></div>}
      </div>
    </div>
  );
}

function CalendarRow({ o }: { o: Obligation }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const left = daysLeft(o, store.today);
  const done = obligationDone(o);
  const st = normalizedStatus(obligationStatus(o));
  const r = done ? store.receipt(o) : undefined;
  return (
    <div className="row gap14 hover-band" style={{ height: 58, padding: "0 12px", borderRadius: "var(--r-row)", opacity: done ? 0.6 : 1 }} onContextMenu={(e) => ctx.open(e, obligationMenu(store, router, o))}>
      <button className="row gap14 grow" style={{ textAlign: "left", minWidth: 0, height: "100%" }} onClick={() => router.open({ kind: "obligation", key: o.key })}>
        <span className="col" style={{ width: 44, alignItems: "center", flex: "none" }}>
          <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>{D.dayOfMonth(o.due)}</span>
          <span className="muted" style={{ fontSize: 10.5 }}>{D.weekdayName(o.due).replace("星期", "周")}</span>
        </span>
        <JurisdictionBadge code={o.company.jurisdiction} size={34} />
        <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
          <span className="row gap6"><span className="t-row ellipsis" style={{ textDecoration: done ? "line-through" : undefined }}>{o.rule.name}</span><TrustBadge trust={store.trust(o)} /></span>
          <span className="t-meta muted ellipsis">{o.company.name}，{store.responsibleParty(o)?.name ?? "未指定负责方"}</span>
        </span>
        {st !== "pending" && <Pill text={obligationStatusLabel[obligationStatus(o)]} kind={obligationPill(o)} />}
        <span className="num" style={{ width: 80, textAlign: "right", fontSize: 13, fontWeight: 600, flex: "none", color: done ? "var(--muted)" : left < 0 ? "var(--danger)" : left <= 7 ? "var(--amber-text)" : "var(--muted)" }}>
          {done ? (o.record?.completedOn ? `${D.short(o.record.completedOn)}完成` : "") : left < 0 ? `逾期 ${-left} 天` : left === 0 ? "今天" : `${left} 天后`}
        </span>
      </button>
      {r && <Button kind="quiet" size="small" title="打开存档的回执" onClick={() => void store.openDocument(r)}>回执</Button>}
      {ctx.node}
    </div>
  );
}
