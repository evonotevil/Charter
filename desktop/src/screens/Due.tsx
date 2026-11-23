// 申报日历：横幅、范围页签、按月时间线（打勾完成）+ 右侧详情（找谁办、对接人、邮件草稿）。

import { companyTint, isNarrowWindow } from "../ui/uistyle";
import { type CSSProperties, type ReactNode, type RefObject, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import * as D from "../domain/day";
import { type Obligation, obligationStatus } from "../domain/engine";
import { filingChecklistCSV, type FilingChecklistRow } from "../domain/filingChecklist";
import { contactsOf } from "../domain/models";
import { platform } from "../platform/platform";
import { CALENDAR_SUBSCRIPTION_DAYS, writeCalendarFile } from "../services/packets";
import { ActionMenu, Banner, Button, Card, DateField, PageHeader, PopoverRow, SelectField, Tabs, divider, header, item, TextField, useFocusReturn } from "../ui/kit";
import { PickChip } from "./PropChips";
import { useStageFile } from "./common";
import { FilingDeadlinePill, leftText } from "./InfoCard";
import { Icon } from "../ui/Icon";
import { reducedMotion, TweenNumber, useChildMotion } from "../ui/motion";
import type { Document } from "../domain/models";
import "./layout557.css";
import "./due558.css";
import { DueCompletionQueue, DueUndoTimer } from "./dueUndo";

type Range = 90 | 365 | 0;
const rangeLabels: Record<Range, string> = { 90: "90 天内", 365: "一年内", 0: "全部" };
type CompletionNotice = { id: number; key: string; text: string; undo: () => void };
type BurstOrigin = { id: number; x: number; y: number };
type PlayBurst = (button: HTMLButtonElement, id: number) => void;

export function DueView({ feedback }: { feedback: ReactNode }) {
  const { store, router } = useApp();
  const [range, setRange] = useState<Range>(() => {
    const requested = store.openObligations.find((o) => o.key === router.selectedObligationKey);
    return requested && D.daysBetween(store.today, requested.due) > 365 ? 0 : 365;
  });
  const list = useMemo(() => store.openObligations
    .filter((o) => !range || D.daysBetween(store.today, o.due) <= range)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.company.name.localeCompare(b.company.name))), [store.data, range, store.today]);
  const sel = list.find((o) => o.key === router.selectedObligationKey) ?? list[0];
  const selectedKey = sel?.key ?? null;
  useEffect(() => {
    if (selectedKey !== router.selectedObligationKey) router.set("selectedObligationKey", selectedKey);
  }, [router, selectedKey, router.selectedObligationKey]);
  // 5.4：窄窗口（单栏）里详情改成右侧抽屉，点击事项后打开并聚焦
  const pageRef = useRef<HTMLDivElement>(null);
  const narrow = useCalendarDrawerLayout(pageRef);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);
  const soon = list.filter((o) => D.daysBetween(store.today, o.due) <= 30).length;
  const [completion, setCompletion] = useState<CompletionNotice | null>(null);
  const completionTimer = useRef(new DueUndoTimer());
  const completionQueue = useRef(new DueCompletionQueue());
  useEffect(() => () => {
    completionTimer.current.cancel();
    completionQueue.current.dispose();
  }, []);
  // 5.5.8：完成提示独立于全局提示。复制邮件不打断计时；连续完成只保留最近一项的撤销。
  const finish = (o: Obligation, receipt?: Document, pendingSequence?: number) => {
    let id = pendingSequence;
    if (id === undefined) {
      completionQueue.current.cancel(o.key);
      setLeaving((current) => { const next = new Set(current); next.delete(o.key); return next; });
      id = completionQueue.current.begin();
    }
    const result = store.complete(o, receipt, { toast: false });
    if (!completionQueue.current.isLatest(id)) return;
    setCompletion({ id, key: o.key, text: `已完成：${o.company.name} · ${o.rule.name}`, undo: result.undo });
    completionTimer.current.start(() => setCompletion((current) => current?.id === id ? null : current));
  };
  const listRef = useChildMotion<HTMLDivElement>(String(range));

  const months: { label: string; items: Obligation[] }[] = [];
  for (const o of list) {
    const label = D.year(o.due) === D.year(store.today) ? `${D.month(o.due)}月` : `${D.year(o.due)}年${D.month(o.due)}月`;
    if (months[months.length - 1]?.label !== label) months.push({ label, items: [] });
    months[months.length - 1].items.push(o);
  }

  const subscribe = async () => {
    let path: string;
    try { path = await writeCalendarFile(store); }
    catch { store.showToast("日历文件写入失败，未生成订阅文件。", undefined, "", "calendar-error"); return; }
    try {
      await platform().reveal(path);
      store.showToast(store.data.settings.calendarEnabled && store.complianceOn
        ? "日历订阅文件已生成。申报事项有变动时，Charter 会更新这份文件。"
        : "日历订阅文件已生成。若要持续更新，请在提醒设置里开启“保持订阅文件更新”。");
    } catch { store.showToast("日历文件已生成，但没能在文件夹中显示。", undefined, "", "failure"); }
  };

  const exportList = async (format: "pdf" | "csv") => {
    const exportedOn = store.today;
    const rangeLabel = rangeLabels[range];
    const rows: FilingChecklistRow[] = list.map(o => ({
      due: o.due,
      company: o.company.name,
      jurisdiction: store.jurisdictionName(o.company.jurisdiction),
      filing: o.rule.name,
      agent: store.responsibleParty(o)?.name ?? "",
      dateConfirmed: !!o.record?.dateConfirmed,
      overdue: o.due < exportedOn,
    }));
    try {
      const path = await platform().saveDialog({
        defaultName: `申报日历清单-${rangeLabel}-${exportedOn}.${format}`,
        extensions: [format],
      });
      if (!path) return;
      if (format === "csv") {
        await platform().writeText(path, filingChecklistCSV(rows, exportedOn));
      } else {
        const { writeFilingChecklistPDF } = await import("../services/filingChecklistPDF");
        await platform().writeBytes(path, await writeFilingChecklistPDF({ rangeLabel, exportedOn, rows }));
      }
      store.showToast(`已导出 ${list.length} 件申报事项${overdue ? `，其中 ${overdue} 件已逾期` : ""}。`, () => void platform().reveal(path), "显示文件", overdue ? "overdue" : "success");
    } catch (e) { store.setError(`导出失败：${(e instanceof Error ? e.message : String(e))}`); }
  };

  const overdue = list.filter((o) => o.due < store.today).length;
  const [done, setDone] = useState<string[]>([]);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const playBurst = useRef<PlayBurst>(null);
  const tick = (o: Obligation, button: HTMLButtonElement) => {
    const sequence = completionQueue.current.schedule(o.key, (pendingSequence) => {
      setLeaving((current) => { const next = new Set(current); next.delete(o.key); return next; });
      finish(o, undefined, pendingSequence);
      setDone((d) => [...d, o.key]);
    });
    if (sequence === null) return;
    setLeaving((current) => new Set(current).add(o.key));
    playBurst.current?.(button, sequence);
  };
  const undoCompletion = () => {
    if (!completion) return;
    const { key, undo } = completion;
    completionTimer.current.cancel();
    setCompletion(null);
    undo();
    setDone((keys) => keys.filter((item) => item !== key));
    setDrawer(false);
    store.showToast("已撤销，事项已回到申报日历。");
    router.set("selectedObligationKey", key);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.req-main[data-key="${CSS.escape(key)}"]`)?.focus()));
  };
  const tone = overdue ? "bad" : soon ? "warn" : "ok";
  return (
    <div className="page due-page"><div className="page-inner due-page-inner" ref={pageRef} data-drawer-layout={narrow || undefined}>
      <BurstLayer ref={playBurst} scrollArea={listRef} />
      <PageHeader title="申报日历" subtitle={`全部公司 · 到期前 ${store.data.settings.reminderDays.join(" / ")} 天提醒`}>
        <Button icon="bell" onClick={() => router.openSettings("reminders")}>提醒设置</Button>
        <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" showsChevron={false} entries={[
          header(`当前清单 · ${rangeLabels[range]}`),
          item("导出清单 PDF…", "doc.text", () => void exportList("pdf")),
          item("导出清单 CSV（Excel 可打开）…", "tablecells", () => void exportList("csv")),
          divider,
          header(`含逾期及未来 ${CALENDAR_SUBSCRIPTION_DAYS} 天内的未完成申报`),
          item("生成申报日历订阅文件（.ics）", "calendar.badge.plus", () => void subscribe()),
        ]} />
      </PageHeader>
      {overdue || soon ? <Banner tone={tone} icon={overdue ? "calendar.badge.clock" : "clock"} title={overdue ? `${overdue} 件已逾期` : `30 天内有 ${soon} 件`}>
        {overdue ? "先联系中介处理逾期的事项，再看快到期的。" : "按日期一件件来，做完点右边的圆圈打勾。"}
      </Banner> : <span className="t-meta muted" style={{ padding: "2px 2px 6px" }}>{list.length ? <>30 天内没有到期事项。接下来 <TweenNumber value={list.length} /> 件都在 30 天以后。</> : "这段时间没有要申报的事。"}</span>}
      <Tabs<Range> value={range} onChange={setRange} tabs={[[90, rangeLabels[90]], [365, rangeLabels[365]], [0, rangeLabels[0]]]} />
      {!list.length ? (
        <Card><div className="celebrate"><span className="emblem"><Icon name="checkmark" size={30} strokeWidth={3} /></span><div className="t-headline">{done.length ? "全部完成！" : "这段时间没有申报事项"}</div><p className="muted">事项按公司的法域和成立日期自动排出。新建公司后这里会出现它的年审。</p></div></Card>
      ) : (
        <div className="two due-layout">
          <Card flush className="tour-due due-list-pane">
            <div ref={listRef} className="due-list-scroll" role="list" aria-label="申报事项">
              {months.map((m) => (
                <div key={m.label}>
                  <div className="tl-month"><span>{m.label}</span><span className="row gap10"><span className="num">{m.items.length} 件</span>{m === months[0] && <span className="muted" style={{ fontWeight: 500 }}>做完点右边的圆圈</span>}</span></div>
                  {m.items.map((o) => {
                    const on = o.key === sel?.key, left = D.daysBetween(store.today, o.due), party = store.responsibleParty(o);
                    return (
                      // 5.4：行本身不再是按钮；选中用 aria-current 标在行内的按钮上，“标为已完成”是并列的独立控件
                      <div key={o.key} data-mid={o.key} role="listitem" className={`req ${leaving.has(o.key) ? "leaving" : ""}`} data-on={on || undefined}>
                        <button type="button" className="req-main" aria-current={on ? "true" : undefined} data-key={o.key}
                          onClick={() => { router.set("selectedObligationKey", o.key); if (narrow) setDrawer(true); }}>
                        <span className="date col"><span>{D.short(o.due)}</span><span className="t-meta muted" style={{ fontWeight: 600 }}>{D.weekdayName(o.due).replace("星期", "周")}</span></span>
                        <span className="col" style={{ minWidth: 0 }}>
                          <span className="title ellipsis" style={{ fontWeight: 700 }}>{o.rule.name}</span>
                          <span className="row gap6 t-meta muted" style={{ minWidth: 0 }}><span className="v4-code" style={{ width: 22, height: 18, borderRadius: 5, fontSize: 9, ...companyTint(store, o.company.id) }}>{o.company.jurisdiction}</span><span className="ellipsis">{o.company.name}{party ? " · " + party.name : " · 未指定中介"}</span></span>
                        </span>
                        <FilingDeadlinePill days={left} />
                        </button>
                        <button className="check" role="checkbox" aria-checked={leaving.has(o.key)} aria-label={`标为已完成：${o.rule.name}`} title="标为已完成"
                          onClick={(e) => { e.stopPropagation(); tick(o, e.currentTarget); }}>
                          <Icon name="checkmark" size={14} strokeWidth={3.5} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
          {sel && !narrow && <div className="detail-pane"><DueDetail key={sel.key} o={sel} onFinish={finish} /></div>}
          {sel && narrow && drawer && <DueDrawer onClose={() => { setDrawer(false); requestAnimationFrame(() => document.querySelector<HTMLElement>(`.req-main[data-key="${CSS.escape(sel.key)}"]`)?.focus()); }}><DueDetail key={sel.key} o={sel} onFinish={(o2, r) => { setDrawer(false); finish(o2, r); }} /></DueDrawer>}
        </div>
      )}
      <div className="two due-feedback-layer">
        <div className="due-feedback">
          {feedback}
          {completion && <div className="due-undo no-drag"
            onMouseEnter={() => completionTimer.current.pause("pointer")} onMouseLeave={() => completionTimer.current.resume("pointer")}
            onFocusCapture={() => completionTimer.current.pause("focus")}
            onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) completionTimer.current.resume("focus"); }}>
            <span className="dot"><Icon name="checkmark" size={13} strokeWidth={3.5} /></span>
            <span className="due-undo-message" role="status" aria-live="polite">{completion.text}</span>
            <button type="button" className="no-drag" onClick={undoCompletion}>撤销</button>
          </div>}
        </div>
      </div>
    </div></div>
  );
}

function scrollBurstViewport(layer: HTMLElement, list: HTMLElement) {
  layer.style.setProperty("--burst-scroll-x", `${-list.scrollLeft}px`);
  layer.style.setProperty("--burst-scroll-y", `${-list.scrollTop}px`);
}

function positionBurstViewport(layer: HTMLElement, list: HTMLElement) {
  const box = list.getBoundingClientRect();
  const page = layer.parentElement!.getBoundingClientRect();
  const x = box.left + list.clientLeft, y = box.top + list.clientTop;
  Object.assign(layer.style, { left: `${x - page.left}px`, top: `${y - page.top}px`, width: `${list.clientWidth}px`, height: `${list.clientHeight}px` });
  scrollBurstViewport(layer, list);
  return { x, y };
}

/** 彩点存储列表内容坐标，随滚动自然移出视区。最后一个事项提交时，独立的层仍能播放完毕。 */
const BurstLayer = forwardRef<PlayBurst, { scrollArea: RefObject<HTMLDivElement> }>(function BurstLayer({ scrollArea }, ref) {
  const layer = useRef<HTMLDivElement>(null);
  const [bursts, setBursts] = useState<BurstOrigin[]>([]);
  useImperativeHandle(ref, () => (button, id) => {
    const list = scrollArea.current;
    if (reducedMotion() || !layer.current || !list) return;
    const box = button.getBoundingClientRect();
    const viewport = positionBurstViewport(layer.current, list);
    const origin = { id, x: box.left + box.width / 2 - viewport.x + list.scrollLeft, y: box.top + box.height / 2 - viewport.y + list.scrollTop };
    setBursts((active) => [...active, origin]);
  }, [scrollArea]);
  const playing = bursts.length > 0;
  useEffect(() => {
    if (!playing) return;
    const list = scrollArea.current, viewport = layer.current;
    if (!list || !viewport) return;
    const onScroll = () => scrollBurstViewport(viewport, list);
    const resize = new ResizeObserver(() => { if (list.isConnected) positionBurstViewport(viewport, list); });
    resize.observe(list);
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => { list.removeEventListener("scroll", onScroll); resize.disconnect(); };
  }, [playing, scrollArea]);
  return <div className="due-burst-layer" ref={layer} aria-hidden>
    {bursts.map((origin) => <Burst key={origin.id} origin={origin}
      onEnd={() => setBursts((active) => active.filter((burst) => burst.id !== origin.id))} />)}
  </div>;
});

function Burst({ origin, onEnd }: { origin: BurstOrigin; onEnd: () => void }) {
  const colors = ["var(--green)", "var(--amber)", "var(--blue-text)", "var(--purple-text)", "var(--red)"];
  return <span className="burst" style={{ left: origin.x, top: origin.y }}
    onAnimationEnd={(event) => { if (event.target === event.currentTarget) onEnd(); }}>{Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2, r = 22 + (i % 3) * 6;
    return <i key={i} style={{ background: colors[i % colors.length], "--x": `${Math.cos(a) * r}px`, "--y": `${Math.sin(a) * r}px` } as CSSProperties} />;
  })}</span>;
}

function DueDetail({ o, onFinish }: { o: Obligation; onFinish: (o: Obligation, receipt?: Document) => void }) {
  const { store, router } = useApp();
  const party = store.responsibleParty(o);
  const contacts = party ? contactsOf(party) : [];
  const own = !!party && party.id !== o.company.defaultPartyID;
  const to = contacts[0];
  const hello = to ? (/[A-Za-z]/.test(to.name) ? `Hi ${to.name.split(" ")[0]},` : `${to.name}，您好：`) : "您好：";
  const defaultMail = `主题：${o.company.name} ${o.rule.name}\n\n${hello}\n\n${o.company.name} 的${o.rule.name}将于 ${D.long(o.due)} 截止。麻烦确认所需材料和时间安排，谢谢。`;
  const [edit, setEdit] = useState<{ text: string; basedOn: string } | null>(null);
  const mail = edit?.text ?? defaultMail;
  const needsReview = !!edit && edit.basedOn !== defaultMail;
  const parties = [...store.data.parties].sort((a, b) => a.name.localeCompare(b.name));
  const [startStage, stageNode] = useStageFile();
  const left = D.daysBetween(store.today, o.due);
  return (
    <section className="card due-detail" aria-label="事项详情">
      <div className="col gap6 due-detail-head appear">
        <button className="t-label ellipsis" style={{ textAlign: "left", maxWidth: "100%" }} onClick={() => router.openCompany(o.company.id)}>{store.jurisdictionName(o.company.jurisdiction)} · {o.company.name}</button>
        <div className="t-title">{o.rule.name}</div>
        <div className="muted t-meta">{D.long(o.due)}截止 · {leftText(D.daysBetween(store.today, o.due))}{o.rule.localName ? " · " + o.rule.localName : ""}</div>
      </div>
      <div className="due-detail-scroll">
        <div className="row gap10 wrap" style={{ padding: "12px 14px", borderRadius: "var(--r-control)", background: "var(--surface-sunken)" }}>
          <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
            <span className="row gap6" style={{ fontWeight: 600 }}><Icon name={o.record?.dateConfirmed ? "checkmark.circle" : "info.circle"} size={13} />{o.record?.dateConfirmed ? "日期已确认" : "日期按规则推算"}</span>
            <span className="t-meta muted">{o.record?.dateConfirmed ? "可随时改。" : `${store.scheduleText(o.rule.schedule)}。和中介核对后确认或修改。`}</span>
          </span>
          <DateField value={o.due} onChange={(d) => d && store.confirmDue(o, d)} ariaLabel="申报截止日" allowsClear={false} minWidth={150} />
          {!o.record?.dateConfirmed && <Button size="small" onClick={() => store.confirmDue(o)}>确认</Button>}
        </div>
        <div className="col gap10" style={{ padding: 14, borderRadius: "var(--r-control)", background: "var(--surface-sunken)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="v4-label">找谁办</span>
            {own ? <PickChip label="此事项单独指定" title="点按改回公司默认中介" width={220}>{(close) => <>
              <PopoverRow title={`改回公司默认中介${store.party(o.company.defaultPartyID) ? `（${store.party(o.company.defaultPartyID)!.name}）` : ""}`} icon="arrow.uturn.backward" onClick={() => { close(); store.resetObligationParty(o); }} />
            </>}</PickChip> : <span className="v4-label">公司默认中介</span>}
          </div>
          <SelectField<string> minWidth={200} placeholder="选择中介" value={party?.id ?? ""} options={parties.map((p) => [p.id, p.name] as [string, string])}
            onChange={(id) => { store.setObligationParty(o, id); store.showToast("已为这一项指定中介，公司默认中介不变。"); }} />
          {contacts.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="ellipsis"><b style={{ fontWeight: 600 }}>{c.name}</b>{c.role ? " · " + c.role : ""}</span>
              <button className="link t-meta muted" title="复制邮箱" onClick={() => { void platform().copyText(c.email); store.showToast("邮箱已复制。"); }}>{c.email}</button>
            </div>
          ))}
          {party && !contacts.length && <button className="link t-meta" style={{ textAlign: "left" }} onClick={() => router.openAgent(party.id)}>这家中介还没有对接人，去添加…</button>}
          {party && (() => { const all = store.openForParty(party.id).filter((x) => x.key !== o.key); const late = all.filter((x) => x.due < store.today).length;
            return all.length > 0 && <button className="row gap8 agent-load" onClick={() => router.openAgent(party.id)} title="打开这家中介">
              <b className="t-figure" style={{ fontSize: 23 }}>{all.length}</b><span className="t-meta">这家中介手上还有 {all.length} 件{late ? `，其中 ${late} 件已逾期` : ""}，可以一封邮件一起问</span></button>; })()}
        </div>
        <div className="col gap6">
          <span className="v4-label">邮件草稿（可改）</span>
          <TextField multiline rows={7} ariaLabel="邮件草稿" value={mail} onChange={(text) => setEdit(text === defaultMail ? null : { text, basedOn: defaultMail })} />
          {needsReview && <span role="status" className="t-meta amber-text">已保留你编辑的草稿。请核对截止日（{D.long(o.due)}）和收件人。</span>}
        </div>
      </div>
      <div className="row gap8 due-detail-actions">
        <Button kind="primary" style={{ flex: 1 }} icon="doc.on.doc" onClick={() => {
          void platform().copyText(mail);
          store.showToast(needsReview ? `已复制手工草稿，请核对截止日（${D.long(o.due)}）和收件人。` : to ? `已复制，粘贴到邮箱发给 ${to.name}。` : "邮件已复制。");
        }}>复制邮件</Button>
        <ActionMenu title="标为已完成" icon="checkmark" align="end" entries={[
          item("标为已完成", "checkmark", () => onFinish(o)),
          item("附上回执并完成…", "paperclip", () => void startStage({ typeID: "common.receipt", owner: { kind: "company", id: o.company.id }, onArchived: (d) => onFinish(o, d) })),
        ]} />
        {stageNode}
      </div>
    </section>
  );
}

/** 侧栏自动收起的窄窗口，或放大后放不下两栏的内容区，点事项打开抽屉。 */
function useCalendarDrawerLayout(ref: React.RefObject<HTMLElement>) {
  const [narrow, setNarrow] = useState(isNarrowWindow);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setNarrow(isNarrowWindow() || entry.contentRect.width < 720);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

/** 右侧抽屉：打开时聚焦关闭入口，Esc 或点遮罩关闭，焦点回到原来的行。 */
function DueDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useFocusReturn(box);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    closeButton.current?.focus();
    // 5.4.1：抽屉里打开的对话框（.overlay）或弹层在上面时，Esc 先关它们
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".popover:not(.ghost-out), .overlay:not(.ghost-out)")) { e.stopPropagation(); closeRef.current(); return; }
    };
    document.addEventListener("keydown", key, true); return () => document.removeEventListener("keydown", key, true);
  }, []);
  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="drawer" role="dialog" aria-modal="true" aria-label="申报事项详情" tabIndex={-1}>
        <div className="row due-drawer-header"><h2 className="t-sheet">申报事项详情</h2><button ref={closeButton} type="button" className="icon-btn sunken due-drawer-close" aria-label="关闭申报事项详情" title="关闭" onClick={onClose}><Icon name="xmark" size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}
