// 命令面板（Ctrl/⌘ K）与持股链条查询。移植自 QueryViews.swift。

import { useEffect, useRef, useState } from "react";
import { type Company, type NodeRef, type PacketTemplate, isActiveOn, ref, sameRef } from "../domain/models";
import { breakdown, chainHasNominee, chainPaths, percentLabel } from "../domain/engine";
import { matchesSearch, searchForms } from "../domain/search";
import { useApp } from "../state/hooks";
import { type SettingsPane, settingsPaneSymbol, settingsPaneTitle, settingsPanes } from "../state/router";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Avatar, Button, FieldRow, FormGroup, JurisdictionBadge, Modal, SelectField, SheetScaffold } from "../ui/kit";
import { ReissueRequestSheet } from "./common";

type Act = { kind: "packet"; companyID: string; purposeID?: string } | { kind: "upload"; companyID: string } | { kind: "reissue"; companyID: string; typeIDs: string[] }
  | { kind: "change"; companyID: string } | { kind: "structure"; companyID: string } | { kind: "newCompany" } | { kind: "newGroup" } | { kind: "uploadAny" } | { kind: "calendar" }
  | { kind: "settings"; pane: SettingsPane };
interface Action { act: Act; title: string; symbol: string }
type Hit = { kind: "company"; c: Company; id: string } | { kind: "person"; p: { id: string; name: string }; id: string } | { kind: "action"; a: Action; id: string };
type Verb = "packet" | "upload" | "reissue" | "change" | "structure";
const verbs: [string, Verb][] = [["文件包", "packet"], ["准备", "packet"], ["上传", "upload"], ["归档", "upload"], ["补发", "reissue"], ["缺少", "reissue"], ["缺", "reissue"],
  ["记录变更", "change"], ["变更", "change"], ["股权结构", "structure"], ["结构", "structure"], ["股权", "structure"]];

