// Charter 4 新建公司：一张表填完。股东选已有的公司或人，没有就就地新建；年审日期按法域规则自动排出。

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/hooks";
import * as D from "../domain/day";
import { type NodeRef, effectiveRule, ref, ruleApplies } from "../domain/models";
import { dueDates } from "../domain/engine";
import { Icon } from "../ui/Icon";
import { Avatar, Button, DateField, JurisdictionBadge, Modal, SelectField } from "../ui/kit";
import { companyTint } from "../ui/uistyle";

type Holder = { kind: "existing"; ref: NodeRef } | { kind: "newCompany"; name: string; jurisdiction: string; entityForm?: string } | { kind: "newPerson"; name: string } | null;

export function NewCompanySheet({ onClose, groupID }: { onClose: () => void; groupID?: string }) {
  const { store, router } = useApp();
  const jurs = store.data.library.jurisdictions;
  const [name, setName] = useState("");
  // 4.4：法域没有默认值，必须明确选；名称后缀只给建议。
  const [jur, setJur] = useState("");
  const [form, setForm] = useState("");
  const [brand, setBrand] = useState<string | undefined>(groupID ?? (store.data.groups.length === 1 ? store.data.groups[0].id : undefined));
  const [holder, setHolder] = useState<Holder>(null);
  const [percent, setPercent] = useState("100");
  const [q, setQ] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [dq, setDq] = useState("");
  const [inc, setInc] = useState<D.Day | undefined>();
  const [reg, setReg] = useState("");
  const suggestedParty = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of store.data.companies) if (c.jurisdiction === jur && c.defaultPartyID) count.set(c.defaultPartyID, (count.get(c.defaultPartyID) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [jur]);
  const [partyChoice, setPartyChoice] = useState<string | null>(null);
  const partyID = partyChoice ?? suggestedParty ?? "";
  const [tried, setTried] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);

  const ql = q.trim().toLowerCase();
  const holderName = holder?.kind === "existing" ? store.nameOf(holder.ref) : holder ? holder.name : "";

  const dues = useMemo(() => {
    const draft = { ...store.newCompanyDraft(name || "新公司", jur), incorporationDate: inc };
    return store.data.library.rules.filter((r) => ruleApplies(r, draft) && r.schedule.kind !== "event" && r.schedule.kind !== "documentExpiry")
      .map((r) => ({ r, day: dueDates(effectiveRule(r, draft), draft, [], store.today, D.addDays(store.today, 400))[0] }))
      .filter((x) => x.day).sort((a, b) => (a.day! < b.day! ? -1 : 1));
  }, [jur, inc, store.data.library.rules]);

  const nameError = tried && !name.trim() ? "填写注册名" : null;
  const jurError = tried && !jur ? "选择法域" : null;
  const holderJurError = tried && holder?.kind === "newCompany" && !holder.jurisdiction ? "选择股东公司的法域" : null;
  const suggest = store.suggestJurisdiction(name);
  const hSuggest = holder?.kind === "newCompany" ? store.suggestJurisdiction(holder.name) : null;
  const pct = Number(percent);
  const submit = () => {
    setTried(true);
    if (!name.trim() || !jur) return;
    if (holder?.kind === "newCompany" && !holder.jurisdiction) return;
    if (holder && !(pct > 0 && pct <= 100)) return;
    const allDirs = [...dirs, ...(dq.trim() ? [dq.trim()] : [])];
    const c = store.createCompanyFull({ name, jurisdiction: jur, entityForm: form || undefined, groupID: brand, partyID: partyID || undefined, percent: pct || 100, holder, directors: allDirs, incorporationDate: inc, registrationNumber: reg.trim() });
    onClose();
    router.update((r) => { r.section = "structure"; r.selectedCompanyID = c.id; r.showCalendar = false; });
    store.showToast(`已建立 ${c.name}${dues.length ? "，年审日期已排好" : ""}。`, () => store.undo());
  };

  return (
    <Modal onClose={onClose}>
      <div className="sheet v4-new" style={{ width: 1000, maxHeight: Math.min(820, window.innerHeight - 40) }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}>
        <div className="sheet-head">
          <div className="t-sheet">新建公司</div>
          <div className="muted">一张表填完。股东选已有的公司或人，没有就新建；年审日期按法域自动排好。</div>
        </div>
        <div className="sheet-body row" style={{ alignItems: "flex-start", gap: 28 }}>
          <div className="col" style={{ flex: 1.2, gap: 18, minWidth: 0 }}>
            <label className="v4-field">注册名
              <input className="v4-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Mingan Vietnam Co., Ltd." aria-invalid={!!nameError} />
              {nameError && <span className="danger-text t-meta">{nameError}</span>}
            </label>
            <div className="v4-field">法域 · 必选
              <div className="row gap6" style={{ flexWrap: "wrap" }}>
                {jurs.map((j) => <button key={j.code} className={`v4-seg ${jur === j.code ? "on" : ""}`} onClick={() => { setJur(j.code); setForm(""); }}>{j.code} {j.name}</button>)}
              </div>
              {!jur && suggest && <span className="row gap6 t-meta muted">建议：<button className="v4-chip btnlike" onClick={() => setJur(suggest.code)}>{store.jurisdictionName(suggest.code)}</button>（{suggest.why}）</span>}
              {jurError && <span className="danger-text t-meta">{jurError}</span>}
            </div>
            {jur && (store.jurisdiction(jur)?.entityForms?.length ?? 0) > 0 && (
              <div className="v4-field">实体类型
                <SelectField<string> minWidth={300} placeholder="可以之后再填" value={form} onChange={setForm} options={(store.jurisdiction(jur)?.entityForms ?? []).map((f) => [f, f] as [string, string])} />
              </div>
            )}
            {store.data.groups.length > 0 && (
              <div className="v4-field">集团
                <div className="row gap6" style={{ flexWrap: "wrap" }}>
                  {store.data.groups.map((g) => (
                    <button key={g.id} className={`v4-seg ${brand === g.id ? "on" : ""}`} onClick={() => setBrand(brand === g.id ? undefined : g.id)}>
                      <span className="v4-dot" style={{ background: store.brandColor(g) }} />{g.name}
                    </button>
                  ))}
                  <button className={`v4-seg ${brand ? "" : "on"}`} onClick={() => setBrand(undefined)}>暂不分组</button>
                  <span className="t-meta muted" style={{ alignSelf: "center" }}>{brand ? "" : "有股东在某个集团里时会自动归入"}</span>
                </div>
              </div>
            )}
            <div className="v4-field" style={{ position: "relative" }}>股东
              {holder ? (
                <div className="v4-line">
                  <span className="v4-code">{holder.kind === "existing" && holder.ref.kind === "company" ? store.company(holder.ref.id)?.jurisdiction : holder.kind === "newCompany" ? (holder.jurisdiction || "?") : [...holderName][0]}</span>
                  <span className="grow ellipsis" style={{ fontWeight: 600 }}>{holderName}{holder.kind !== "existing" ? "（新建）" : ""}</span>
                  <input className="v4-input num" style={{ width: 70, height: 30, textAlign: "right" }} value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ""))} aria-label="持股比例" />
                  <span className="muted">%</span>
                  <button className="v4-x" aria-label="移除股东" onClick={() => { setHolder(null); setQ(""); setTimeout(() => qRef.current?.focus()); }}><Icon name="xmark" size={10} /></button>
                </div>
              ) : (
                <>
                  <EntityCombo inputRef={qRef} value={q} onChange={setQ} kinds={["person", "company"]} ariaLabel="股东" placeholder="点击选择已有的人或公司，或输入名字新建…"
                    onPick={(r) => setHolder({ kind: "existing", ref: r })}
                    extra={(t) => [
                      { key: "nc", label: `新建公司“${t}”`, sub: "要选法域", lead: <span className="v4-code dark">+</span>, run: () => setHolder({ kind: "newCompany", name: t, jurisdiction: "" }) },
                      { key: "np", label: `新建个人“${t}”`, lead: <span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span>, run: () => setHolder({ kind: "newPerson", name: t }) },
                    ]} />
                </>
              )}
              {holder?.kind === "newCompany" && (
                <div className="newco" style={{ marginTop: 8 }}>
                  <div className="newco-grid">
                    <div className="col gap6"><span className="entry-mini">股东公司的法域 · 必选</span>
                      <div className={holder.jurisdiction ? "" : "req-wrap"}><SelectField<string> minWidth={220} placeholder="选择法域" value={holder.jurisdiction}
                        onChange={(v) => setHolder({ ...holder, jurisdiction: v, entityForm: undefined })} options={jurs.map((j) => [j.code, `${j.code} ${j.name}`] as [string, string])} /></div>
                      {!holder.jurisdiction && hSuggest && <span className="row gap6 t-meta muted">建议：<button className="v4-chip btnlike" onClick={() => setHolder({ ...holder, jurisdiction: hSuggest.code })}>{store.jurisdictionName(hSuggest.code)}</button></span>}
                      {holderJurError && <span className="danger-text t-meta">{holderJurError}</span>}
                    </div>
                    <div className="col gap6"><span className="entry-mini">实体类型</span>
                      <SelectField<string> minWidth={220} placeholder={holder.jurisdiction ? "可以之后再填" : "先选法域"} disabled={!holder.jurisdiction} value={holder.entityForm ?? ""}
                        onChange={(v) => setHolder({ ...holder, entityForm: v })} options={(store.jurisdiction(holder.jurisdiction)?.entityForms ?? []).map((f) => [f, f] as [string, string])} />
                    </div>
                  </div>
                  <span className="t-meta muted">股东公司不分组、它自己的股东暂不填，会显示“股东待补”。</span>
                </div>
              )}
            </div>
            <div className="v4-field">董事
              <div className="v4-tags">
                {dirs.map((d, i) => <span key={d + i} className="v4-chip">{d}<button aria-label={`移除 ${d}`} onClick={() => setDirs(dirs.filter((_, j) => j !== i))}><Icon name="xmark" size={9} /></button></span>)}
                <EntityCombo bare value={dq} onChange={setDq} kinds={["person"]} ariaLabel="添加董事" placeholder={dirs.length ? "" : "点击选择已有的人，或输入姓名后回车新建"}
                  exclude={dirs} onPick={(r) => { setDirs([...dirs, store.nameOf(r)]); setDq(""); }}
                  extra={(t) => dirs.includes(t) ? [] : [{ key: "nd", label: `新建董事“${t}”`, lead: <span className="v4-code dark" style={{ borderRadius: "50%" }}>+</span>, run: () => { setDirs([...dirs, t]); setDq(""); } }]}
                  onBackspaceEmpty={() => dirs.length && setDirs(dirs.slice(0, -1))} />
              </div>
            </div>
            <div className="row gap12">
              <label className="v4-field grow">注册编号<input className="v4-input mono" value={reg} onChange={(e) => setReg(e.target.value)} placeholder="可稍后补" /></label>
              <div className="v4-field">成立日期<DateField value={inc} onChange={setInc} placeholder="可稍后补" /></div>
            </div>
          </div>
          <div className="col" style={{ flex: 1, gap: 18, minWidth: 0 }}>
            <div className="v4-field">默认中介
              <SelectField<string> minWidth={300} placeholder="选择中介" value={partyID} onChange={(v) => setPartyChoice(v)}
                options={[["", "暂不指定"] as [string, string], ...store.data.parties.map((p) => [p.id, p.name] as [string, string])]} />
              {suggestedParty && partyID === suggestedParty && <span className="t-meta muted">按同法域的其他公司推荐</span>}
            </div>
            <div className="v4-field">年审日期（按{store.jurisdictionName(jur)}规则自动排好）
              <div className="v4-box">
                {dues.length ? dues.map(({ r, day }) => (
                  <div key={r.id} className="row" style={{ minHeight: 50, padding: "0 12px", justifyContent: "space-between", gap: 12 }}>
                    <span className="col" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{r.name}</span><span className="t-meta muted ellipsis">{r.localName || r.responsibleHint}</span></span>
                    <span className="num">{D.long(day!)}</span>
                  </div>
                )) : <div className="muted" style={{ padding: 14 }}>这个法域还没有规则，可在设置里添加。</div>}
              </div>
              <span className="t-meta muted">成立日期不同，日期会跟着变。到期前 {store.data.settings.reminderDays.join(" / ")} 天提醒，并写入订阅日历。建好后可在公司页逐项修改。</span>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <span className="t-meta muted">{holder ? `建好后接在 ${holderName} 下面。` : "股东可以先空着，会显示“股东待补”。"}</span>
          <span className="spacer" />
          <Button onClick={onClose}>取消</Button>
          <Button kind="primary" onClick={submit}>建立公司</Button>
        </div>
      </div>
    </Modal>
  );
}

