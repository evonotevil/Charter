// 5.3 材料范围：法定应有（模板建议）/ 由我保管（保管范围）/ Charter 实有（已归档）分开。
// 完整度只算“我负责”∩“已归档”；没配置过范围的显示“未配置材料范围”。

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { type ArchiveItem, type Custody, type NodeRef, archiveItemName, completeness, custodies, custodyHint, custodyLabel, hasFile, inView, ref, refKey, uuid } from "../domain/models";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Button, Checkbox, Modal, Pill, PopoverRow, ProgressTrack, SelectField, SheetScaffold, TextField } from "../ui/kit";
import { PickChip } from "./PropChips";
import { StatusTag, statusOfArchive, type StatusView } from "./Status";

// MARK: 视图偏好（按这台电脑记住）

export type FileView = "held" | "review";
const viewKey = "charter.fileView";
const viewListeners = new Set<() => void>();
let currentView: FileView = (() => { try { return localStorage.getItem(viewKey) === "review" ? "review" : "held"; } catch { return "held"; } })();
export function setFileView(v: FileView) { currentView = v; try { localStorage.setItem(viewKey, v); } catch { /* 只在本次有效 */ } viewListeners.forEach((l) => l()); }
export const useFileView = () => useSyncExternalStore((l) => { viewListeners.add(l); return () => viewListeners.delete(l); }, () => currentView);

export function FileViewToggle() {
  const v = useFileView();
  const b = (x: FileView, label: string, hint: string) => (
    <button className={v === x ? "on" : ""} aria-pressed={v === x} title={hint} onClick={() => setFileView(x)}
      style={v === x ? { background: "var(--seg-on)", color: "var(--seg-on-text)", boxShadow: "0 0 0 2px var(--green-soft-line)" } : undefined}>{label}</button>
  );
  return <div className="seg" role="group" aria-label="文件视图">{b("held", "已有材料", "只列已经归档的文件")}{b("review", "完整性审阅", "列出“我负责”里缺的、待确认的和中介保管的")}</div>;
}

// MARK: 状态

/** 没有文件时按保管范围显示；有文件时显示文件状态。 */
export function itemStatus(i: ArchiveItem): StatusView {
  if (hasFile(i.state)) return statusOfArchive(i.state);
  switch (i.custody) {
    case "mine": return { key: "missing", text: "缺件", icon: "circle.dashed", cls: "warn-o", hint: "由你保管，还没有归档" };
    case "agent": return { key: "external", text: "中介保管", icon: "lock.circle", cls: "quiet", hint: "由中介或其他机构保管，不算缺件" };
    case "pending": return { key: "unverifiedMark", text: "未归档", icon: "circle.dashed", cls: "miss", hint: "还没有这份文件；是否由你保管尚未确认，不算缺件" };
    case "na": return { key: "notApplicable", text: "不适用", icon: "minus.circle", cls: "quiet", hint: "用不到" };
    case "outOfScope": return { key: "notApplicable", text: "不在我的范围", icon: "minus.circle", cls: "quiet", hint: "不归你管" };
  }
}

/** 单个条目的保管范围选择。 */
export function CustodyChip({ owner, item }: { owner: NodeRef; item: ArchiveItem }) {
  const { store } = useApp();
  return (
    <PickChip label={<span><span className="muted" style={{ fontWeight: 500 }}>保管 </span>{custodyLabel[item.custody]}{item.explicit ? "" : <span className="muted" style={{ fontWeight: 500 }}>（未设置）</span>}</span>} title="由谁保管：只有“我负责”的缺项才算缺件" width={260}
      className="outline">
      {(close) => <>
        {custodies.map((c) => <PopoverRow key={c} title={custodyLabel[c]} trailing={c === item.custody && item.explicit ? "✓" : undefined} checked={c === item.custody}
          onClick={() => { close(); store.setCustody([owner], [item.typeID], c); }} />)}
        {item.explicit && <><div className="hairline" style={{ margin: "4px 6px" }} /><PopoverRow title="恢复默认" icon="arrow.uturn.backward" onClick={() => { close(); store.setCustody([owner], [item.typeID], null); }} /></>}
        <span className="t-meta muted" style={{ display: "block", padding: "6px 10px", maxWidth: 240 }}>{custodyHint[item.custody]}</span>
      </>}
    </PickChip>
  );
}