export function QuickSearch({ onClose }: { onClose: () => void }) {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  const companyMatches = (c: Company, terms: Set<string>) => matchesSearch(terms, [[c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" "), store.jurisdictionName(c.jurisdiction), store.groupsContaining(c.id).map((g) => g.name).join(" ")]);
  const parse = (text: string) => {
    let rest = text.toLowerCase();
    const purposes: PacketTemplate[] = [];
    const vs: Verb[] = [];
    for (const t of store.data.library.packets) {
      const name = t.name.toLowerCase();
      const keys = [name, ...["开户", "审计", "kyc", "尽调", "续期", "签证"].filter((k) => name.includes(k))];
      const key = keys.find((k) => rest.includes(k));
      if (key) { purposes.push(t); rest = rest.split(key).join(" "); }
    }
    for (const [w, v] of verbs) if (rest.includes(w)) { if (!vs.includes(v)) vs.push(v); rest = rest.split(w).join(" "); }
    if (purposes.length && !vs.includes("packet")) vs.unshift("packet");
    const intent = purposes.length > 0 || vs.length > 0;
    if (intent) for (const f of ["为", "的", "文件", "材料", "请", "打开", "记录", "到"]) rest = rest.split(f).join(" ");
    const tokens = rest.split(/\s+/).filter(Boolean);
    const companies = tokens.length ? store.data.companies.filter((c) => tokens.every((t) => companyMatches(c, searchForms(t)))).sort((a, b) => a.name.localeCompare(b.name, "zh")) : [];
    return { companies, purposes, verbs: vs, intent };
  };
  const gapTypeIDs = (c: Company) => store.archive(c).filter((i) => ["missing", "expired", "expiring", "needsUpdate"].includes(i.state.kind) && !store.openRequest(ref("company", c.id), i.typeID)).map((i) => i.typeID);
  const companyActions = (p: ReturnType<typeof parse>): Action[] => {
    const out: Action[] = [];
    for (const c of p.companies.slice(0, p.intent ? 2 : 1)) {
      for (const v of p.verbs.length ? p.verbs : (["packet", "upload", "reissue", "change", "structure"] as Verb[])) {
        if (v === "packet") {
          if (!p.purposes.length) out.push({ act: { kind: "packet", companyID: c.id }, title: `为 ${c.name} 准备文件包`, symbol: "shippingbox" });
          else for (const t of p.purposes) out.push({ act: { kind: "packet", companyID: c.id, purposeID: t.id }, title: `为 ${c.name} 准备${t.name}文件包`, symbol: "shippingbox" });
        } else if (v === "upload") out.push({ act: { kind: "upload", companyID: c.id }, title: `上传材料到 ${c.name}`, symbol: "tray.and.arrow.down" });
        else if (v === "reissue") { const gaps = gapTypeIDs(c); if (gaps.length) out.push({ act: { kind: "reissue", companyID: c.id, typeIDs: gaps }, title: `请 ${store.party(c.defaultPartyID)?.name ?? "负责方"} 补发 ${c.name} 缺少的文件`, symbol: "envelope" }); }
        else if (v === "change") out.push({ act: { kind: "change", companyID: c.id }, title: `记录 ${c.name} 的变更`, symbol: "arrow.triangle.2.circlepath" });
        else out.push({ act: { kind: "structure", companyID: c.id }, title: `打开 ${c.name} 的股权结构`, symbol: "point.3.connected.trianglepath.dotted" });
      }
    }
    return out;
  };
  const globalActions = (text: string | null): Action[] => {
    const all: Action[] = [
      { act: { kind: "newCompany" }, title: "新建公司", symbol: "plus.square" },
      { act: { kind: "newGroup" }, title: "新建集团", symbol: "square.stack.3d.up" },
      { act: { kind: "uploadAny" }, title: "上传材料", symbol: "tray.and.arrow.down" },
      ...(store.complianceOn ? [{ act: { kind: "calendar" } as Act, title: "查看全部日程", symbol: "calendar" }] : []),
      { act: { kind: "settings", pane: "sync" }, title: "设置", symbol: "gearshape" },
    ];
    if (text == null) return all;
    for (const p of settingsPanes) if (p !== "sync" && (p !== "rules" || store.complianceOn)) all.push({ act: { kind: "settings", pane: p }, title: `设置：${settingsPaneTitle[p]}`, symbol: settingsPaneSymbol[p] });
    const terms = searchForms(text);
    return all.filter((a) => { const forms = searchForms(a.title); return matchesSearch(terms, [a.title]) || [...terms].some((t) => [...forms].some((f) => t.includes(f))); });
  };
  const toHit = (a: Action): Hit => ({ kind: "action", a, id: `a-${JSON.stringify(a.act)}-${a.title}` });
  let sections: { id: string; title: string; hits: Hit[] }[];
  if (!q) {
    sections = [
      { id: "recent", title: "最近", hits: router.recentCompanyIDs.map((id) => store.company(id)).filter((c): c is Company => !!c).map((c) => ({ kind: "company", c, id: `c-${c.id}` })) },
      { id: "common", title: "常用动作", hits: globalActions(null).map(toHit) },
    ];
  } else {
    const parsed = parse(q);
    const terms = searchForms(q);
    const cs = store.data.companies.filter((c) => companyMatches(c, terms)).sort((a, b) => a.name.localeCompare(b.name, "zh")).map((c): Hit => ({ kind: "company", c, id: `c-${c.id}` }));
    const ps = store.data.people.filter((p) => matchesSearch(terms, [p.name, ...p.aliases])).sort((a, b) => a.name.localeCompare(b.name, "zh")).map((p): Hit => ({ kind: "person", p, id: `p-${p.id}` }));
    const found = [...cs, ...ps].slice(0, 30);
    const actions = { id: "actions", title: "动作", hits: [...companyActions(parsed), ...globalActions(q)].map(toHit).slice(0, 8) };
    const list = [{ id: "companies", title: "公司", hits: found.filter((h) => h.kind === "company") }, { id: "people", title: "人员", hits: found.filter((h) => h.kind === "person") }];
    sections = parsed.intent ? [actions, ...list] : [...list, actions];
  }
  sections = sections.filter((s) => s.hits.length);
  const flat = sections.flatMap((s) => s.hits);
  useEffect(() => { if (!selectedID || !flat.some((h) => h.id === selectedID)) setSelectedID(flat[0]?.id ?? null); }, [flat.map((h) => h.id).join("|")]);
  useEffect(() => { listRef.current?.querySelector(`[data-hit="${CSS.escape(selectedID ?? "")}"]`)?.scrollIntoView({ block: "nearest" }); }, [selectedID]);

  const closeThen = (fn: () => void) => { onClose(); setTimeout(fn, 200); };
  const perform = (act: Act) => {
    switch (act.kind) {
      case "packet": router.open(act.purposeID ? { kind: "packetFor", companyID: act.companyID, purposeID: act.purposeID } : { kind: "packet", companyID: act.companyID }); break;
      case "change": router.open({ kind: "change", companyID: act.companyID }); break;
      case "newCompany": router.open({ kind: "newCompany" }); break;
      case "newGroup": router.open({ kind: "newGroup" }); break;
      case "reissue": setReissue({ owner: ref("company", act.companyID), typeIDs: act.typeIDs }); break;
      case "upload": closeThen(() => void router.chooseFiles({ kind: "company", id: act.companyID })); break;
      case "uploadAny": closeThen(() => void router.chooseFiles(router.currentImportContext((id) => !!store.group(id)))); break;
      case "structure": onClose(); router.selectedCompanyID = act.companyID; router.openStructure({ group: store.groupsContaining(act.companyID)[0]?.id ?? null }); break;
      case "calendar": onClose(); router.openCalendar(); break;
      case "settings": onClose(); router.openSettings(act.pane); break;
    }
  };
  const run = (h: Hit) => {
    if (h.kind === "company") { onClose(); router.companyTab = 0; router.openCompany(h.c.id); }
    else if (h.kind === "person") { onClose(); router.openPerson(h.p.id); }
    else perform(h.a.act);
  };
  const move = (d: number) => {
    if (!flat.length) return;
    const cur = flat.findIndex((h) => h.id === selectedID);
    const start = cur < 0 ? (d > 0 ? -1 : flat.length) : cur;
    setSelectedID(flat[Math.min(Math.max(start + d, 0), flat.length - 1)].id);
  };
  const hint = (t: string, on: boolean) => <span className="t-meta" style={{ flex: "none", color: on ? "color-mix(in srgb, var(--on-selection) 70%, transparent)" : "var(--muted)" }}>{t}</span>;
  return (
    <Modal onClose={onClose}>
      <div className="col sheet" style={{ width: 600, height: "min(460px, 80vh)", padding: 0, overflow: "hidden" }} role="dialog" aria-label="查找">
        <div className="row gap10" style={{ height: 60, padding: "0 12px 0 18px", flex: "none" }}>
          <Icon name="magnifyingglass" size={16} className="muted" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="公司、人名，或“远澜 开户”这样的一句话" className="grow"
            style={{ border: 0, outline: "none", background: "transparent", fontSize: 18, color: "inherit", minWidth: 0 }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              else if (e.key === "Enter") { e.preventDefault(); const h = flat.find((x) => x.id === selectedID) ?? flat[0]; if (h) run(h); }
            }} />
          <Button kind="quiet" size="small" icon="xmark" title="关闭（Esc）" ariaLabel="关闭" onClick={onClose} />
        </div>
        <div className="hairline" />
        {!sections.length ? (
          <div className="col grow" style={{ justifyContent: "center", alignItems: "center", gap: 6 }}>
            <span className="t-body muted">{q ? `没有找到“${query}”。` : "输入名称、注册编号或人名，按回车打开第一个结果。"}</span>
            <span className="t-meta muted">按 Esc 关闭</span>
          </div>
        ) : (
          <div ref={listRef} className="scroll grow col" style={{ padding: 8, gap: 2 }} role="listbox">
            {sections.map((s) => (
              <div key={s.id} className="col" style={{ gap: 2 }}>
                <span className="t-micro muted" style={{ padding: "8px 10px 2px" }}>{s.title}</span>
                {s.hits.map((h) => {
                  const on = h.id === selectedID;
                  const fg = on ? "var(--on-selection)" : "var(--ink)";
                  const sub = on ? "color-mix(in srgb, var(--on-selection) 70%, transparent)" : "var(--muted)";
                  return (
                    <button key={h.id} data-hit={h.id} role="option" aria-selected={on} className="row gap10" onMouseEnter={() => setSelectedID(h.id)} onClick={() => run(h)}
                      style={{ height: 46, padding: "0 10px", borderRadius: 10, textAlign: "left", background: on ? "var(--selection)" : undefined, color: fg, flex: "none" }}>
                      {h.kind === "company" ? <>
                        <JurisdictionBadge code={h.c.jurisdiction} size={30} highlighted={on} />
                        <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                          <span className="ellipsis" style={{ fontSize: 14, fontWeight: 500 }}>{h.c.name}</span>
                          <span className="t-meta ellipsis" style={{ color: sub }}>{[store.jurisdictionName(h.c.jurisdiction), h.c.registrationNumber, store.groupsContaining(h.c.id).map((g) => g.name).join("、")].filter(Boolean).join("，")}</span>
                        </span>{hint("↩ 打开", on)}
                      </> : h.kind === "person" ? <>
                        <Avatar name={h.p.name} size={30} highlighted={on} />
                        <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                          <span className="ellipsis" style={{ fontSize: 14, fontWeight: 500 }}>{h.p.name}</span>
                          <span className="t-meta" style={{ color: sub }}>{(() => { const n = store.data.appointments.filter((a) => a.personID === h.p.id && isActiveOn(a, store.today)).length; return n ? `任 ${n} 家公司董事或高管` : "人员"; })()}</span>
                        </span>{hint("↩ 打开", on)}
                      </> : <>
                        <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", flex: "none", background: on ? "color-mix(in srgb, var(--on-selection) 12%, transparent)" : "var(--band)", color: on ? fg : "var(--muted)" }}><Icon name={h.a.symbol} size={13} /></span>
                        <span className="ellipsis grow" style={{ fontSize: 14, fontWeight: 500 }}>{h.a.title}</span>{hint("↩ 执行", on)}
                      </>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      {reissue && <ReissueRequestSheet owner={reissue.owner} typeIDs={reissue.typeIDs} onClose={() => { setReissue(null); onClose(); }} />}
    </Modal>
  );
}

export function ChainQuery({ from: initialFrom, to: initialTo, onClose }: { from?: NodeRef; to?: string; onClose: () => void }) {
  const { store } = useApp();
  const [from, setFrom] = useState<NodeRef | null>(initialFrom ?? null);
  const [to, setTo] = useState<string | null>(initialTo ?? null);
  const people = [...store.data.people].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const companies = [...store.data.companies].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const fromOptions: [NodeRef, string][] = [...people.map((p) => [ref("person", p.id), `人：${p.name}`] as [NodeRef, string]), ...companies.map((c) => [ref("company", c.id), c.name] as [NodeRef, string])];
  const chains = from && to && !sameRef(from, ref("company", to)) ? chainPaths(from, to, store.data.holdings, store.today) : [];
  const total = chains.reduce((a, c) => a + c.percent, 0);
  const b = to ? breakdown(to, store.data.holdings, store.today) : null;
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="查询持股链条" subtitle="列出从某人或某公司到目标公司的所有持股路径，含代持。" width={640} height={600} onSubmit={onClose}
        leading={chains.length ? <Button onClick={() => { void platform().copyText(chains.map((c) => store.chainText(c)).join("\n")); store.showToast("链条已复制。"); }}>复制链条</Button> : null}
        trailing={<Button kind="primary" onClick={onClose}>完成</Button>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title="查询">
            <FieldRow label="起点"><SelectField options={fromOptions} value={from as NodeRef} onChange={setFrom} placeholder="选择人或公司" minWidth={320} keyOf={(r) => (r ? `${r.kind}:${r.id}` : "")} /></FieldRow>
            <FieldRow label="目标公司"><SelectField options={companies.map((c) => [c.id, c.name] as [string, string])} value={to as string} onChange={setTo} placeholder="选择公司" minWidth={320} /></FieldRow>
          </FormGroup>
          <div className="col gap10">
            {!from || !to ? <span className="t-body muted">选好起点和目标公司，Charter 会列出所有持股路径。</span>
              : !chains.length ? <>
                <span className="row gap6" style={{ fontSize: 15, fontWeight: 600 }}><Icon name="magnifyingglass" />根据当前已录入关系，未找到持股路径</span>
                <span className="t-body muted">未找到不代表实际不存在；结果受股东和代持信息的录入范围影响。</span>
              </> : <>
                <span className="row gap6" style={{ fontSize: 15, fontWeight: 600 }}><Icon name="checkmark.circle.fill" />找到 {chains.length} 条持股路径，路径比例合计 {percentLabel(total)}</span>
                {chains.map((c) => (
                  <div key={c.id} className="col gap4" style={{ padding: 12, borderRadius: 12, background: "var(--band)" }}>
                    <span className="selectable">{store.chainText(c)}</span>
                    {chainHasNominee(c) && <span className="t-meta amber-text">包含已记录的代持关系</span>}
                  </div>
                ))}
              </>}
            {b && b.unknown > 0.005 && <span className="row gap6 amber-text"><Icon name="exclamationmark.triangle" />目标公司有 {percentLabel(b.unknown)} 的最终持股尚未识别</span>}
            {b && b.cyclicCompanyIDs.length > 0 && <span className="amber-text">存在循环持股；简单路径合计不能作为最终受益比例。请核对结构并单独计算。</span>}
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}
