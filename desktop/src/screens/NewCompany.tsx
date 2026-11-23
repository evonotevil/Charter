// Charter 4 新建公司：一张表填完。股东选已有的公司或人，没有就就地新建；年审日期按法域规则自动排出。

import { PercentField } from "./Editors";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import * as D from "../domain/day";
import { type NodeRef, effectiveRule, ref, ruleApplies, sameRef } from "../domain/models";
import { dueDates } from "../domain/engine";
import { Icon } from "../ui/Icon";
import { Avatar, Button, ConfirmSheet, DateField, JurisdictionBadge, Modal, Popover, SelectField, SheetScaffold } from "../ui/kit";
import { companyTint } from "../ui/uistyle";
import "./newCompany.css";

type Holder = { kind: "existing"; ref: NodeRef } | { kind: "newCompany"; name: string; jurisdiction: string; entityForm?: string } | { kind: "newPerson"; name: string } | null;

export function pendingCompanyPeopleInputs(shareholder: string, director: string) {
  return { shareholder: !!shareholder.trim(), director: !!director.trim() };
}

export function NewCompanySheet({ onClose, groupID }: { onClose: () => void; groupID?: string }) {
  const { store, router } = useApp();
  const jurs = store.data.library.jurisdictions;
  const [name, setName] = useState("");
  // 4.4：法域没有默认值，必须明确选；名称后缀只给建议。
  const [jur, setJur] = useState("");
  const [form, setForm] = useState("");
  const [initialGroup] = useState(() => groupID ?? (store.data.groups.length === 1 ? store.data.groups[0].id : undefined));
  const [brand, setBrand] = useState<string | undefined>(initialGroup);
  const [holder, setHolder] = useState<Holder>(null);
  const [percent, setPercent] = useState("100");
  const [q, setQ] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [dq, setDq] = useState("");
  const [inc, setInc] = useState<D.Day | undefined>();
  const incorporationInput = useRef<HTMLInputElement>(null);
  const [reg, setReg] = useState("");
  const suggestedParty = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of store.data.companies) if (c.jurisdiction === jur && c.defaultPartyID) count.set(c.defaultPartyID, (count.get(c.defaultPartyID) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [jur, store.data.companies]);
  const [partyChoice, setPartyChoice] = useState<string | null>(null);
  const partyID = partyChoice ?? suggestedParty ?? "";
  const [tried, setTried] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const directorRef = useRef<HTMLInputElement>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmSearch, setConfirmSearch] = useState(false);
  const openSearch = () => router.open({ kind: "quickSearch" });
  const requestSearch = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    if (name || jur || form || reg || inc || holder || q || dq || dirs.length || percent !== "100" || brand !== initialGroup || partyChoice !== null) {
      setConfirmSearch(true);
    } else {
      openSearch();
    }
  };
  const entityForms = store.jurisdiction(jur)?.entityForms ?? [];
  const entityForm = form || entityForms[0] || "";
  const changeJurisdiction = (code: string) => {
    setJur(code);
    setForm("");
  };
  const holderName = holder?.kind === "existing" ? store.nameOf(holder.ref) : holder ? holder.name : "";

  const dues = useMemo(() => {
    if (!jur) return [];
    const draft = { ...store.newCompanyDraft("", jur), entityForm, incorporationDate: inc };
    return store.data.library.rules.filter((r) => ruleApplies(r, draft) && r.schedule.kind !== "event" && r.schedule.kind !== "documentExpiry")
      .map((r) => ({ r, day: dueDates(effectiveRule(r, draft), draft, [], store.today, D.addDays(store.today, 400))[0] }))
      .filter((x) => x.day).sort((a, b) => (a.day! < b.day! ? -1 : 1));
  }, [jur, inc, entityForm, store, store.today, store.data.library.rules]);

  const nameError = tried && !name.trim() ? "填写注册名" : null;
  const jurError = tried && !jur ? "选择法域" : null;
  const holderJurError = tried && holder?.kind === "newCompany" && !holder.jurisdiction ? "选择股东公司的法域" : null;
  const suggest = store.suggestJurisdiction(name);
  const hSuggest = holder?.kind === "newCompany" ? store.suggestJurisdiction(holder.name) : null;
  const pct = Number(percent);
  const percentError = tried && holder && !(pct > 0 && pct <= 100);
  const pendingPeople = pendingCompanyPeopleInputs(q, dq);
  const pendingShareholder = !holder && pendingPeople.shareholder;
  const shareholderInputError = tried && pendingShareholder;
  const directorInputError = tried && pendingPeople.director;
  const existingHolder = holder?.kind === "existing" ? holder.ref : null;
  const groups = store.data.groups.filter((g) => {
    if (g.id === brand) return true;
    if (!existingHolder || (inc && inc > store.today)) return false;
    return g.tops.some((top) => sameRef(top, existingHolder)) ||
      (existingHolder.kind === "company" && store.rowsOf(g).some((row) => row.companyID === existingHolder.id && !row.unconnected));
  });
  const submit = () => {
    setTried(true);
    if (!name.trim() || !jur) return;
    // ⌘/Ctrl+Enter may submit before the focused date field has blurred.
    const enteredDate = (incorporationInput.current?.value ?? inc ?? "").trim();
    const incorporationDate = D.parseDay(enteredDate) ?? undefined;
    if (enteredDate && !incorporationDate) {
      incorporationInput.current?.focus();
      return;
    }
    if (holder?.kind === "newCompany" && !holder.jurisdiction) return;
    if (holder && !(pct > 0 && pct <= 100)) return;
    if (pendingShareholder || pendingPeople.director) {
      requestAnimationFrame(() => {
        const input = pendingShareholder ? qRef.current : directorRef.current;
        input?.scrollIntoView({ block: "center" });
        input?.focus({ preventScroll: true });
      });
      return;
    }
    const c = store.createCompanyFull({ name, jurisdiction: jur, entityForm, groupID: brand, partyID: partyID || undefined, percent: pct || 100, holder, directors: dirs, incorporationDate, registrationNumber: reg.trim() });
    onClose();
    router.update((r) => { r.section = "structure"; r.selectedCompanyID = c.id; r.showCalendar = false; });
    const hasFilings = store.openObligations.some((o) => o.company.id === c.id);
    store.showToast(`已建立 ${c.name}${hasFilings ? "，年审日期已排好" : ""}。`, () => store.undo());
  };

  return (
    <Modal onClose={onClose}>
      <SheetScaffold className="company-create-sheet" title="新建公司" subtitle="填写注册名并选择法域，其余资料可稍后补全。"
        width={1000} height={820} onSubmit={submit} onKeyDown={requestSearch}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={submit}>建立公司</Button></>}>
        <div className="company-create-layout">
          <section className="company-create-section company-registration" aria-label="公司登记">
            <h2 className="t-section">公司登记</h2>
            <label className="v4-field">注册名 · 必填
              <input className="field" autoFocus aria-label="注册名" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="填写公司注册名" aria-invalid={!!nameError} />
              {nameError && <span className="danger-text t-meta" role="alert">{nameError}</span>}
            </label>
            <div className="company-field-pair">
              <div className="v4-field">法域 · 必选
                <SelectField minWidth={0} ariaLabel="法域" indicator="chevron.down" placeholder="选择法域"
                  value={jur} onChange={changeJurisdiction} options={jurs.map((j) => [j.code, `${j.code} ${j.name}`])} />
                {!jur && suggest && <span className="t-meta muted">建议 <button className="link" onClick={() => changeJurisdiction(suggest.code)}>{store.jurisdictionName(suggest.code)}</button>（{suggest.why}）</span>}
                {jurError && <span className="danger-text t-meta" role="alert">{jurError}</span>}
              </div>
              <div className="v4-field">实体类型
                <SelectField minWidth={0} ariaLabel="实体类型" indicator="chevron.down" disabled={!entityForms.length}
                  placeholder={jur ? "可稍后补" : "请先选择法域"} value={entityForm} onChange={setForm}
                  options={entityForms.map((f) => [f, f])} />
              </div>
            </div>
            <div className="company-field-pair">
              <div className="v4-field">成立日期<DateField minWidth={0} value={inc} onChange={setInc} inputRef={incorporationInput} ariaLabel="成立日期" /></div>
              <label className="v4-field">注册编号<input className="field" value={reg} onChange={(e) => setReg(e.target.value)} placeholder="可稍后补" /></label>
            </div>
          </section>
          <aside className="company-create-preview" aria-label="建档预览">
            <div className="company-preview-heading">
              <h2 className="t-section">建档预览</h2>
              <Button kind="quiet" size="small" ariaExpanded={previewOpen} ariaControls="company-draft-preview" onClick={() => setPreviewOpen(!previewOpen)}>
                {previewOpen ? "收起预览" : dues.length ? `查看 ${dues.length} 项年审` : "查看预览"}
              </Button>
            </div>
            <div id="company-draft-preview" className="company-preview-card" data-expanded={previewOpen}>
              {jur && <div className="company-preview-identity">
                <strong className="t-card">{name.trim() || "待填写注册名"}</strong>
                <span className="muted">{[jur + " " + store.jurisdictionName(jur), entityForm].filter(Boolean).join(" · ")}</span>
                <span className="t-meta muted">{groups.map((g) => g.name).join("、") || "暂未分组"}</span>
              </div>}
              <div className="company-preview-schedule">
                <div className="row gap8"><strong className="t-subtitle grow">年审日期</strong>{jur && <span className="t-meta muted">{dues.length} 项</span>}</div>
                {dues.length ? <ul>{dues.map(({ r, day }) => <li key={r.id}>
                  <div><strong>{r.name}</strong>{(r.localName || r.responsibleHint) && <div className="t-meta muted">{r.localName || r.responsibleHint}</div>}</div>
                  <time dateTime={day}>{D.long(day!)}</time>
                </li>)}</ul> : <span className="t-meta muted">{jur ? "当前资料没有排出年审日期，可补充成立日期或核对适用规则。" : "选择法域后，这里会显示适用的年审事项。"}</span>}
              </div>
              {jur && <div className="company-preview-reminder">
                {store.data.settings.reminderDays.length > 0 && <strong>到期前 {store.data.settings.reminderDays.join(" / ")} 天提醒</strong>}
                <span className="t-meta muted">日期随法域和成立日期更新。</span>
              </div>}
            </div>
          </aside>
          <section className="company-create-section company-people" aria-label="归属与人员">
            <h2 className="t-section">归属与人员</h2>
            <div className="company-field-pair">
              <div className="v4-field">集团
                <SelectField minWidth={0} ariaLabel="集团" indicator="chevron.down" value={brand ?? ""} onChange={(id) => setBrand(id || undefined)}
                  options={[["", "自动归组"], ...store.data.groups.map((g): [string, string] => [g.id, g.name])]} />
                {!brand && <span className="t-meta muted">有股东时按股东归属</span>}
              </div>
              <div className="v4-field">默认中介
                <SelectField minWidth={0} ariaLabel="默认中介" indicator="chevron.down" value={partyID} onChange={setPartyChoice}
                  options={[["", "暂不指定"], ...store.data.parties.map((p): [string, string] => [p.id, p.name])]} />
                {suggestedParty && partyID === suggestedParty && <span className="t-meta muted">根据同法域公司推荐</span>}
              </div>
            </div>
            <div className="v4-field">股东
              {holder ? (
                <div className="v4-line">
                  <span className="v4-code">{holder.kind === "existing" && holder.ref.kind === "company" ? store.company(holder.ref.id)?.jurisdiction : holder.kind === "newCompany" ? (holder.jurisdiction || "?") : [...holderName][0]}</span>
                  <span className="grow ellipsis" style={{ fontWeight: 600 }}>{holderName}{holder.kind !== "existing" ? "（新建）" : ""}</span>
                  <PercentField invalid={!!percentError} value={parseFloat(percent) || 0} onChange={(n) => setPercent(String(n))} />
                  <button className="v4-x" aria-label="移除股东" onClick={() => { setHolder(null); setQ(""); setTimeout(() => qRef.current?.focus()); }}><Icon name="xmark" size={10} /></button>
                </div>
              ) : (
                <>
                  <EntityCombo inputRef={qRef} value={q} onChange={setQ} kinds={["person", "company"]} ariaLabel="股东" placeholder="选择或新建个人、公司" invalid={!!shareholderInputError}
                    onPick={(r) => { setHolder({ kind: "existing", ref: r }); setQ(""); }}
                    extra={(t) => [
                      { key: "nc", label: `新建公司“${t}”`, sub: "要选法域", lead: <span className="v4-code dark">+</span>, run: () => { setHolder({ kind: "newCompany", name: t, jurisdiction: "" }); setQ(""); } },
                      { key: "np", label: `新建个人“${t}”`, lead: <span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span>, run: () => { setHolder({ kind: "newPerson", name: t }); setQ(""); } },
                    ]} />
                </>
              )}
              {!holder && <span className="t-meta muted">可留空，建档后标为“股东待补”。</span>}
              {shareholderInputError && <span className="t-meta danger-text" role="alert">请从候选中选择股东，选择“新建”，或清空后留空。</span>}
              {percentError && <span className="t-meta danger-text" role="alert">持股比例须大于 0，且不能超过 100%。</span>}
              {holder?.kind === "newCompany" && (
                <div className="newco">
                  <div className="newco-grid">
                    <div className="col gap6"><span className="entry-mini">股东公司的法域 · 必选</span>
                      <div className={holder.jurisdiction ? "" : "req-wrap"}><SelectField<string> minWidth={0} placeholder="选择法域" value={holder.jurisdiction}
                        onChange={(v) => setHolder({ ...holder, jurisdiction: v, entityForm: undefined })} options={jurs.map((j) => [j.code, `${j.code} ${j.name}`] as [string, string])} /></div>
                      {!holder.jurisdiction && hSuggest && <span className="row gap6 t-meta muted">建议：<button className="v4-chip btnlike" onClick={() => setHolder({ ...holder, jurisdiction: hSuggest.code })}>{store.jurisdictionName(hSuggest.code)}</button></span>}
                      {holderJurError && <span className="danger-text t-meta">{holderJurError}</span>}
                    </div>
                    <div className="col gap6"><span className="entry-mini">实体类型</span>
                      <SelectField<string> minWidth={0} placeholder={holder.jurisdiction ? "可以之后再填" : "先选法域"} disabled={!holder.jurisdiction} value={holder.entityForm ?? ""}
                        onChange={(v) => setHolder({ ...holder, entityForm: v })} options={(store.jurisdiction(holder.jurisdiction)?.entityForms ?? []).map((f) => [f, f] as [string, string])} />
                    </div>
                  </div>
                  <span className="t-meta muted">股东公司不分组、它自己的股东暂不填，会显示“股东待补”。</span>
                </div>
              )}
            </div>
            <div className="v4-field">董事
              <div className="v4-tags company-directors">
                <Icon name="magnifyingglass" size={15} className="muted" />
                {dirs.map((d, i) => <span key={d + i} className="v4-chip">{d}<button aria-label={`移除 ${d}`} onClick={() => setDirs(dirs.filter((_, j) => j !== i))}><Icon name="xmark" size={9} /></button></span>)}
                <EntityCombo bare inputRef={directorRef} value={dq} onChange={setDq} kinds={["person"]} ariaLabel="添加董事" placeholder={dirs.length ? "" : "选择或新建人员"} invalid={!!directorInputError}
                  exclude={dirs} onPick={(r) => { setDirs([...dirs, store.nameOf(r)]); setDq(""); }}
                  extra={(t) => dirs.includes(t) ? [] : [{ key: "nd", label: `新建董事“${t}”`, lead: <span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span>, run: () => { setDirs([...dirs, t]); setDq(""); } }]}
                  onBackspaceEmpty={() => dirs.length && setDirs(dirs.slice(0, -1))} />
              </div>
              {directorInputError && <span className="t-meta danger-text" role="alert">请从候选中选择董事，或选择“新建董事”。</span>}
            </div>
          </section>
        </div>
      </SheetScaffold>
      {confirmSearch && <ConfirmSheet title="离开新建公司并搜索？" message="离开后，这次填写的公司资料会被丢弃。"
        cancelTitle="继续填写" confirmTitle="放弃草稿并搜索" destructive focusCancel
        onClose={() => setConfirmSearch(false)} onConfirm={openSearch} />}
    </Modal>
  );
}

