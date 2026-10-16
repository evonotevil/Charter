// 人员：任职、直接持股、代持、穿透后持有；新建、编辑、合并、删除。移植自 PeopleView.swift。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { type Appointment, type Person, isActiveOn, newPerson, ref, sameRef } from "../domain/models";
import { percentLabel, portfolio } from "../domain/engine";
import { useApp } from "../state/hooks";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Avatar, Button, CountBadge, EmptyStateView, FieldRow, FormGroup, JurisdictionBadge, ListField, Modal, Pill, SelectField, SheetScaffold, TextField } from "../ui/kit";
import { ChangeRowMenu } from "./Companies";

export function PeopleView() {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const list = store.data.people.filter((p) => !q || [p.name, ...p.aliases].join(" ").toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const firstRequest = useRef(router.newPersonRequest);
  useEffect(() => { if (!router.selectedPersonID && list[0]) router.set("selectedPersonID", list[0].id); }, []);
  useEffect(() => { if (router.newPersonRequest !== firstRequest.current) { firstRequest.current = router.newPersonRequest; setCreating(true); } }, [router.newPersonRequest]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); return; }
      if (router.sheet || router.settings || (e.target as HTMLElement)?.closest("input, textarea")) return;
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || !list.length) return;
      e.preventDefault();
      const cur = list.findIndex((p) => p.id === router.selectedPersonID);
      const start = cur < 0 ? (e.key === "ArrowDown" ? -1 : list.length) : cur;
      router.set("selectedPersonID", list[Math.min(Math.max(start + (e.key === "ArrowDown" ? 1 : -1), 0), list.length - 1)].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const selected = store.person(router.selectedPersonID);
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="row" style={{ padding: "24px var(--page-edge)" }}>
        <h1 className="t-page">人员</h1><span className="spacer" />
        <Button kind="primary" icon="plus" onClick={() => setCreating(true)}>新建人员</Button>
      </div>
      <div className="row grow" style={{ alignItems: "stretch", minHeight: 0 }}>
        <div className="col surface" style={{ width: 300, flex: "none", padding: 12, gap: 8, margin: "0 0 var(--page-edge) var(--page-edge)", minHeight: 0 }}>
          <label className="row gap8" style={{ height: 38, padding: "0 14px", borderRadius: 999, background: "var(--band)", flex: "none" }} title="搜索人员（Ctrl/⌘ F）">
            <Icon name="magnifyingglass" className="muted" />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名或别名" className="grow" style={{ border: 0, outline: "none", background: "transparent", font: "inherit", color: "inherit", minWidth: 0 }} />
            {query && <button className="muted" aria-label="清除" onClick={() => setQuery("")}><Icon name="xmark.circle.fill" /></button>}
          </label>
          <div className="scroll grow col" style={{ gap: 2, paddingTop: 4, minHeight: 0 }}>
            {list.map((p) => <PersonRow key={p.id} p={p} />)}
            {!list.length && <span className="t-body muted" style={{ padding: 16, textAlign: "center" }}>{q ? `没有找到“${query}”` : "还没有人员"}</span>}
          </div>
        </div>
        <div className="col grow" style={{ minWidth: 480, minHeight: 0 }}>
          {selected ? <PersonDetail key={selected.id} person={selected} /> : (
            <div className="surface col grow" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px", justifyContent: "center" }}>
              <EmptyStateView symbol="person.crop.rectangle.stack" title="选择人员" message="查看此人的任职、直接与间接持股，以及代持情况。" />
            </div>
          )}
        </div>
      </div>
      {creating && <NewPersonSheet onClose={() => setCreating(false)} onCreate={(p) => router.set("selectedPersonID", p.id)} />}
    </div>
  );
}

