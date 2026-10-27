// 5.3 证据链：一份文件可以同时证明多家公司、多个人、多个具体任职和持股。
// 每条关联写证据类型、可选页码和备注；来源路径只作记录。

import { useState } from "react";
import { type Document, type EvidenceKind, type EvidenceLink, type EvidenceTarget, evidenceKindLabel, evidenceKinds } from "../domain/models";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Button, Modal, SelectField, SheetScaffold } from "../ui/kit";

const targetLabel: Record<EvidenceTarget, string> = { company: "公司", person: "人员", appointment: "任职", holding: "持股" };
const defaultKind = (t: EvidenceTarget, typeID: string): EvidenceKind =>
  t === "appointment" ? "appointment" : t === "holding" ? "shareholding"
    : typeID === "common.passport" || typeID === "person.idcard" ? "identity" : typeID === "common.address" ? "address" : typeID === "person.kyc" ? "kyc" : "other";

/** 文件行上的关联摘要：最多两条，其余写“另 n 条”。 */
export function LinkChips({ doc, onEdit }: { doc: Document; onEdit: () => void }) {
  const { store } = useApp();
  const links = store.linksOf(doc);
  return (
    <button className="row gap4" style={{ minWidth: 0, maxWidth: 260, flexWrap: "nowrap", flexShrink: 1 }} title="证据关联：这份文件还证明了哪些公司、人、任职或持股" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
      {links.length ? <>
        {links.slice(0, 2).map((l, i) => <span key={i} className="v4-chip btnlike" style={{ maxWidth: 140, minWidth: 0, flexShrink: 1 }}><Icon name={l.target === "person" ? "users" : l.target === "company" ? "building.2" : "arrow.triangle.branch"} size={10} />{store.evidenceTargetName(l)}</span>)}
        {links.length > 2 && <span className="t-meta muted" style={{ whiteSpace: "nowrap", flex: "none" }}>另 {links.length - 2} 条</span>}
      </> : <span className="v4-chip btnlike" style={{ color: "var(--muted)" }}><Icon name="plus" size={10} />关联</span>}
    </button>
  );
}

