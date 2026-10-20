// 4.4 可点标签：显示一个可修改属性的标签，点它就地弹出选择（DESIGN.md §8）。

import { useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/hooks";
import { type Company, companyStatusLabel, companyStatuses } from "../domain/models";
import { Popover, PopoverRow } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { isSoft, softBg, softInk } from "../ui/uistyle";

/** 通用：标签 + 气泡。 */
export function PickChip({ label, title, children, className = "", style, width = 240 }: {
  label: ReactNode; title: string; children: (close: () => void) => ReactNode; className?: string; style?: React.CSSProperties; width?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} className={`v4-chip btnlike pick-chip ${className}`} style={style} title={title} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {label}<Icon name="chevron.down" size={8} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        <div className="col" style={{ minWidth: width, padding: 4, maxHeight: 380, overflow: "auto" }}>{children(() => setOpen(false))}</div>
      </Popover>
    </>
  );
}

/** 公司的法域、实体类型、集团、状态四个标签（公司页头、信息卡、结构图详情共用）。 */
export function CompanyChips({ c, chipClass = "" }: { c: Company; chipClass?: string }) {
  const { store, router } = useApp();
  const soft = isSoft();
  const groups = [...store.data.groups].sort((a, b) => a.name.localeCompare(b.name));
  const mine = store.groupsContaining(c.id);
  const forms = store.jurisdiction(c.jurisdiction)?.entityForms ?? [];
  const groupLabel = mine.length
    ? mine.map((g) => g.name).join("、")
    : "不属于集团";
  const g0 = mine[0];
  return (
    <>
      <PickChip className={chipClass} label={store.jurisdictionName(c.jurisdiction)} title="点按修改法域" width={220}>
        {(close) => store.data.library.jurisdictions.map((j) => <PopoverRow key={j.code} title={`${j.code} ${j.name}`} checked={j.code === c.jurisdiction}
          onClick={() => { close(); if (j.code !== c.jurisdiction) store.editCompanyField(c, "jurisdiction", j.code, "法域"); }} />)}
      </PickChip>
      <PickChip className={chipClass} label={c.entityForm || "实体类型未填"} title="点按修改实体类型" style={c.entityForm ? undefined : { color: "var(--muted)" }}>
        {(close) => forms.length ? forms.map((f) => <PopoverRow key={f} title={f} checked={f === c.entityForm} onClick={() => { close(); store.editCompanyField(c, "entityForm", f, "实体类型"); }} />)
          : <span className="t-meta muted" style={{ padding: 10 }}>这个法域还没有实体类型清单，可在设置 → 档案清单里添加。</span>}
      </PickChip>
      <PickChip className={chipClass} title="点按修改集团归属" width={250}
        style={soft && g0 ? { background: softBg(store.brandColor(g0)), color: softInk(store.brandColor(g0)) } : mine.length ? undefined : { color: "var(--muted)" }}
        label={<>{!soft && mine.map((g) => <span key={g.id} className="v4-dot" style={{ background: store.brandColor(g) }} />)}{groupLabel}</>}>
        {(close) => <>
          <span className="t-meta muted" style={{ padding: "6px 10px 4px" }}>归属集团（可多选）</span>
          {groups.map((g) => <PopoverRow key={g.id} title={g.name} checked={mine.some((x) => x.id === g.id)} onClick={() => { close(); store.toggleCompanyGroup(c.id, g.id); }} />)}
          <PopoverRow title="不属于任何集团" checked={!mine.length} onClick={() => { close(); store.toggleCompanyGroup(c.id, null); }} />
          <div className="hairline" style={{ margin: "4px 6px" }} />
          <PopoverRow title="新建集团…" icon="plus" onClick={() => { close(); router.openSettings("groups", "new"); }} />
          {g0 && <PopoverRow title={`编辑“${g0.name}”…`} icon="pencil" onClick={() => { close(); router.openSettings("groups", g0.id); }} />}
        </>}
      </PickChip>
      <PickChip className={`${chipClass} ${c.status !== "active" ? "warn" : ""}`} label={companyStatusLabel[c.status]} title="点按修改状态" width={180}>
        {(close) => companyStatuses.map((st) => <PopoverRow key={st} title={companyStatusLabel[st]} checked={st === c.status} onClick={() => { close(); store.editCompanyField(c, "status", st, "公司状态"); }} />)}
      </PickChip>
    </>
  );
}