function PersonRow({ p }: { p: Person }) {
  const { store, router } = useApp();
  const on = router.selectedPersonID === p.id;
  const r = ref("person", p.id);
  const roles = new Set(store.data.appointments.filter((a) => a.personID === p.id && isActiveOn(a, store.today)).map((a) => a.companyID)).size;
  const held = store.data.holdings.filter((h) => sameRef(h.holder, r) && isActiveOn(h, store.today));
  const caption = [roles ? `任职 ${roles} 家` : null, held.length ? `持股 ${held.length} 家` : null, held.some((h) => h.isNominee) ? "名义股东" : null].filter(Boolean).join("，");
  const anchor = store.anchorCompanyName(p.id);
  return (
    <button className={`row gap10 ${on ? "" : "hover-band"}`} onClick={() => router.set("selectedPersonID", p.id)} aria-current={on || undefined}
      style={{ height: 52, padding: "0 8px", borderRadius: "var(--r-row)", textAlign: "left", width: "100%", flex: "none", background: on ? "var(--selection)" : undefined, color: on ? "var(--on-selection)" : "var(--ink)" }}>
      <Avatar name={p.name} size={34} dashed={held.some((h) => h.isNominee)} highlighted={on} />
      <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="t-row ellipsis">{p.name}</span>
        <span className="ellipsis" style={{ fontSize: 12, opacity: .65 }}>{anchor ? `${caption ? caption + "，" : ""}${anchor}` : "未关联"}</span>
      </span>
    </button>
  );
}

function NewPersonSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Person) => void }) {
  const { store } = useApp();
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const t = name.trim();
  const dupes = store.possibleDuplicates(t);
  const create = () => {
    setAttempted(true);
    if (!t) return;
    const p = store.createPerson(t);
    onCreate(p);
    store.showToast(`已新建人员 ${p.name}`);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="新建人员" subtitle="先填姓名，任职和持股在公司档案里添加。" width={460} onSubmit={create}
        leading={dupes[0] && <Button onClick={() => { onCreate(dupes[0]); onClose(); }}>使用 {dupes[0].name}</Button>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={create}>{dupes.length ? "仍然新建" : "新建"}</Button></>}>
        <FormGroup>
          <FieldRow label="姓名" error={attempted && !t ? "请填写姓名" : null}
            hint={dupes.length ? `已有名字或别名一致的人员：${dupes.map((p) => store.personLabel(p)).join("；")}。如果是同一人，请直接使用；不同的人再新建。` : undefined}>
            <TextField value={name} onChange={setName} placeholder="例如：张三" autoFocus invalid={attempted && !t} />
          </FieldRow>
        </FormGroup>
      </SheetScaffold>
    </Modal>
  );
}

const titlesOf = (roles: Appointment[]) => [...new Set(roles.map((r) => r.title))].join("、");
const period = (from?: string, to?: string) => (from && to ? `${from} 至 ${to}` : from ? `${from} 起` : to ? `至 ${to}` : undefined);
const missingSentence = (names: string[]) => (names.length === 1 ? `没有${names[0]}。` : `没有${names.slice(0, -1).join("、")}和${names[names.length - 1]}。`);