// MARK: - 5.3.3 选人或公司的输入框：点进就列出已有的，打字过滤（忽略大小写和空格、匹配别名），最后一行是“新建”

function EntityCombo({ value, onChange, kinds, onPick, extra, placeholder, ariaLabel, inputRef, bare, exclude = [], onBackspaceEmpty }: {
  value: string; onChange: (v: string) => void; kinds: ("person" | "company")[]; onPick: (r: NodeRef) => void;
  extra: (text: string) => { key: string; label: string; sub?: string; lead?: React.ReactNode; run: () => void }[];
  placeholder: string; ariaLabel: string; inputRef?: React.RefObject<HTMLInputElement>; bare?: boolean; exclude?: string[]; onBackspaceEmpty?: () => void;
}) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
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
    <div style={{ position: "relative", flex: bare ? "1 1 160px" : undefined, minWidth: bare ? 160 : undefined }}>
      <input ref={inputRef} className={bare ? undefined : "v4-input"} value={value} placeholder={placeholder} aria-label={ariaLabel} role="combobox" aria-expanded={open}
        style={bare ? { width: "100%" } : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(rows.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if ((e.key === "Enter" || ((e.key === "," || e.key === "，") && bare)) && open && rows.length) { e.preventDefault(); go(nq ? hi : hi); }
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Backspace" && !value) onBackspaceEmpty?.();
        }} />
      {open && rows.length > 0 && (
        <div className="v4-menu sel-list" role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 20, minWidth: 280, maxHeight: 248 }}>
          {people.length > 0 && <span className="sel-group">人员<span className="num"> {people.length}</span></span>}
          {people.map((p) => opt("p" + p.id, <Avatar name={p.name} size={22} />, p.name, store.personHint(p.id)))}
          {companies.length > 0 && <span className="sel-group">公司<span className="num"> {companies.length}</span></span>}
          {companies.map((c) => opt("c" + c.id, <JurisdictionBadge code={c.jurisdiction} size={22} tint={companyTint(store, c.id)} />, c.name, store.jurisdictionName(c.jurisdiction)))}
          {extras.length > 0 && <span className="sel-group">新建</span>}
          {extras.map((x) => opt(x.key, x.lead, x.label, x.sub))}
        </div>
      )}
    </div>
  );
}
