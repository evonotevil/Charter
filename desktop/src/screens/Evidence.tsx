// 5.3 证据链：一份文件可以同时证明多家公司、多个人、多个具体任职和持股。
// 每条关联写证据类型、可选页码和备注；来源路径只作记录。

import * as D from "../domain/day";
import { companyTint } from "../ui/uistyle";
import { useState } from "react";
import { type Document, type EvidenceKind, type EvidenceLink, type EvidenceTarget, evidenceKindLabel, evidenceKinds } from "../domain/models";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Avatar, Button, JurisdictionBadge, Modal, Pill, Segmented, SelectField, SheetScaffold } from "../ui/kit";
import "./people557.css";

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
  const { store, router } = useApp();
  const [initial] = useState<EvidenceLink[]>(() => store.linksOf(doc).map((l) => ({ ...l })));
  const [links, setLinks] = useState<EvidenceLink[]>(initial);
  const [adding, setAdding] = useState<EvidenceTarget>("company");
  const [q, setQ] = useState("");
  const [pendingOriginal, setPendingOriginal] = useState<EvidenceLink | null>(null);
  const locked = (l: EvidenceLink) => (l.target === "holding" && store.data.holdings.find((h) => h.id === l.id)?.evidence?.documentID === doc.id)
    || (l.target === "appointment" && store.data.appointments.find((a) => a.id === l.id)?.evidence?.documentID === doc.id);
  const comparable = (ls: EvidenceLink[]) => JSON.stringify(ls.map((l) => ({ ...l, page: l.page || undefined, note: l.note || undefined })));
  const dirty = comparable(links) !== comparable(initial);
  const options = (t: EvidenceTarget): { id: string; name: string; detail?: string; code?: string; avatar?: string; tintCompanyID?: string }[] => {
    const ql = q.trim().toLowerCase();
    // 5.4.2：辖区不拼进名字，单独显示徽章；搜索仍可按辖区代码匹配
    const raw: { id: string; name: string; detail?: string; code?: string; avatar?: string; tintCompanyID?: string }[] = t === "company" ? store.data.companies.map((c) => ({ id: c.id, name: c.name, detail: store.jurisdictionName(c.jurisdiction), code: c.jurisdiction, tintCompanyID: c.id }))
      : t === "person" ? store.data.people.map((p) => ({ id: p.id, name: p.name, detail: store.anchorCompanyName(p.id) || "未关联公司", avatar: p.name }))
        : t === "appointment" ? store.data.appointments.map((a) => ({ id: a.id, name: store.person(a.personID)?.name ?? "已删除的人员", detail: `${a.title} · ${store.company(a.companyID)?.name ?? "已删除的公司"}`, avatar: store.person(a.personID)?.name ?? "?" }))
          : store.data.holdings.map((h) => {
            const holder = store.nameOf(h.holder);
            const company = store.company(h.companyID);
            const holderCompany = h.holder.kind === "company" ? store.company(h.holder.id) : undefined;
            return { id: h.id, name: `${holder} 持有 ${company?.name ?? "已删除的公司"}`, detail: `${Number(h.percent.toFixed(2))}%${h.isNominee ? " · 名义持有" : ""}`, avatar: h.holder.kind === "person" ? holder : undefined, code: holderCompany?.jurisdiction, tintCompanyID: holderCompany?.id };
          });
    return raw.filter((o) => !(doc.owner.kind === t && doc.owner.id === o.id) && (!ql || `${o.name} ${o.detail ?? ""} ${o.code ?? ""}`.toLowerCase().includes(ql)));
  };
  const save = (after = onClose) => {
    // 股权、任职上的“核实依据”指向这份文件时，那条关联由核实记录维护；这里只保存文件自己的关联
    const own = links.filter((l) => !((l.target === "holding" && store.data.holdings.find((h) => h.id === l.id)?.evidence?.documentID === doc.id)
      || (l.target === "appointment" && store.data.appointments.find((a) => a.id === l.id)?.evidence?.documentID === doc.id)));
    store.setLinks(doc.id, own);
    store.showToast(`已保存 ${links.length} 条证据关联。`);
    after();
  };
  const toggle = (target: EvidenceTarget, id: string) => setLinks((ls) => {
    const found = ls.find((l) => l.target === target && l.id === id);
    if (found) return locked(found) ? ls : ls.filter((l) => !(l.target === target && l.id === id));
    return [...ls, { target, id, kind: defaultKind(target, doc.typeID) }];
  });
  const navigateOriginal = (l: EvidenceLink) => {
    const item = l.target === "holding" ? store.data.holdings.find((h) => h.id === l.id) : store.data.appointments.find((a) => a.id === l.id);
    if (!item) return;
    onClose();
    router.openCompany(item.companyID, 1, { target: l.target as "holding" | "appointment", id: l.id });
    store.showToast("已定位到原记录。");
  };
  const openOriginal = (l: EvidenceLink) => {
    if (dirty) setPendingOriginal(l);
    else navigateOriginal(l);
  };
  const t = store.docType(doc.typeID);
  return (
    <Modal onClose={onClose} dismissOnEscape={!pendingOriginal}>
      <SheetScaffold title="证据关联" width={720} height={720}
        subtitle={`${t?.name ?? "文件"} · ${store.nameOf(doc.owner)}。这份文件除了属于${doc.owner.kind === "company" ? "这家公司" : "这个人"}，还能证明哪些公司、人、任职或持股。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => save()}>保存</Button></>}>
        <div className="col gap16">
          {doc.sourcePath && <span className="t-meta muted">来源：<span className="mono selectable">{doc.sourcePath}</span></span>}
          <div className="card flush">
            {!links.length && <div className="muted" style={{ padding: 18 }}>还没有关联。例如：一份合并 KYC 可以同时关联几位董事；一份董事会决议可以关联几项任职。</div>}
            {links.map((l, i) => (
              <div key={l.target + l.id} className="list-row" style={{ alignItems: "center" }}>
                <span className="pill neutral">{targetLabel[l.target]}</span>
                <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{store.evidenceTargetName(l)}</span></span>
                {locked(l) ? <><Pill text="核实依据" kind="valid" /><Button size="small" kind="quiet" onClick={() => openOriginal(l)}>查看原记录</Button></> : <>
                  <SelectField<EvidenceKind> minWidth={130} value={l.kind} options={evidenceKinds.map((k) => [k, evidenceKindLabel[k]] as [EvidenceKind, string])}
                    onChange={(k) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, kind: k } : x)))} />
                  <input className="field" style={{ width: 80 }} placeholder="页码" value={l.page ?? ""} aria-label="页码"
                    onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, page: e.target.value || undefined } : x)))} />
                  <button className="v4-x" aria-label="移除这条关联" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}><Icon name="xmark" size={11} /></button>
                </>}
              </div>
            ))}
          </div>
          <div className="col gap8">
            <span className="t-label">添加关联</span>
            <Segmented<EvidenceTarget> ariaLabel="关联类型" className="seg-scroll" value={adding}
              onChange={(x) => { setAdding(x); setQ(""); }} options={(["company", "person", "appointment", "holding"] as EvidenceTarget[]).map((x) => [x, targetLabel[x]])} />
            <div className="card" style={{ padding: 10, gap: 6 }}>
              <label className="search evidence-search"><Icon name="magnifyingglass" size={14} />
                <input className="field" autoFocus placeholder={`搜索${targetLabel[adding]}…`} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <div className="col scroll" style={{ maxHeight: 240 }}>
                {options(adding).map((o) => { const selected = links.some((l) => l.target === adding && l.id === o.id); return <button key={o.id} className={`v4-opt evidence-option ${selected ? "evidence-selected" : ""}`} aria-pressed={selected} onClick={() => toggle(adding, o.id)}>
                  {o.code ? <JurisdictionBadge code={o.code} size={28} tint={o.tintCompanyID ? companyTint(store, o.tintCompanyID) : undefined} /> : o.avatar ? <Avatar name={o.avatar} size={28} /> : null}
                  <span className="col grow evidence-option-copy"><span className="ellipsis evidence-option-title">{o.name}</span>{o.detail && <span className="ellipsis t-meta muted">{o.detail}</span>}</span>
                  {selected && <Icon name="checkmark" size={12} />}
                </button>; })}
                {!options(adding).length && <span className="t-meta muted" style={{ padding: 8 }}>没有可选的。</span>}
              </div>
            </div>
          </div>
        </div>
      </SheetScaffold>
      {pendingOriginal && <EvidenceLeaveConfirm onStay={() => setPendingOriginal(null)}
        onDiscard={() => navigateOriginal(pendingOriginal)}
        onSave={() => save(() => navigateOriginal(pendingOriginal))} />}
    </Modal>
  );
}

function EvidenceLeaveConfirm({ onStay, onDiscard, onSave }: { onStay: () => void; onDiscard: () => void; onSave: () => void }) {
  return <Modal onClose={onStay}>
    <div className="sheet" style={{ width: 500, padding: 28, gap: 16 }}>
      <div className="t-sheet">查看原记录前，保存修改吗？</div>
      <div className="muted">你还有尚未保存的关联修改。可以先保存再前往原记录，也可以放弃这些修改。</div>
      <div className="row gap10"><span className="spacer" /><Button onClick={onStay}>留在这里</Button><Button onClick={onDiscard}>放弃并前往</Button><Button kind="primary" onClick={onSave}>保存并前往</Button></div>
    </div>
  </Modal>;
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
              <span className="row gap8" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 700 }}>{store.docType(doc.typeID)?.name ?? "文件"}<span className="t-meta muted" style={{ fontWeight: 400 }}>　{store.nameOf(doc.owner)} 名下</span></span>{doc.supersededBy && <Pill text="旧版" kind="warn" />}</span>
              {doc.supersededBy
                ? <span className="t-meta amber-text">已有新版（{(() => { const n = store.latestVersion(doc); return n.issueDate ? `${D.long(n.issueDate)}签发` : "日期未填"; })()}）。{links.map((l) => store.evidenceTargetName(l)).join("；")}仍以这份旧版为依据。</span>
                : <span className="t-meta muted ellipsis">{links.map((l) => `${evidenceKindLabel[l.kind]}：${store.evidenceTargetName(l)}${l.page ? `（第 ${l.page} 页）` : ""}`).join("；")}</span>}
            </span>
            {doc.supersededBy && <Button size="small" onClick={() => store.useLatestAsEvidence(doc)} title="把依据换成新版，保持“已核实”；如需重新核对，可在任职或持股详情里取消核实">改用新版作为依据</Button>}
            <Button size="small" kind="quiet" onClick={() => setEditing(doc)}>关联</Button>
            <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: doc.id })}>查看</Button>
          </div>
        ))}
      </div>
      {editing && <EvidenceSheet doc={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
