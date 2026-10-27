// 5.3 文件生命周期界面：移到废纸篓前的影响范围、待整理队列、废纸篓。

import { useEffect, useMemo, useState } from "react";
import * as D from "../domain/day";
import { type InboxCategory, type InboxItem, type NodeRef, type TrashEntry, inboxCategoryLabel, ref, trashKeepDays } from "../domain/models";
import { useApp } from "../state/hooks";
import { addToInbox, deletionImpact, processInbox, purgeTrash, resolveTarget, restoreTrash, trashDocuments, trashInbox, updateInbox } from "../state/lifecycle";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Card, Checkbox, ConfirmSheet, EmptyStateView, Modal, Pill, SelectField, SheetScaffold } from "../ui/kit";

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

// MARK: - 移到废纸篓（先看影响范围）

export function TrashConfirmSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { store } = useApp();
  const docs = store.data.documents.filter((d) => ids.includes(d.id));
  const [busy, setBusy] = useState(false);
  if (!docs.length) return null;
  const im = deletionImpact(store, docs);
  const go = async () => {
    setBusy(true);
    try {
      const entries = await trashDocuments(store, docs);
      store.showToast(`已移到废纸篓：${docs.length} 份。${trashKeepDays} 天内可以恢复。`, () => void restoreTrash(store, entries.map((e) => e.id)).then((n) => store.showToast(`已恢复 ${n} 份。`)), "撤销");
      onClose();
    } catch (e) { store.setError(`没有移动任何文件：${err(e)}`); setBusy(false); }
  };
  const one = docs.length === 1 ? docs[0] : undefined;
  const line = (icon: string, title: string, body: string, tone?: string) => (
    <div className="row start gap12" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <span className="doc-ic" style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone}-text)` } : undefined}><Icon name={icon} size={15} /></span>
      <span className="col grow" style={{ minWidth: 0 }}><span className="t-row">{title}</span><span className="t-meta muted" style={{ overflowWrap: "anywhere" }}>{body}</span></span>
    </div>
  );
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={one ? `把“${store.docType(one.typeID)?.name ?? "文件"}”移到废纸篓？` : `把 ${docs.length} 份文件移到废纸篓？`} width={600}
        subtitle="先看清会影响什么。移到废纸篓后 30 天内可以原样恢复。"
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="danger" disabled={busy} onClick={() => void go()}>{busy ? "正在移动…" : "移到废纸篓"}</Button></>}>
        <div className="col">
          {line("folder", "Charter 里的副本", `移到数据文件夹的 trash/，${trashKeepDays} 天后自动清除。${one ? `现在的位置：${one.filePath}` : `共 ${docs.length} 份。`}`, "amber")}
          {line("checkmark.shield", "你原来的文件（例如 iCloud 里的原件）", `不受影响。Charter 归档时复制了一份，从不移动或删除原件。${one?.sourcePath ? `原件位置：${one.sourcePath}` : ""}`, "green")}
          {line("clock.arrow.circlepath", "版本历史", im.promoted.length ? `${im.promoted.length} 个旧版本会变回现行：${im.promoted.map((d) => d.issueDate ?? d.addedOn).join("、")}。恢复时会改回来。` : "没有被它替代的旧版本。")}
          {line("arrow.triangle.branch", "关联记录", [im.links ? `${im.links} 条证据关联随文件一起移走` : "", im.evidence.length ? `${im.evidence.length} 条股权或任职的核实依据会清空并改为待核实（恢复时放回）：${im.evidence.slice(0, 3).join("；")}${im.evidence.length > 3 ? "…" : ""}` : ""].filter(Boolean).join("；") || "没有关联记录。", im.evidence.length ? "amber" : undefined)}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 待整理

const categories: InboxCategory[] = ["company", "person", "evidence", "irrelevant"];

export function InboxPane() {
  const { store, router } = useApp();
  const items = store.data.inbox;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyDup, setOnlyDup] = useState(false);
  const shown = items.filter((i) => !onlyDup || i.duplicateOf);
  const all = shown.length > 0 && shown.every((i) => sel.has(i.id));
  const selected = items.filter((i) => sel.has(i.id));
  const add = async () => {
    const paths = await platform().pickFiles({ multiple: true, extensions: ["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"], title: "加入待整理" });
    if (!paths.length) return;
    setBusy("正在加入…");
    try { const r = await addToInbox(store, paths, setBusy); store.showToast(`已加入待整理 ${r.added} 份${r.duplicates ? `，其中 ${r.duplicates} 份和已有文件重复` : ""}。`); }
    catch (e) { store.setError(`加入待整理失败：${err(e)}`); }
    finally { setBusy(null); }
  };
  const process = async (ids: string[]) => {
    setBusy("正在归档…");
    try {
      const r = await processInbox(store, ids);
      store.showToast([r.archived.length ? `已归档 ${r.archived.length} 份` : "", r.trashed ? `${r.trashed} 份无关文件移到废纸篓` : "", r.skipped ? `${r.skipped} 份还缺信息，留在待整理` : ""].filter(Boolean).join("，") + "。");
      setSel(new Set());
    } catch (e) { store.setError(`归档没有完成，待整理里的文件都还在：${err(e)}`); }
    finally { setBusy(null); }
  };
  const toTrash = async (list: InboxItem[]) => {
    const entries = await trashInbox(store, list);
    store.showToast(`已移到废纸篓 ${entries.length} 份。`, () => void restoreTrash(store, entries.map((e) => e.id)), "撤销");
    setSel(new Set());
  };
  const ready = items.filter((i) => resolveTarget(store, i).req || resolveTarget(store, i).category === "irrelevant");
  return (
    <div className="col gap16">
      <span className="row gap6 t-meta muted" title="文字识别、去重和分类建议都在这台电脑上完成，不联网、不上传。无关文件进废纸篓，30 天内可恢复。"><Icon name="lock.circle" size={13} />分好类再进正式档案。识别都在这台电脑上完成，不联网。</span>
      {!items.length && busy && <span className="busy-chip" role="status"><span className="ring" />{busy}</span>}
      {items.length > 0 && <div className="toolbar">
        <Button icon="square.and.arrow.down" onClick={() => void add()}>加入更多…</Button>
        {busy && <span className="busy-chip" role="status"><span className="ring" />{busy}</span>}
        <span className="spacer" />
        {items.some((i) => i.duplicateOf) && <button className={`v4-toggle ${onlyDup ? "on" : ""}`} onClick={() => setOnlyDup(!onlyDup)}>只看重复 · {items.filter((i) => i.duplicateOf).length}</button>}
        {ready.length > 0 && <Button kind="primary" onClick={() => void process(ready.map((i) => i.id))}>按当前分类处理可处理的 {ready.length} 份</Button>}
      </div>}
      {selected.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b>已选 {selected.length} 份</b>
          <span className="t-meta muted">归为</span>
          {categories.map((c) => <Button key={c} size="small" onClick={() => updateInbox(store, selected.map((i) => i.id), { category: c })}>{inboxCategoryLabel[c]}</Button>)}
          <OwnerPicker kind={selected.every((i) => (i.chosen?.category ?? i.category) === "company") ? "company" : "person"} onPick={(o) => updateInbox(store, selected.map((i) => i.id), { owner: o })} />
          <span className="spacer" />
          <Button size="small" kind="danger" onClick={() => void toTrash(selected)}>移到废纸篓</Button>
          <Button size="small" onClick={() => void process(selected.map((i) => i.id))}>归档所选</Button>
        </div>
      )}
      {!items.length ? <Card><EmptyStateView symbol="tray.and.arrow.down" title="待整理是空的" message="把一批来源材料拖进窗口，或点“加入待整理”。Charter 会先放在这里，等你分好类再归档。" actionTitle="加入待整理…" action={() => void add()} /></Card> : (
        <div className="card flush" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr>
              <th style={{ width: 40 }}><Checkbox checked={all} onChange={(on) => setSel(new Set(on ? shown.map((i) => i.id) : []))} /></th>
              <th>文件</th><th>识别到</th><th>分类</th><th>归到</th><th>可信度</th>
            </tr></thead>
            <tbody>{shown.map((i) => <InboxRow key={i.id} i={i} selected={sel.has(i.id)} onToggle={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />)}</tbody>
          </table>
        </div>
      )}
      {items.length > 0 && <span className="t-meta muted">需要新建公司的材料，可以选中后用“导入向导”处理：<button className="link" onClick={() => router.startImport(selected.map((i) => store.folder.abs(i.path)), null)}>用导入向导打开所选</button></span>}
    </div>
  );
}

function OwnerPicker({ kind, onPick }: { kind: "company" | "person"; onPick: (o: NodeRef) => void }) {
  const { store } = useApp();
  const opts = kind === "company" ? store.data.companies.map((c) => [c.id, `${c.jurisdiction} ${c.name}`] as [string, string]) : store.data.people.map((p) => [p.id, p.name] as [string, string]);
  return <SelectField<string> minWidth={200} placeholder={kind === "company" ? "归到公司…" : "归到人员…"} value="" options={opts} onChange={(id) => onPick(ref(kind, id))} />;
}

function InboxRow({ i, selected, onToggle }: { i: InboxItem; selected: boolean; onToggle: () => void }) {
  const { store } = useApp();
  const cat = i.chosen?.category ?? i.category;
  const target = resolveTarget(store, i);
  const owner = target.req?.owner;
  const typeID = i.chosen?.typeID ?? i.typeID;
  const ownerKind = cat === "company" ? "company" : "person";
  const ownerOpts = ownerKind === "company" ? store.data.companies.map((c) => [c.id, `${c.jurisdiction} ${c.name}`] as [string, string]) : store.data.people.map((p) => [p.id, p.name] as [string, string]);
  const typeOpts = store.data.library.documentTypes.filter((t) => t.owner === ownerKind).map((t) => [t.id, t.name] as [string, string]);
  const conf = Math.round(i.confidence * 100);
  return (
    <tr aria-selected={selected}>
      <td><Checkbox checked={selected} onChange={onToggle} /></td>
      <td>
        <span className="col" style={{ minWidth: 0, maxWidth: 260 }}>
          <button className="ellipsis" style={{ fontWeight: 700, textAlign: "left" }} title="打开这份文件" onClick={() => void platform().openPath(store.folder.abs(i.path))}>{i.fileName}</button>
          <span className="t-meta muted ellipsis" title={i.sourcePath}>{(i.size / 1024).toFixed(0)} KB · {i.addedOn}</span>
          {i.duplicateOf && <span><Pill text={i.duplicateOf.startsWith("document:") ? "已归档过" : "队列里重复"} kind="warn" /></span>}
        </span>
      </td>
      <td>
        <span className="col t-meta" style={{ maxWidth: 240 }}>
          {i.companyID && <span className="ellipsis">公司：{store.company(i.companyID)?.name}</span>}
          {!i.companyID && i.companyNameGuess && <span className="ellipsis muted">公司名：{i.companyNameGuess}（不在档案里）</span>}
          {i.personIDs?.length ? <span className="ellipsis">人员：{i.personIDs.map((p) => store.person(p)?.name).join("、")}</span> : null}
          {i.typeID && <span className="ellipsis muted">类型：{store.docType(i.typeID)?.name}</span>}
          <span className="ellipsis muted" title={i.reasons.join("；")}>{i.reasons[0]}</span>
        </span>
      </td>
      <td><SelectField<string> minWidth={120} placeholder="未分类" value={cat ?? ""} options={categories.map((c) => [c, inboxCategoryLabel[c]] as [string, string])}
        onChange={(c) => updateInbox(store, [i.id], { category: c as InboxCategory, owner: undefined })} /></td>
      <td>
        {cat && cat !== "irrelevant" ? <span className="col gap6">
          <SelectField<string> minWidth={200} placeholder={ownerKind === "company" ? "选公司" : "选人员"} value={owner?.id ?? ""} options={ownerOpts}
            onChange={(id) => updateInbox(store, [i.id], { owner: ref(ownerKind, id) })} />
          {cat !== "evidence" && <SelectField<string> minWidth={200} placeholder="选文件类型" value={typeID && store.docType(typeID)?.owner === ownerKind ? typeID : ""} options={typeOpts}
            onChange={(t) => updateInbox(store, [i.id], { typeID: t })} />}
          {target.problem && <span className="t-meta amber-text">{target.problem}</span>}
        </span> : <span className="t-meta muted">{cat === "irrelevant" ? "处理时移到废纸篓" : "先分类"}</span>}
      </td>
      <td><Pill text={`${conf}%`} kind={conf >= 70 ? "valid" : conf >= 45 ? "warn" : "neutral"} title="本地识别的把握程度" /></td>
    </tr>
  );
}

// MARK: - 废纸篓

export function TrashPane() {
  const { store } = useApp();
  const list = [...store.data.trash].sort((a, b) => (a.trashedOn < b.trashedOn ? 1 : -1));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const days = (e: TrashEntry) => trashKeepDays - D.daysBetween(e.trashedOn, store.today);
  const restore = async (ids: string[]) => { try { const n = await restoreTrash(store, ids); store.showToast(`已恢复 ${n} 份，放回原来的位置。`); setSel(new Set()); } catch (e) { store.setError(`恢复失败：${err(e)}`); } };
  return (
    <div className="col gap16">
      <div className="info-note"><Icon name="info.circle" size={18} /><p>这里是 Charter 数据文件夹里的副本，移进来 {trashKeepDays} 天后自动清除。你原来的文件从来不在这里，也不会被删除。</p></div>
      <div className="toolbar">
        {sel.size > 0 && <Button kind="primary" onClick={() => void restore([...sel])}>恢复所选 {sel.size} 份</Button>}
        <span className="spacer" />
        {list.length > 0 && <Button kind="danger" onClick={() => setConfirm(true)}>清空废纸篓</Button>}
      </div>
      {!list.length ? <Card><EmptyStateView symbol="trash" title="废纸篓是空的" message="移到废纸篓的文件会在这里保留 30 天。" /></Card> : (
        <div className="card flush">
          {list.map((e) => (
            <div key={e.id} className="list-row">
              <Checkbox checked={sel.has(e.id)} onChange={(on) => setSel((s) => { const n = new Set(s); if (on) n.add(e.id); else n.delete(e.id); return n; })} />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ fontWeight: 700 }}>{e.kind === "document" ? `${store.docType(e.document!.typeID)?.name ?? "文件"} · ${store.nameOf(e.document!.owner)}` : `待整理：${e.inbox?.fileName}`}</span>
                <span className="t-meta muted ellipsis">{e.trashedOn} 移入 · 原位置 {e.originalPath}</span>
              </span>
              <Pill text={days(e) > 0 ? `${days(e)} 天后清除` : "今天清除"} kind={days(e) <= 3 ? "warn" : "neutral"} />
              <Button size="small" onClick={() => void restore([e.id])}>恢复</Button>
            </div>
          ))}
        </div>
      )}
      {confirm && <ConfirmSheet title="清空废纸篓？" message={`会永久删除 Charter 数据文件夹 trash/ 里的 ${list.length} 份副本，不能恢复。你原来的文件不受影响。`} confirmTitle="清空" destructive
        onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void purgeTrash(store, { all: true }).then((n) => store.showToast(`已清空 ${n} 份。`)); }} />}
    </div>
  );
}

/** 启动后清掉超过 30 天的废纸篓条目（每次打开一次）。 */
export function useTrashJanitor() {
  const { store } = useApp();
  const ready = !store.isLoading && !store.loadFailed;
  useEffect(() => { if (ready && store.data.trash.length) void purgeTrash(store).catch(() => undefined); }, [ready, store.folder.root]);
}

void useMemo;
