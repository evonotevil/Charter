// Charter 4 到期：按日期排的事项 + 右侧详情（找谁办、对接人、邮件草稿、标为已完成）。

import { companyTint } from "../ui/uistyle";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/hooks";
import * as D from "../domain/day";
import { type Obligation, obligationStatus } from "../domain/engine";
import { contactsOf } from "../domain/models";
import { platform } from "../platform/platform";
import { writeCalendarFile } from "../services/packets";
import { ActionMenu, Button, DateField, EmptyStateView, PageHeader, PopoverRow, SelectField, divider, item } from "../ui/kit";
import { PickChip } from "./PropChips";
import { writePDF } from "../services/files";
import { useStageFile } from "./common";
import { leftText } from "./InfoCard";
import { Icon } from "../ui/Icon";
import { SlideBg, useChildMotion, useTweenNumber } from "../ui/motion";
import type { Document } from "../domain/models";

type Range = 90 | 365 | 0;

export function DueView() {
  const { store, router } = useApp();
  const [range, setRange] = useState<Range>(365);
  const list = useMemo(() => store.openObligations
    .filter((o) => !range || D.daysBetween(store.today, o.due) <= range)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.company.name.localeCompare(b.company.name))), [store.data, range, store.today]);
  const sel = list.find((o) => o.key === router.selectedObligationKey) ?? store.openObligations.find((o) => o.key === router.selectedObligationKey) ?? list[0];
  const soon = list.filter((o) => D.daysBetween(store.today, o.due) <= 30).length;
  const shownCount = useTweenNumber(list.length);
  // #14 完成：这一行先打勾（lime），280ms 后淡出，再真正完成；件数随后递减。
  const [finishing, setFinishing] = useState<string | null>(null);
  // 4.5：数据立即完成，不等动画；被移走的行由 useChildMotion 原地淡出（可被下一次操作打断，不排队）。
  const finish = (o: Obligation, receipt?: Document) => { setFinishing(null); store.complete(o, receipt); };
  const listRef = useChildMotion<HTMLDivElement>(String(range));

  const months: { label: string; items: Obligation[] }[] = [];
  for (const o of list) {
    const label = D.year(o.due) === D.year(store.today) ? `${D.month(o.due)}月` : `${D.year(o.due)}年${D.month(o.due)}月`;
    if (months[months.length - 1]?.label !== label) months.push({ label, items: [] });
    months[months.length - 1].items.push(o);
  }

  const subscribe = () => void writeCalendarFile(store).then(async (path) => {
    await platform().reveal(path);
    store.showToast("已显示日历文件。用日历应用打开它即可订阅，事项变化时 Charter 会自动更新。");
  }).catch((e) => store.showToast(`无法写入日历文件：${(e instanceof Error ? e.message : String(e))}`, undefined, "", "failure"));

  const exportList = async (csv: boolean) => {
    const title = `到期事项清单 ${store.today}`;
    const path = await platform().saveDialog({ defaultName: title + (csv ? ".csv" : ".pdf"), extensions: [csv ? "csv" : "pdf"] });
    if (!path) return;
    try {
      if (csv) {
        const q = (x: string) => `"${x.replace(/"/g, '""')}"`;
        const rows = ["截止日,公司,法域,事项,中介,日期", ...list.map((o) => [o.due, o.company.name, store.jurisdictionName(o.company.jurisdiction), o.rule.name, store.responsibleParty(o)?.name ?? "", o.record?.dateConfirmed ? "已确认" : "推算"].map(q).join(","))];
        await platform().writeText(path, "\ufeff" + rows.join("\r\n"));
      } else {
        const sections = months.map((m) => ({ heading: `${m.label}（${m.items.length} 件）`, alert: false,
          lines: m.items.map((o) => `${D.short(o.due)}　${o.company.name}　${o.rule.name}　${store.responsibleParty(o)?.name ?? "未指定中介"}${o.due < store.today ? "　〔已逾期〕" : ""}${o.record?.dateConfirmed ? "" : "　〔日期为推算〕"}`) }));
        await platform().writeBytes(path, await writePDF("到期事项清单", `共 ${list.length} 件，${D.long(store.today)}导出`, sections, "标注“日期为推算”的按规则算出，尚未确认。"));
      }
      store.showToast(`已导出 ${list.length} 件事项。`, () => void platform().reveal(path), "在访达中显示");
    } catch (e) { store.setError(`导出失败：${(e instanceof Error ? e.message : String(e))}`); }
  };

  return (
    <div className="col grow" style={{ minHeight: 0, padding: "0 var(--page-edge)" }}>
      <PageHeader title="到期" scope={`${range === 90 ? "90 天内" : range ? "一年内" : "全部未完成"} · 全部公司`} stats={[
        { label: "已逾期", value: list.filter((o) => o.due < store.today).length, unit: "件", tone: list.some((o) => o.due < store.today) ? "bad" : undefined },
        { label: "30 天内", value: soon, unit: "件", tone: soon ? "warn" : undefined },
        { label: range === 90 ? "90 天内共" : range ? "一年内共" : "全部", value: list.length, unit: "件", tone: "accent" },
      ]} subtitle={`${shownCount} 项${range ? `在${range === 90 ? " 90 天" : "一年"}内` : ""}到期${soon ? `，其中 ${soon} 项在 30 天内` : ""} · 到期前 ${store.data.settings.reminderDays.join(" / ")} 天提醒`}>
        <div className="v4-pills slide-host">
          <SlideBg />
          {([[90, "90 天"], [365, "一年"], [0, "全部"]] as [Range, string][]).map(([v, t]) => <button key={v} className={range === v ? "on" : ""} onClick={() => setRange(v)}>{t}</button>)}
        </div>
        <ActionMenu icon="ellipsis" ariaLabel="更多" align="end" showsChevron={false} entries={[
          item("订阅到日历…", "calendar.badge.plus", subscribe),
          divider,
          item("导出清单 PDF…", "doc.text", () => void exportList(false)),
          item("导出清单 CSV（Excel 可打开）…", "tablecells", () => void exportList(true)),
        ]} />
      </PageHeader>
      {!list.length ? (
        <EmptyStateView symbol="calendar.badge.clock" title="这段时间没有到期事项" message="事项按公司的法域和成立日期自动排出。新建公司后这里会出现它的年审。" />
      ) : (
        <div className="row grow" style={{ minHeight: 0, gap: 16, alignItems: "stretch", padding: "16px 0 24px" }}>
          <div ref={listRef} className="surface scroll grow due-list" style={{ padding: 8, minWidth: 0, position: "relative" }}>
            {months.map((m) => (
              <div key={m.label}>
                <div className="v4-label" style={{ padding: "12px 14px 6px" }}>{m.label}</div>
                {m.items.map((o) => {
                  const on = o.key === sel?.key, left = D.daysBetween(store.today, o.due), party = store.responsibleParty(o);
                  return (
                    <button key={o.key} data-mid={o.key} className={`v4-item due-row ${on ? "on" : ""} ${finishing === o.key ? "finishing" : ""}`} onClick={() => router.set("selectedObligationKey", o.key)}>
                      <span className="col" style={{ width: 40, alignItems: "center" }}>
                        <span className="num" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{String(D.dayOf(o.due)).padStart(2, "0")}</span>
                        <span style={{ fontSize: 11, opacity: 0.65 }}>{D.weekdayName(o.due).replace("星期", "周")}</span>
                      </span>
                      <span className="v4-code" style={finishing === o.key ? undefined : companyTint(store, o.company.id)}>{finishing === o.key ? <Icon name="checkmark" size={12} strokeWidth={3} /> : o.company.jurisdiction}</span>
                      <span className="col grow" style={{ minWidth: 0 }}>
                        <span className="ellipsis" style={{ fontWeight: 600 }}>{o.rule.name}</span>
                        <span className="ellipsis" style={{ fontSize: 12.5, opacity: 0.65 }}>{o.company.name}{party ? " · " + party.name : " · 未指定中介"}</span>
                      </span>
                      <span className={`v4-chip ${left < 0 ? "bad" : left <= 30 ? "warn" : ""}`}>{leftText(left)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {sel && <DueDetail o={sel} onFinish={finish} />}
        </div>
      )}
    </div>
  );
}

function DueDetail({ o, onFinish }: { o: Obligation; onFinish: (o: Obligation, receipt?: Document) => void }) {
  const { store, router } = useApp();
  const party = store.responsibleParty(o);
  const contacts = party ? contactsOf(party) : [];
  const own = !!party && party.id !== o.company.defaultPartyID;
  const defaultMail = () => {
    const to = contacts[0];
    const hello = to ? (/[A-Za-z]/.test(to.name) ? `Hi ${to.name.split(" ")[0]},` : `${to.name}，您好：`) : "您好：";
    return `主题：${o.company.name} ${o.rule.name}\n\n${hello}\n\n${o.company.name} 的${o.rule.name}将于 ${D.long(o.due)} 截止。麻烦确认所需材料和时间安排，谢谢。`;
  };
  const [mail, setMail] = useState(defaultMail);
  useEffect(() => setMail(defaultMail()), [o.key, party?.id]);
  const parties = [...store.data.parties].sort((a, b) => a.name.localeCompare(b.name));
  const [startStage, stageNode] = useStageFile();
  const left = D.daysBetween(store.today, o.due);
  return (
    <section className="surface col appear" aria-label="事项详情" style={{ width: 440, flex: "none", padding: 24, gap: 16 }} key={o.key}>
      <div className="col gap6">
        <button className="v4-label link" style={{ textAlign: "left" }} onClick={() => router.openCompany(o.company.id)}>{store.jurisdictionName(o.company.jurisdiction)} · {o.company.name}</button>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>{o.rule.name}</div>
        <div className="muted t-meta">{D.long(o.due)}截止 · {leftText(D.daysBetween(store.today, o.due))}{o.rule.localName ? " · " + o.rule.localName : ""}</div>
      </div>
      <div className="row gap10" style={{ padding: "12px 16px", borderRadius: 16, background: o.record?.dateConfirmed ? "var(--band)" : "var(--amber-soft)" }}>
        <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{o.record?.dateConfirmed ? "日期已确认" : "日期按规则推算"}</span>
          <span className="t-meta muted">{o.record?.dateConfirmed ? "可随时改。" : `${store.scheduleText(o.rule.schedule)}。和中介核对后确认或修改。`}</span>
        </span>
        <DateField value={o.due} onChange={(d) => d && store.confirmDue(o, d)} allowsClear={false} minWidth={150} />
        {!o.record?.dateConfirmed && <Button size="small" onClick={() => store.confirmDue(o)}>确认</Button>}
      </div>
      <div className="col gap10" style={{ padding: 16, borderRadius: 16, background: "var(--band)" }}>
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
            <span className="big-num">{all.length}</span><span className="t-meta">这家中介手上还有 {all.length} 件{late ? `，其中 ${late} 件已逾期` : ""}，可以一封邮件一起问</span></button>; })()}
      </div>
      <div className="col grow gap6" style={{ minHeight: 120 }}>
        <span className="v4-label">邮件草稿（可改）</span>
        <textarea className="v4-mail grow" value={mail} onChange={(e) => setMail(e.target.value)} aria-label="邮件草稿" />
      </div>
      <div className="row gap8">
        <Button kind="primary" style={{ flex: 1 }} icon="doc.on.doc" onClick={() => {
          void platform().copyText(mail);
          store.showToast(contacts[0] ? `已复制，粘贴到邮箱发给 ${contacts[0].name}。` : "邮件已复制。");
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