// MARK: - 5.3.3 选人或公司的输入框：点进就列出已有的，打字过滤（忽略大小写和空格、匹配别名），最后一行是“新建”

function EntityCombo({ value, onChange, kinds, onPick, extra, placeholder, ariaLabel, inputRef, bare, invalid, exclude = [], onBackspaceEmpty }: {
  value: string; onChange: (v: string) => void; kinds: ("person" | "company")[]; onPick: (r: NodeRef) => void;
  extra: (text: string) => { key: string; label: string; sub?: string; lead?: React.ReactNode; run: () => void }[];
  placeholder: string; ariaLabel: string; inputRef?: React.RefObject<HTMLInputElement>; bare?: boolean; invalid?: boolean; exclude?: string[]; onBackspaceEmpty?: () => void;
}) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
  const t = value.trim(), nq = norm(t);
  const people = kinds.includes("person") ? store.data.people.filter((p) => !exclude.includes(p.name) && (!nq || norm(p.name + p.aliases.join("")).includes(nq))).sort((a, b) => a.name.localeCompare(b.name, "zh")) : [];
  const companies = kinds.includes("company") ? store.data.companies.filter((c) => !nq || norm(c.name + c.aliases.join("") + c.jurisdiction).includes(nq)).sort((a, b) => a.name.localeCompare(b.name, "zh")) : [];
  const exact = [...people.map((p) => p.name), ...companies.map((c) => c.name)].some((n) => norm(n) === nq);
  const extras = t && !exact ? extra(t) : [];
  const rows: { key: string; run: () => void }[] = [
    ...people.map((p) => ({ key: "p" + p.id, run: () => onPick(ref("person", p.id)) })),
    ...companies.map((c) => ({ key: "c" + c.id, run: () => onPick(ref("company", c.id)) })),
    ...extras.map((x) => ({ key: x.key, run: x.run })),
  ];
  useEffect(() => setHi(0), [value]);
  const go = (i: number) => { rows[i]?.run(); setOpen(false); };
  let i = -1;
  const opt = (key: string, lead: React.ReactNode, label: string, sub?: string) => { i++; const n = i; return (
    <button key={key} type="button" role="option" aria-selected={n === hi} className={`sel-opt ${n === hi ? "hi" : ""}`} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setHi(n)} onClick={() => go(n)}>
      <span className="sel-lead">{lead}</span><span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis">{label}</span>{sub && <span className="t-meta muted ellipsis">{sub}</span>}</span>
    </button>); };
  return (
    <div className={bare ? "company-combo bare" : "company-combo"} ref={anchor}>
      {!bare && <Icon name="magnifyingglass" size={15} className="company-search-icon" />}
      <input ref={inputRef} className={bare ? undefined : "field"} value={value} placeholder={placeholder} aria-label={ariaLabel} aria-invalid={invalid || undefined} role="combobox" aria-expanded={open}
        style={bare ? { width: "100%" } : undefined}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(rows.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if ((e.key === "Enter" || ((e.key === "," || e.key === "，") && bare)) && open && rows.length) { e.preventDefault(); go(Math.min(hi, rows.length - 1)); }
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Backspace" && !value) onBackspaceEmpty?.();
        }} />
      <Popover anchor={anchor} open={open && rows.length > 0} onClose={() => setOpen(false)} style={{ width: anchor.current?.offsetWidth }}>
        <div className="col sel-list" role="listbox" style={{ maxHeight: 248 }}>
          {people.length > 0 && <span className="sel-group">人员<span className="num"> {people.length}</span></span>}
          {people.map((p) => opt("p" + p.id, <Avatar name={p.name} size={22} />, p.name, store.personHint(p.id)))}
          {companies.length > 0 && <span className="sel-group">公司<span className="num"> {companies.length}</span></span>}
          {companies.map((c) => opt("c" + c.id, <JurisdictionBadge code={c.jurisdiction} size={22} tint={companyTint(store, c.id)} />, c.name, store.jurisdictionName(c.jurisdiction)))}
          {extras.length > 0 && <span className="sel-group">新建</span>}
          {extras.map((x) => opt(x.key, x.lead, x.label, x.sub))}
        </div>
      </Popover>
    </div>
  );
}