function PersonDetail({ person }: { person: Person }) {
  const { store, router } = useApp();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const r = ref("person", person.id);
  const today = store.today;
  const current = store.data.appointments.filter((a) => a.personID === person.id && isActiveOn(a, today));
  const past = store.data.appointments.filter((a) => a.personID === person.id && !isActiveOn(a, today)).sort((a, b) => ((b.to ?? b.from ?? today) > (a.to ?? a.from ?? today) ? 1 : -1));
  const direct = store.data.holdings.filter((h) => sameRef(h.holder, r) && isActiveOn(h, today));
  const heldForMe = store.data.holdings.filter((h) => h.isNominee && sameRef(h.beneficialOwner, r) && isActiveOn(h, today));
  const owned = portfolio(r, store.data.companies, store.data.holdings, today);
  const byCompany = new Map<string, Appointment[]>();
  for (const a of current) byCompany.set(a.companyID, [...(byCompany.get(a.companyID) ?? []), a]);
  const companyIDs = [...byCompany.keys()].sort((a, b) => store.nameOf(ref("company", a)).localeCompare(store.nameOf(ref("company", b)), "zh"));
  const blockers = store.deletionBlockers(person.id);
  const missing = [companyIDs.length ? null : "现任职务", direct.length ? null : "直接持股", owned.length ? null : "穿透后持股", heldForMe.length ? null : "由他人代持记录", past.length ? null : "曾任职务"].filter(Boolean) as string[];
  const nominee = direct.some((h) => h.isNominee);
  const twins = [person.name, ...person.aliases].flatMap((n) => store.possibleDuplicates(n, person.id)).filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
  const fact = (label: string, n: number) => (
    <div className="col" style={{ gap: 6, padding: "16px 24px", minWidth: 140 }}>
      <span className="t-meta muted">{label}</span><span className="mono" style={{ fontSize: 15, fontWeight: 500, color: n ? "var(--ink)" : "var(--muted)" }}>{n ? `${n} 家` : "无"}</span>
    </div>
  );
  const section = (title: string, count: number, children: ReactNode) => (
    <div><div className="hairline" />
      <div className="col gap8" style={{ padding: "24px 24px 16px" }}>
        <div className="row"><span className="t-section">{title}</span><span className="spacer" /><CountBadge count={count} /></div>
        <div className="col">{children}</div>
      </div>
    </div>
  );
  const line = (id: string, trailing: string, detail?: string, warn = false, numeric = false, extra?: ReactNode) => (
    <div key={id + trailing + (detail ?? "")} className="row gap12">
      <button className="row gap10 hover-band grow" style={{ padding: "8px", margin: "0 -8px", borderRadius: "var(--r-row)", textAlign: "left", minWidth: 0 }} onClick={() => { router.companyTab = 0; router.openCompany(id); }}>
        <JurisdictionBadge code={store.company(id)?.jurisdiction ?? "?"} size={30} />
        <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 500 }}>{store.company(id)?.name ?? "未知公司"}</span>
          {detail && <span className="num" style={{ fontSize: 11.5, color: warn ? "var(--amber-text)" : "var(--muted)" }}>{detail}</span>}
        </span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, minWidth: numeric ? 64 : undefined, textAlign: "right" }}>{trailing}</span>
      </button>
      {extra}
    </div>
  );
  return (
    <div className="scroll grow">
      <div className="surface appear" style={{ margin: "0 var(--page-edge) var(--page-edge) 16px", maxWidth: 1000 }}>
        <div className="col gap16" style={{ padding: 24 }}>
          <div className="row gap16 wrap">
            <Avatar name={person.name} size={56} dashed={nominee} />
            <div className="col gap6 grow" style={{ minWidth: 200 }}>
              <span className="t-title selectable">{person.name}</span>
              {(person.aliases.length > 0 || nominee) && <div className="row gap6 wrap">{person.aliases.map((a) => <Pill key={a} text={a} />)}{nominee && <Pill text="名义股东" kind="warn" />}</div>}
              {person.notes && <span className="t-body muted">{person.notes}</span>}
            </div>
            <div className="row gap8">
              <Button kind="accent" onClick={() => { void platform().copyText(store.personSummary(person)); store.showToast("人员摘要已复制。"); }}>复制摘要</Button>
              <Button onClick={() => setEditing(true)}>编辑</Button>
              <Button title="把这个人合并到另一个人名下（重复录入时使用）" onClick={() => setMerging(true)}>合并…</Button>
              <Button disabled={!!blockers.length} title={blockers.length ? `不能删除：${blockers.join("，")}` : "删除这个人"}
                onClick={() => { const next = store.data.people.find((p) => p.id !== person.id)?.id ?? null; store.deletePerson(person.id); router.set("selectedPersonID", next); }}>删除</Button>
            </div>
          </div>
          {twins.length > 0 && <div className="row gap12 amber-text">
            <Icon name="person.2" /><span className="t-meta grow">可能与 {twins.map((p) => store.personLabel(p)).join("、")} 是同一人（名字或别名一致）。</span>
            <Button size="small" onClick={() => setMerging(true)}>合并…</Button>
          </div>}
          {blockers.length > 0 && <div className="row gap12">
            <span className="t-meta muted grow">不能删除：{blockers.join("，")}。可以先把记录合并到另一个人。</span>
            <Button kind="quiet" size="small" onClick={() => setMerging(true)}>合并到…</Button>
          </div>}
        </div>
        <div className="hairline" />
        <div className="row" style={{ alignItems: "stretch" }}>{fact("现任职务", companyIDs.length)}<span className="vrule" />{fact("直接持股", direct.length)}<span className="vrule" />{fact("穿透后持有", owned.length)}</div>
        {companyIDs.length > 0 && section("现任职务", companyIDs.length, companyIDs.map((cid) => {
          const roles = byCompany.get(cid)!;
          const from = roles.map((x) => x.from).filter(Boolean).sort()[0];
          return line(cid, titlesOf(roles), from ? `自 ${from}` : undefined, false, false, <ChangeRowMenu companyID={cid} appointmentID={roles[0].id} />);
        }))}
        {direct.length > 0 && section("直接持股", direct.length, direct.map((h) => line(h.companyID, percentLabel(h.percent),
          h.isNominee ? `名义股东，代${h.beneficialOwner ? store.nameOf(h.beneficialOwner) : "他人"}持有` : undefined, h.isNominee, true, <ChangeRowMenu companyID={h.companyID} holdingID={h.id} />)))}
        {owned.length > 0 && section("穿透后持有", owned.length, owned.map((x) => line(x.company.id, percentLabel(x.percent), x.viaNominee ? "含代持部分" : undefined, false, true)))}
        {heldForMe.length > 0 && section("由他人代持", heldForMe.length, heldForMe.map((h) => line(h.companyID, percentLabel(h.percent), `由 ${store.nameOf(h.holder)} 代为持有`, true, true)))}
        {past.length > 0 && section("曾任职务", past.length, past.map((a) => line(a.companyID, a.title, period(a.from, a.to))))}
        {missing.length > 0 && <><div className="hairline" /><div className="t-body muted" style={{ padding: "16px 24px" }}>{missingSentence(missing)}</div></>}
      </div>
      {editing && <EditPersonSheet person={person} onClose={() => setEditing(false)} />}
      {merging && <MergePersonSheet person={person} onClose={() => setMerging(false)} />}
    </div>
  );
}

function EditPersonSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const { store } = useApp();
  const [d, setD] = useState<Person>({ ...person });
  const name = d.name.trim();
  const save = () => { if (!name) return; store.upsertPerson({ ...d, name }); store.showToast(`已保存 ${name}`); onClose(); };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="编辑人员" subtitle="别名用于搜索，也能帮助区分同名的人。" width={520} onSubmit={save}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!name} onClick={save}>保存</Button></>}>
        <FormGroup>
          <FieldRow label="姓名" error={!name ? "姓名不能为空" : null}><TextField value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="姓名" invalid={!name} autoFocus /></FieldRow>
          <FieldRow label="别名" hint="多个别名用逗号分隔"><ListField values={d.aliases} onChange={(aliases) => setD({ ...d, aliases })} placeholder="例如：Zhang San" /></FieldRow>
          <FieldRow label="邮箱"><TextField value={d.email} onChange={(email) => setD({ ...d, email })} placeholder="可选" /></FieldRow>
          <FieldRow label="备注"><TextField multiline rows={2} value={d.notes} onChange={(notes) => setD({ ...d, notes })} placeholder="可选" /></FieldRow>
        </FormGroup>
      </SheetScaffold>
    </Modal>
  );
}

function MergePersonSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const { store, router } = useApp();
  const others = store.data.people.filter((p) => p.id !== person.id).sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const [target, setTarget] = useState(() => [person.name, ...person.aliases].flatMap((n) => store.possibleDuplicates(n, person.id))[0]?.id ?? "");
  const label = store.person(target) ? `“${store.person(target)!.name}”` : "所选人员";
  const details = [...store.mergeEffects(person.id).map((x) => `${x}改到${label}名下`), `“${person.name}”记为${label}的别名`, `删除“${person.name}”这条重复记录`];
  const merge = () => { if (!target) return; onClose(); store.mergePerson(person.id, target); router.set("selectedPersonID", target); };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={`把“${person.name}”合并到…`} subtitle="任职、持股、代持关系、文件和集团顶层都会改到所选人员名下，然后删除这条重复记录。" width={540} onSubmit={merge}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!target} onClick={merge}>合并</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup>
            <FieldRow label="合并到" hint={others.length ? "括号里是现任职务和持股，用来区分同名的人。" : "还没有其他人员可以合并。"}>
              <SelectField options={others.map((p) => [p.id, `${p.name}（${store.personHint(p.id)}）`] as [string, string])} value={target} onChange={setTarget} minWidth={260} />
            </FieldRow>
          </FormGroup>
          <div className="col gap8">
            <span className="t-meta muted" style={{ fontWeight: 600, paddingLeft: 4 }}>合并后</span>
            <div className="col gap6" style={{ padding: 12, borderRadius: 12, background: "var(--band)" }}>
              {details.map((x) => <span key={x} className="row baseline gap8"><span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--muted)", flex: "none", transform: "translateY(-2px)" }} />{x}</span>)}
            </div>
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

void newPerson;