/** “我负责 x/y · 中介保管 n · 待确认 m”，未配置时提示去设置。 */
export function ScopeSummary({ counts, onConfigure, compact }: { counts: ReturnType<ReturnType<typeof useApp>["store"]["companyCounts"]>; onConfigure: () => void; compact?: boolean }) {
  const pct = completeness(counts);
  if (!counts.configured) return (
    <span className="row gap8 wrap"><Pill text="未配置材料范围" kind="neutral" /><span className="t-meta muted">已归档 {counts.docs} 份{counts.docs !== counts.files ? ` · ${counts.files} 类` : ""}</span>
      {!compact && <button className="link t-meta" onClick={onConfigure}>设置范围</button>}</span>
  );
  return (
    <span className="row gap10 wrap">
      {pct !== null ? <><ProgressTrack value={pct} width={compact ? 64 : 120} /><span className="t-meta num">我负责 <b>{counts.held}/{counts.total}</b> 类{counts.missing ? ` · 缺 ${counts.missing} 类` : " · 齐全"}</span></>
        : <span className="t-meta muted">没有“我负责”的条目</span>}
      {!compact && counts.agent > 0 && <span className="t-meta muted">中介保管 {counts.agent}</span>}
      {!compact && counts.pending > 0 && <span className="t-meta amber-text">待确认 {counts.pending}</span>}
      {!compact && <button className="link t-meta" onClick={onConfigure}>调整范围</button>}
    </span>
  );
}

/** 两种视图下的条目列表。row 由调用方渲染一行（含上传、查看）。 */
export function ScopedItems({ items, view, row, empty }: { items: ArchiveItem[]; view: "held" | "review"; row: (i: ArchiveItem) => ReactNode; empty: ReactNode }) {
  const [showAgent, setShowAgent] = useState(false);
  if (view === "held") {
    const held = items.filter((i) => hasFile(i.state));
    return held.length ? <div className="col">{held.map(row)}</div> : <>{empty}</>;
  }
  const missing = items.filter((i) => i.custody === "mine" && !hasFile(i.state));
  const attention = items.filter((i) => hasFile(i.state) && inView(i.custody) && i.state.kind !== "valid");
  const pending = items.filter((i) => i.custody === "pending" && !hasFile(i.state));
  const agent = items.filter((i) => i.custody === "agent" && !hasFile(i.state));
  const ok = items.filter((i) => hasFile(i.state) && i.state.kind === "valid");
  const group = (title: string, list: ArchiveItem[], hint?: string) => list.length > 0 && (
    <div className="col" style={{ marginTop: 8 }}>
      <span className="t-label" style={{ padding: "6px 0" }}>{title} · {list.length}{hint ? <span className="muted" style={{ fontWeight: 500 }}>　{hint}</span> : null}</span>
      {list.map(row)}
    </div>
  );
  return <div className="col">
    {group("我负责但还没有", missing)}
    {group("已归档但需要处理", attention)}
    {group("待确认", pending, "决定是否由你保管；法域模板建议的条目也在这里")}
    {agent.length > 0 && <>{showAgent ? group("中介保管", agent) : <button className="link t-meta" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => setShowAgent(true)}>显示中介保管的 {agent.length} 项</button>}</>}
    {group("已归档", ok)}
    {!missing.length && !attention.length && !pending.length && !agent.length && !ok.length && empty}
  </div>;
}

// MARK: 批量设置材料范围