export function EvidenceSheet({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const { store } = useApp();
  const [links, setLinks] = useState<EvidenceLink[]>(() => store.linksOf(doc).map((l) => ({ ...l })));
  const [adding, setAdding] = useState<EvidenceTarget | null>(null);
  const [q, setQ] = useState("");
  const options = (t: EvidenceTarget): { id: string; name: string }[] => {
    const ql = q.trim().toLowerCase();
    const raw = t === "company" ? store.data.companies.map((c) => ({ id: c.id, name: `${c.jurisdiction} ${c.name}` }))
      : t === "person" ? store.data.people.map((p) => ({ id: p.id, name: p.name }))
        : t === "appointment" ? store.data.appointments.map((a) => ({ id: a.id, name: store.evidenceTargetName({ target: "appointment", id: a.id, kind: "appointment" }) }))
          : store.data.holdings.map((h) => ({ id: h.id, name: store.evidenceTargetName({ target: "holding", id: h.id, kind: "shareholding" }) }));
    return raw.filter((o) => !links.some((l) => l.target === t && l.id === o.id) && !(doc.owner.kind === t && doc.owner.id === o.id) && (!ql || o.name.toLowerCase().includes(ql))).slice(0, 30);
  };
  const save = () => {
    // 股权、任职上的“核实依据”指向这份文件时，那条关联由核实记录维护；这里只保存文件自己的关联
    const own = links.filter((l) => !((l.target === "holding" && store.data.holdings.find((h) => h.id === l.id)?.evidence?.documentID === doc.id)
      || (l.target === "appointment" && store.data.appointments.find((a) => a.id === l.id)?.evidence?.documentID === doc.id)));
    store.setLinks(doc.id, own);
    store.showToast(`已保存 ${links.length} 条证据关联。`);
    onClose();
  };
  const t = store.docType(doc.typeID);
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="证据关联" width={720} height={720}
        subtitle={`${t?.name ?? "文件"} · ${store.nameOf(doc.owner)}。这份文件除了属于${doc.owner.kind === "company" ? "这家公司" : "这个人"}，还能证明哪些公司、人、任职或持股。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={save}>保存</Button></>}>
        <div className="col gap16">
          {doc.sourcePath && <span className="t-meta muted">来源：<span className="mono selectable">{doc.sourcePath}</span></span>}
          <div className="card flush">
            {!links.length && <div className="muted" style={{ padding: 18 }}>还没有关联。例如：一份合并 KYC 可以同时关联几位董事；一份董事会决议可以关联几项任职。</div>}
            {links.map((l, i) => (
              <div key={l.target + l.id} className="list-row" style={{ alignItems: "center" }}>
                <span className="pill neutral">{targetLabel[l.target]}</span>
                <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{store.evidenceTargetName(l)}</span></span>
                <SelectField<EvidenceKind> minWidth={130} value={l.kind} options={evidenceKinds.map((k) => [k, evidenceKindLabel[k]] as [EvidenceKind, string])}
                  onChange={(k) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, kind: k } : x)))} />
                <input className="field" style={{ width: 80 }} placeholder="页码" value={l.page ?? ""} aria-label="页码"
                  onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, page: e.target.value || undefined } : x)))} />
                <button className="v4-x" aria-label="移除这条关联" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}><Icon name="xmark" size={11} /></button>
              </div>
            ))}
          </div>
          <div className="col gap8">
            <span className="row gap8"><span className="t-label">添加关联</span>
              {(["company", "person", "appointment", "holding"] as EvidenceTarget[]).map((x) => <Button key={x} size="small" kind={adding === x ? "primary" : "secondary"} onClick={() => { setAdding(adding === x ? null : x); setQ(""); }}>{targetLabel[x]}</Button>)}
            </span>
            {adding && <div className="card" style={{ padding: 10, gap: 6 }}>
              <input className="field" autoFocus placeholder={`搜索${targetLabel[adding]}…`} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="col scroll" style={{ maxHeight: 240 }}>
                {options(adding).map((o) => <button key={o.id} className="v4-opt" onClick={() => setLinks((ls) => [...ls, { target: adding, id: o.id, kind: defaultKind(adding, doc.typeID) }])}><span className="ellipsis grow">{o.name}</span><Icon name="plus" size={12} /></button>)}
                {!options(adding).length && <span className="t-meta muted" style={{ padding: 8 }}>没有可选的。</span>}
              </div>
            </div>}
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

/** 某家公司或某个人的“其他文件里的证据”：经证据链关联过来的文件（不含自己名下的）。 */
export function EvidenceList({ target, id, title = "相关证据" }: { target: "company" | "person"; id: string; title?: string }) {
  const { store, router } = useApp();
  const [editing, setEditing] = useState<Document | null>(null);
  const rows = store.evidenceFor(target, id);
  if (!rows.length) return null;
  const byDoc = new Map<string, { doc: Document; links: EvidenceLink[] }>();
  for (const r of rows) { const x = byDoc.get(r.doc.id) ?? { doc: r.doc, links: [] }; x.links.push(r.link); byDoc.set(r.doc.id, x); }
  return (
    <section className="card">
      <div className="card-head"><h2 className="t-card">{title}</h2><span className="t-meta muted">{byDoc.size} 份文件</span></div>
      <div className="col">
        {[...byDoc.values()].map(({ doc, links }) => (
          <div key={doc.id} className="doc-row">
            <span className="doc-ic"><Icon name="doc.text" size={15} /></span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 700 }}>{store.docType(doc.typeID)?.name ?? "文件"}<span className="t-meta muted" style={{ fontWeight: 400 }}>　{store.nameOf(doc.owner)} 名下</span></span>
              <span className="t-meta muted ellipsis">{links.map((l) => `${evidenceKindLabel[l.kind]}：${store.evidenceTargetName(l)}${l.page ? `（第 ${l.page} 页）` : ""}`).join("；")}</span>
            </span>
            <Button size="small" kind="quiet" onClick={() => setEditing(doc)}>关联</Button>
            <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: doc.id })}>查看</Button>
          </div>
        ))}
      </div>
      {editing && <EvidenceSheet doc={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