export function ScopeSheet({ kind: initialKind, owners: initialOwners, onClose }: { kind: "company" | "person"; owners?: string[]; onClose: () => void }) {
  const { store } = useApp();
  const [kind, setKind] = useState(initialKind);
  const [owners, setOwners] = useState<Set<string>>(new Set(initialOwners ?? []));
  const [plan, setPlan] = useState<Record<string, Custody>>({});
  const [preview, setPreview] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState("");
  const presets = store.data.settings.scopePresets ?? [];
  const list = kind === "company"
    ? store.data.companies.filter((c) => c.status !== "dissolved" && c.status !== "redomiciled").sort((a, b) => a.name.localeCompare(b.name, "zh")).map((c) => ({ id: c.id, name: c.name, sub: store.jurisdictionName(c.jurisdiction), configured: store.scopeConfigured(ref("company", c.id)) }))
    : store.data.people.slice().sort((a, b) => a.name.localeCompare(b.name, "zh")).map((p) => ({ id: p.id, name: p.name, sub: store.personHint(p.id), configured: store.scopeConfigured(ref("person", p.id)) }));
  const refs = [...owners].map((id) => ref(kind, id));
  // 条目：所选对象涉及的全部条目（模板建议 + 已有文件 + 已设置过的），没选对象时列出这一类的全部类型
  const types = useMemo(() => {
    const ids = new Map<string, number>();
    const add = (id: string) => ids.set(id, (ids.get(id) ?? 0) + 1);
    if (kind === "company") for (const id of owners) { const c = store.company(id); if (c) for (const i of store.archive(c)) add(i.typeID); }
    else for (const id of owners) for (const i of store.personArchive(id)) add(i.typeID);
    if (!ids.size) for (const t of store.data.library.documentTypes.filter((t) => t.owner === kind)) add(t.id);
    return [...ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => store.docType(id));
  }, [kind, owners, store.data]);
  const changes = refs.length ? store.scopeChanges(refs, plan) : [];
  // 所选对象现在的保管范围：一致时显示该值，不一致时写“各不相同”
  const currentOf = (typeID: string) => {
    if (!refs.length) return "—";
    const vals = new Set(refs.map((r) => (r.kind === "company" ? (store.company(r.id) ? store.archive(store.company(r.id)!) : []) : store.personArchive(r.id)).find((i) => i.typeID === typeID)?.custody ?? "pending"));
    return vals.size === 1 ? custodyLabel[[...vals][0]] : "各不相同";
  };
  const switchKind = (k: "company" | "person") => { setKind(k); setOwners(new Set()); setPlan({}); setPicked(new Set()); setPreview(false); };
  const savePreset = () => {
    const n = presetName.trim(); if (!n || !Object.keys(plan).length) return;
    store.saveSettings((s) => { s.scopePresets = [...(s.scopePresets ?? []).filter((p) => p.name !== n), { id: uuid(), name: n, kind, plan }]; });
    store.showToast(`已保存范围方案“${n}”。`); setPresetName("");
  };
  const apply = () => { store.applyScope(refs, plan); onClose(); };
  const toggleAll = (on: boolean) => setOwners(new Set(on ? list.map((x) => x.id) : []));
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="设置材料范围" width={980} height={760}
        subtitle="左边选对象，右边给条目定“由谁保管”，可以勾选多个条目一次设定。只有“我负责”的缺项才算缺件；中介保管单独计数；不在范围和不适用的不显示。"
        leading={<span className="t-meta muted">{refs.length ? `${refs.length} 个对象 × ${Object.keys(plan).length} 个条目 · 将改动 ${changes.length} 处` : "先在左边选对象"}</span>}
        trailing={<>
          <Button onClick={onClose}>取消</Button>
          {preview ? <><Button onClick={() => setPreview(false)}>返回修改</Button><Button kind="primary" disabled={!changes.length} onClick={apply}>应用 {changes.length} 处修改</Button></>
            : <Button kind="primary" disabled={!changes.length} onClick={() => setPreview(true)}>预览修改</Button>}
        </>}>
        {preview ? <ChangePreview changes={changes} /> : (
          <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
            <div className="col gap8" style={{ width: 320, flex: "none" }}>
              <div className="seg" style={{ alignSelf: "flex-start" }}>
                {(["company", "person"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} style={kind === k ? { background: "var(--seg-on)", color: "var(--seg-on-text)", boxShadow: "0 0 0 2px var(--green-soft-line)" } : undefined} onClick={() => switchKind(k)}>{k === "company" ? "公司" : "人员"}</button>)}
              </div>
              <div className="row gap8">
                <button className="link t-meta" onClick={() => toggleAll(true)}>全选</button>
                <button className="link t-meta" onClick={() => toggleAll(false)}>清除</button>
                <button className="link t-meta" onClick={() => setOwners(new Set(list.filter((x) => !x.configured).map((x) => x.id)))}>选未配置的</button>
              </div>
              <div className="col scroll card flush" style={{ maxHeight: 460, padding: 6 }}>
                {list.map((x) => (
                  <label key={x.id} className="row gap8" style={{ padding: "6px 8px", borderRadius: 10, cursor: "pointer" }}>
                    <Checkbox checked={owners.has(x.id)} onChange={(on) => setOwners((s) => { const n = new Set(s); if (on) n.add(x.id); else n.delete(x.id); return n; })} />
                    <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{x.name}</span><span className="t-meta muted ellipsis">{x.sub}</span></span>
                    {!x.configured && <Pill text="未配置" kind="neutral" />}
                  </label>
                ))}
              </div>
            </div>
            <div className="col gap12 grow" style={{ minWidth: 0 }}>
              <div className="row gap8 wrap">
                <span className="t-label">套用方案</span>
                <SelectField<string> minWidth={200} placeholder={presets.filter((p) => p.kind === kind).length ? "选择已保存的方案" : "还没有保存过方案"} value=""
                  options={presets.filter((p) => p.kind === kind).map((p) => [p.id, p.name] as [string, string])}
                  onChange={(id) => { const p = presets.find((x) => x.id === id); if (p) setPlan({ ...p.plan }); }} />
                <span className="spacer" />
                <TextField value={presetName} onChange={setPresetName} placeholder="方案名称，例如：远澜集团默认" width={220} />
                <Button size="small" disabled={!presetName.trim() || !Object.keys(plan).length} onClick={savePreset}>保存为方案</Button>
              </div>
              <div className="row gap10 wrap" style={{ padding: "8px 12px", borderRadius: 12, background: "var(--surface-sunken)" }}>
                <span className="t-meta" style={{ fontWeight: 700 }}>{picked.size ? `已勾选 ${picked.size} 个条目` : "勾选条目后可以一次设定"}</span>
                <SelectField<string> minWidth={170} disabled={!picked.size} placeholder="批量设为…" value="__none"
                  options={[...custodies.map((c) => [c, custodyLabel[c]] as [string, string]), ["keep", "本次不改"]]}
                  onChange={(c) => { setPlan((p) => { const n = { ...p }; for (const id of picked) { if (c !== "keep") n[id] = c as Custody; else delete n[id]; } return n; }); setPicked(new Set()); }} />
                <span className="spacer" />
                <span className="t-meta muted num">{refs.length ? `${refs.length} 个对象 × ${Object.keys(plan).length} 个条目，共改 ${changes.length} 处` : "先在左边选对象"}</span>
              </div>
              <div className="card flush scroll" style={{ maxHeight: 470 }}>
                <table className="table">
                  <thead><tr>
                    <th style={{ width: 36 }}><Checkbox checked={!!types.length && picked.size === types.length} onChange={(on) => setPicked(new Set(on ? types : []))} ariaLabel="勾选全部条目" /></th>
                    <th>条目</th><th>现在</th><th style={{ width: 200 }}>改为</th>
                  </tr></thead>
                  <tbody>
                    {types.map((id) => {
                      const cur = currentOf(id), name = store.docType(id)?.name ?? id;
                      return (
                        <tr key={id}>
                          <td><Checkbox checked={picked.has(id)} onChange={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; })} ariaLabel={`勾选 ${name}`} /></td>
                          <td><span className="col"><span style={{ fontWeight: 600 }}>{name}</span><span className="t-meta muted">{store.docType(id)?.category}</span></span></td>
                          <td><span className="t-meta muted">{cur}</span></td>
                          <td><SelectField<string> minWidth={180} value={plan[id] ?? ""} ariaLabel={`${name}：由谁保管`}
                            options={[["", "本次不改"], ...custodies.map((c) => [c, custodyLabel[c]] as [string, string])]}
                            onChange={(c) => setPlan((p) => { const n = { ...p }; if (c) n[id] = c as Custody; else delete n[id]; return n; })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SheetScaffold>
    </Modal>
  );
}

function ChangePreview({ changes }: { changes: { owner: NodeRef; typeID: string; from: Custody; to: Custody }[] }) {
  const { store } = useApp();
  const byOwner = new Map<string, typeof changes>();
  for (const c of changes) byOwner.set(refKey(c.owner), [...(byOwner.get(refKey(c.owner)) ?? []), c]);
  return (
    <div className="col gap12">
      <div className="info-note"><Icon name="info.circle" size={18} /><p>下面是将要写入的修改。应用后可以在提示条里一键撤销，也可以在设置 → 备份与恢复回到之前的快照。文件本身不会被移动或删除。</p></div>
      {[...byOwner.entries()].map(([k, list]) => (
        <div key={k} className="card" style={{ padding: 16, gap: 6 }}>
          <span className="t-row">{store.nameOf(list[0].owner)}</span>
          {list.map((c) => <span key={c.typeID} className="row gap8 t-meta"><span className="grow">{store.docType(c.typeID)?.name}</span><span className="muted">{custodyLabel[c.from]}</span><Icon name="arrow.right" size={11} /><b>{custodyLabel[c.to]}</b></span>)}
        </div>
      ))}
    </div>
  );
}

export { archiveItemName };
