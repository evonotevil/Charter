// 文件页：按归属分组的现行文件，筛选、多选、导出 ZIP、继续未完成的导入。移植自 FilesView.swift。

import { companyTint } from "../ui/uistyle";
import { useEffect, useRef, useState } from "react";
import * as D from "../domain/day";
import { type Document, type NodeRef } from "../domain/models";
import { type Freshness, expiryLabel, expiryOf, freshnessLabel, freshnessNeedsAttention, freshnessRank } from "../domain/engine";
import { snapshotTitle } from "../domain/folder";
import { useApp } from "../state/hooks";
import { pendingRemaining } from "../state/store";
import { writeZip } from "../services/files";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Avatar, Button, EmptyStateView, JurisdictionBadge, type MenuEntry, Pill, Segmented, SelectField, divider, header, item, useContextMenu, PageHeader } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { FileThumb, ReissueRequestSheet, freshnessPill, useStageFile } from "./common";
import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";

interface Snap { d: Document; f: Freshness; owner: string; type: string; expiry?: D.Day }

export function FilesView() {
  const { store, router } = useApp();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [grid, setGridState] = useState(platform().prefGet("files.grid") === "1");
  const search = useRef<HTMLInputElement>(null);
  const setGrid = (g: boolean) => { setGridState(g); platform().prefSet("files.grid", g ? "1" : "0"); };
  const filter = router.filesFilter, horizon = router.filesHorizon, ownerKind = router.filesOwnerKind;

  const q = query.trim().toLowerCase();
  const scope = store.companyIDsForFilter(router.groupFilter);
  let scoped: Snap[] = store.data.documents.filter((d) => !d.supersededBy && (!ownerKind || d.owner.kind === ownerKind) && (d.owner.kind === "person" || !scope || scope.has(d.owner.id)))
    .map((d) => ({ d, f: store.freshness(d), owner: store.nameOf(d.owner), type: store.docType(d.typeID)?.name ?? "", expiry: expiryOf(d, store.docType(d.typeID)) }));
  if (q) scoped = scoped.filter((s) => s.type.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q) || s.d.originalFileName.toLowerCase().includes(q));
  let list = scoped;
  if (filter === 1) list = list.filter((s) => s.expiry && D.daysBetween(store.today, s.expiry) >= 0 && D.daysBetween(store.today, s.expiry) <= horizon).sort((a, b) => (a.expiry! < b.expiry! ? -1 : 1));
  else if (filter === 2) list = list.filter((s) => freshnessNeedsAttention(s.f) && (ownerKind != null || s.d.owner.kind === "company"));
  else if (filter === 3) list = list.filter((s) => { const n = D.daysBetween(s.d.addedOn, store.today); return n >= 0 && n <= 30; }).sort((a, b) => (a.d.addedOn < b.d.addedOn ? 1 : -1));
  if (filter === 0 || filter === 2) list = [...list].sort((a, b) => freshnessRank(a.f) - freshnessRank(b.f) || a.owner.localeCompare(b.owner, "zh"));
  const docs = list.map((s) => s.d);
  const groups = new Map<string, { owner: NodeRef; docs: Document[] }>();
  for (const d of docs) { const k = `${d.owner.kind}:${d.owner.id}`; if (!groups.has(k)) groups.set(k, { owner: d.owner, docs: [] }); groups.get(k)!.docs.push(d); }
  const grouped = [...groups.values()].sort((a, b) => {
    const ra = Math.min(...a.docs.map((d) => freshnessRank(store.freshness(d)))), rb = Math.min(...b.docs.map((d) => freshnessRank(store.freshness(d))));
    return ra - rb || store.nameOf(a.owner).localeCompare(store.nameOf(b.owner), "zh");
  });
  const attention = ownerKind === "person" ? store.attentionPersonalCount : store.attentionCount(router.groupFilter);
  const ordered = filter === 1 || filter === 3 ? docs : grouped.flatMap((g) => g.docs);
  const selectedDocs = ordered.filter((d) => selected.has(d.id));

  // Ctrl/⌘ A 全选、Esc 取消、Ctrl/⌘ F 搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (router.sheet) return;
      const editing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); return; }
      if (cmd && e.key.toLowerCase() === "a" && !editing && ordered.length) { e.preventDefault(); setSelected(new Set(ordered.map((d) => d.id))); setAnchor(ordered[0].id); return; }
      if (e.key === "Escape" && selected.size && !document.querySelector(".popover")) { setSelected(new Set()); setAnchor(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const click = (e: React.MouseEvent, id: string) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (e.shiftKey && anchor) {
      const i = ordered.findIndex((d) => d.id === anchor), j = ordered.findIndex((d) => d.id === id);
      if (i >= 0 && j >= 0) { const s = new Set(selected); for (const d of ordered.slice(Math.min(i, j), Math.max(i, j) + 1)) s.add(d.id); setSelected(s); return; }
    }
    if (cmd || e.shiftKey) { const s = new Set(selected); if (s.has(id)) s.delete(id); else s.add(id); setSelected(s); setAnchor(id); return; }
    setSelected(new Set()); setAnchor(id);
    router.open({ kind: "document", id });
  };
  const removeSelected = async (list: Document[]) => {
    if (!list.length) return;
    if (list.length > 1) await store.snapshotBeforeChange(`移除 ${list.length} 份文件记录前`);
    store.removeDocuments(new Set(list.map((d) => d.id)));
    setSelected(new Set()); setAnchor(null);
  };
  const revealLabel = platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示";
  const exportZIP = async (list: Document[]) => {
    const target = await platform().saveDialog({ defaultName: `Charter 文件 ${store.today}.zip`, extensions: ["zip"], title: "导出" });
    if (!target) return;
    const p = platform();
    const used = new Set<string>();
    const entries: { path: string; source: string }[] = [];
    for (const d of list) {
      const src = store.fileURL(d);
      if (!(await p.stat(src)).exists) continue;
      const name0 = src.split(/[\\/]/).pop()!;
      const dot = name0.lastIndexOf(".");
      let name = name0, n = 2;
      while (used.has(name)) { name = dot > 0 ? `${name0.slice(0, dot)} (${n})${name0.slice(dot)}` : `${name0} (${n})`; n++; }
      used.add(name);
      entries.push({ path: name, source: src });
    }
    const missing = list.length - entries.length;
    if (!entries.length) { store.setError("选中的文件在数据文件夹里都找不到了，无法导出。请检查数据文件夹的“文件”目录。"); return; }
    setExporting(true);
    try {
      const data = [];
      for (const e of entries) data.push({ path: e.path, data: await p.readBytes(e.source) });
      await p.writeBytes(target, await writeZip(data));
      store.showToast(`已导出 ${entries.length} 份文件到 ${target.split(/[\\/]/).pop()}${missing ? `，${missing} 份找不到原文件已跳过。` : "。"}`);
      void p.reveal(target);
    } catch (e) {
      try { await p.removeFile(target); } catch { /* 忽略 */ }
      store.setError(`导出 ZIP 失败：${(e instanceof Error ? e.message : String(e))}。请换一个保存位置再试。`);
    } finally { setExporting(false); }
  };
  const batchMenu = (id: string): MenuEntry[] | undefined => {
    if (!selected.has(id) || selected.size < 2) return undefined;
    const list = ordered.filter((d) => selected.has(d.id));
    return [header(`已选 ${list.length} 份`), item(`打开 ${list.length} 份`, "arrow.up.forward.app", () => list.forEach((d) => void store.openDocument(d))),
      item(`${revealLabel} ${list.length} 份`, "folder", () => list.forEach((d) => void store.revealDocument(d))),
      item("导出为 ZIP…", "archivebox", () => void exportZIP(list)), item(`从 Charter 移除 ${list.length} 份`, "trash", () => void removeSelected(list))];
  };

  const pending = store.pendingImport;
  const section = (title: string, owner: NodeRef | null, list: Document[]) => {
    const bad = list.filter((d) => freshnessNeedsAttention(store.freshness(d))).length;
    const c = owner?.kind === "company" ? store.company(owner.id) : undefined;
    return (
      <div key={owner ? `${owner.kind}:${owner.id}` : title} className="col gap12">
        <div className="row gap10">
          {owner ? <>
            {c ? <JurisdictionBadge code={c.jurisdiction} size={26} tint={companyTint(store, c.id)} /> : <Avatar name={title} size={26} />}
            <button className="row gap4" onClick={() => (owner.kind === "company" ? router.openCompany(owner.id) : router.openPerson(owner.id))}>
              <span className="t-card">{title}</span><Icon name="arrow.up.right" size={10} className="muted" />
            </button>
          </> : <span className="t-card">{title}</span>}
          <span className="t-meta muted">{list.length} 份</span>
          {bad > 0 && <Pill text={`${bad} 份需处理`} kind={list.some((d) => freshnessPill(store.freshness(d)) === "bad") ? "bad" : "warn"} />}
        </div>
        {grid ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 200px))", gap: 16 }}>
            {list.map((d) => <FileCard key={d.id} d={d} showOwner={!owner} selected={selected.has(d.id)} extraMenu={batchMenu(d.id)} onClick={(e) => click(e, d.id)} />)}
          </div>
        ) : (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="table files-table" aria-label={`${title}的文件`}>
              <colgroup>
                <col style={{ width: 52 }} />
                <col />
                {!owner && <col style={{ width: 220 }} />}
                <col style={{ width: 132 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 168 }} />
                <col style={{ width: 132 }} />
              </colgroup>
              <thead><tr><th style={{ width: 28 }} aria-label="选择" /><th>文件</th>{!owner && <th>归属</th>}<th>签发</th><th>到期</th><th>状态</th><th style={{ width: 120 }} aria-label="操作" /></tr></thead>
              <tbody>{list.map((d) => <FileTableRow key={d.id} d={d} showOwner={!owner} selected={selected.has(d.id)} extraMenu={batchMenu(d.id)} onSelect={(e) => click(e, d.id)}
                onToggle={() => { const s2 = new Set(selected); if (s2.has(d.id)) s2.delete(d.id); else s2.add(d.id); setSelected(s2); setAnchor(d.id); }} />)}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const empty = () => {
    if (q) return <EmptyStateView symbol="magnifyingglass" title={`没有找到“${query}”`} message="搜索范围已按当前集团和归属类型限制。" actionTitle="清除搜索" action={() => setQuery("")} />;
    if (!scoped.length) return <EmptyStateView symbol="doc.on.doc" title="当前范围没有文件" message="当前集团或归属类型下没有现行文件。" actionTitle="查看全部范围"
      action={() => router.update((r) => { r.groupFilter = null; r.filesOwnerKind = null; r.filesFilter = 0; })} />;
    return <EmptyStateView symbol={filter === 2 ? "checkmark.seal" : "doc.on.doc"} title={filter === 1 ? `未来 ${horizon} 天没有即将到期的文件` : filter === 2 ? "当前范围没有需要处理的文件" : "最近 30 天没有添加文件"}
      message={`当前范围内还有 ${scoped.length} 份现行文件。`} actionTitle="查看全部文件" action={() => router.set("filesFilter", 0)} />;
  };

  return (
    <DropTarget message="松开以开始识别" radius={20} onDrop={(paths) => router.startImport(paths, null)} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div className="page">
        <div className="page-inner" style={{ paddingBottom: selectedDocs.length ? 96 : undefined }}>
          <div className="col gap12">
            <PageHeader title="文件" scope={[ownerKind === "company" ? "公司文件" : ownerKind === "person" ? "个人文件" : "公司与人员", router.groupFilter ? store.filterName(router.groupFilter) : "", q ? `搜索“${query.trim()}”` : ""].filter(Boolean).join(" · ")} stats={[
              { label: "现行文件", value: scoped.length, unit: "份" },
              { label: "已过期", value: scoped.filter((x) => x.f.kind === "expired").length, unit: "份", tone: scoped.some((x) => x.f.kind === "expired") ? "bad" : undefined },
              { label: "需处理", value: attention, unit: "份", tone: attention ? "warn" : undefined, onClick: attention ? () => router.set("filesFilter", 2) : undefined },
              ...(ownerKind !== "person" ? [{ label: "缺件", value: store.missingSummary(router.groupFilter).items, unit: "项", tone: store.missingSummary(router.groupFilter).items ? "warn" as const : undefined }] : []),
            ]} subtitle={(docs.length === scoped.length ? `${scoped.length} 份现行文件` : `显示 ${docs.length} / ${scoped.length} 份`) + (attention ? `，${attention} 份需处理` : "，都在有效期内") + "。把 PDF、照片或文件夹拖进窗口即可导入。"}>
              <Button kind="primary" icon="square.and.arrow.down" title="选择 PDF、照片或文件夹；也可以直接拖进窗口" onClick={() => void router.chooseFiles(null)}>导入文件</Button>
            </PageHeader>
            <div className="row gap10 wrap">
              <span className="row gap6" title="按归属筛选：公司材料或个人材料"><span className="t-meta muted">范围</span>
                <SelectField options={[[0, "公司与人员"], [1, "公司文件"], [2, "个人文件"]]} value={ownerKind === "company" ? 1 : ownerKind === "person" ? 2 : 0}
                  onChange={(v) => router.set("filesOwnerKind", v === 1 ? "company" : v === 2 ? "person" : null)} minWidth={130} />
              </span>
              <Segmented options={[[0, "全部"], [1, "即将到期"], [2, `需处理 ${attention}`], [3, "最近添加"]]} value={filter} onChange={(v) => router.set("filesFilter", v)} />
              {filter === 1 && <Segmented options={[[30, "30 天"], [60, "60 天"], [90, "90 天"], [183, "半年"]]} value={horizon} onChange={(v) => router.set("filesHorizon", v)} />}
              <span className="spacer" />
              <label className="search" style={{ minWidth: 150, maxWidth: 260, flex: "1 1 150px" }} title="搜索文件（Ctrl/⌘ F）">
                <Icon name="magnifyingglass" size={14} />
                <input ref={search} className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索类型、公司、人员或文件名" />
              </label>
              <Segmented options={[[false, "列表"], [true, "缩略图"]]} value={grid} onChange={setGrid} />
            </div>
            {pending && !router.isImportOpen && (
              <div className="row gap12 card" style={{ padding: "12px 16px" }} aria-label={`上次导入还有 ${pendingRemaining(pending)} 份文件未完成`}>
                <span className="amber-text" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--band)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="tray.and.arrow.down" /></span>
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-row">上次导入还有 {pendingRemaining(pending)} 份文件未完成</span>
                  <span className="t-meta muted ellipsis">识别结果和你的修改都已保存（{snapshotTitle(pending.savedAt)}），继续时不需要重新识别。</span>
                </div>
                <Button kind="quiet" size="small" onClick={() => store.discardPendingImport()}>放弃</Button>
                <Button size="small" onClick={() => router.open({ kind: "resumeImport" })}>继续</Button>
              </div>
            )}
          </div>
          {!store.data.documents.length ? <div className="card"><EmptyStateView symbol="doc.on.doc" title="还没有文件" message="把 PDF、照片或按公司分好的文件夹拖进窗口，Charter 会识别类型、公司和日期，你确认后才归档。" actionTitle="导入文件" action={() => void router.chooseFiles(null)} /></div>
            : !docs.length ? <div className="card">{empty()}</div>
              : filter === 1 || filter === 3 ? section(filter === 1 ? "按到期日排列" : "最近 30 天添加", null, docs)
                : grouped.map((g) => section(store.nameOf(g.owner), g.owner, g.docs))}
        </div>
      </div>
      {selectedDocs.length > 0 && (
        <div className="row gap8 floating appear" style={{ position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", height: 48, padding: "0 10px", borderRadius: 999, zIndex: 4 }}>
          <span className="num" style={{ fontSize: 13, fontWeight: 600, padding: "0 4px 0 8px" }}>已选 {selectedDocs.length} 份</span>
          <Button kind="quiet" size="small" onClick={() => selectedDocs.forEach((d) => void store.openDocument(d))}>打开</Button>
          <Button kind="quiet" size="small" onClick={() => selectedDocs.forEach((d) => void store.revealDocument(d))}>{revealLabel}</Button>
          <Button size="small" onClick={() => void removeSelected(selectedDocs)}>从 Charter 移除</Button>
          <Button kind="primary" size="small" disabled={exporting} onClick={() => void exportZIP(selectedDocs)}>{exporting ? "正在导出…" : "导出为 ZIP…"}</Button>
          <span style={{ width: 1, height: 20, background: "var(--hairline)" }} />
          <button className="muted" style={{ width: 28, height: 28, display: "grid", placeItems: "center" }} title="取消选择（Esc）" aria-label="取消选择" onClick={() => { setSelected(new Set()); setAnchor(null); }}><Icon name="xmark" size={11} /></button>
        </div>
      )}
    </DropTarget>
  );
}

function FileCard({ d, showOwner, selected, extraMenu, onClick }: { d: Document; showOwner: boolean; selected: boolean; extraMenu?: MenuEntry[]; onClick: (e: React.MouseEvent) => void }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const [startStage, stageNode] = useStageFile();
  const [reissue, setReissue] = useState(false);
  const f = store.freshness(d);
  const menu: MenuEntry[] = [
    ...(extraMenu ? [...extraMenu, divider] : []),
    item("打开", undefined, () => void store.openDocument(d)),
    item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", undefined, () => void store.revealDocument(d)),
    item("归档新版…", undefined, () => void startStage({ typeID: d.typeID, owner: d.owner, replaces: d, form: d.form, onArchived: (n) => router.open({ kind: "document", id: n.id }) })),
    divider,
    item("从 Charter 移除记录", undefined, () => store.deleteDocument(d), { destructive: true }),
  ];
  return (
    <button className="col gap12 file-card" onClick={onClick} onContextMenu={(e) => ctx.open(e, menu)} title={d.originalFileName} aria-label={`${store.docType(d.typeID)?.name ?? "文件"}，${freshnessLabel(f)}`} aria-pressed={selected}
      style={{ padding: 12, borderRadius: "var(--r-tile)", background: "var(--surface)", textAlign: "left", position: "relative", borderColor: selected ? "var(--green)" : undefined }}>
      <span className="thumb" style={{ height: 172, borderRadius: "var(--r-control)", background: "var(--surface-sunken)", display: "grid", placeItems: "center", width: "100%" }}>
        <FileThumb doc={d} alert={freshnessPill(f) === "bad"} width={120} height={150} />
      </span>
      <span className="col" style={{ gap: 2, minWidth: 0, width: "100%" }}>
        <span className="t-row ellipsis">{store.docType(d.typeID)?.name ?? "文件"}</span>
        <span className="t-micro muted ellipsis">{showOwner ? store.nameOf(d.owner) : d.issueDate ? `${D.long(d.issueDate)}签发` : "缺少签发日期"}</span>
      </span>
      <span className="row"><Pill text={freshnessLabel(f)} kind={freshnessPill(f)} /></span>
      {selected && <span style={{ position: "absolute", top: 16, right: 16 }}><Icon name="checkmark.circle.fill" size={18} /></span>}
      {ctx.node}{stageNode}
      {reissue && <ReissueRequestSheet owner={d.owner} typeIDs={[d.typeID]} onClose={() => setReissue(false)} />}
    </button>
  );
}

/** 文件表的一行：具体文件名优先；类型、同类第几份在第二行；来源路径和校验值放在详情里。 */
function FileTableRow({ d, showOwner, selected, extraMenu, onSelect, onToggle }: { d: Document; showOwner: boolean; selected: boolean; extraMenu?: MenuEntry[]; onSelect: (e: React.MouseEvent) => void; onToggle: () => void }) {
  const { store, router } = useApp();
  const ctx = useContextMenu();
  const [startStage, stageNode] = useStageFile();
  const t = store.docType(d.typeID);
  const f = store.freshness(d);
  const st = statusOfFreshness(f);
  const expiry = expiryLabel(d, t);
  const same = store.data.documents.filter((x) => !x.supersededBy && x.typeID === d.typeID && x.owner.kind === d.owner.kind && x.owner.id === d.owner.id);
  const older = store.data.documents.filter((x) => x.supersededBy === d.id).length;
  const c = d.owner.kind === "company" ? store.company(d.owner.id) : undefined;
  const fileName = /^[0-9A-F-]{36}\.[a-z]+$/i.test(d.originalFileName) ? "（无原始文件名）" : d.originalFileName;
  const sub = [t?.name ?? "未知类型", same.length > 1 ? `同类 ${same.indexOf(d) + 1}/${same.length} 份` : "", older ? `替代了 ${older} 个旧版` : "", d.notes].filter(Boolean).join(" · ");
  const upload = () => void startStage({ typeID: d.typeID, owner: d.owner, replaces: d, form: d.form, onArchived: (n) => router.open({ kind: "document", id: n.id }) });
  const menu: MenuEntry[] = [
    ...(extraMenu ? [...extraMenu, divider] : []),
    item("打开", "arrow.up.forward.app", () => void store.openDocument(d)),
    item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", "folder", () => void store.revealDocument(d)),
    item("归档新版…", "square.and.arrow.up", upload),
    divider,
    item("从 Charter 移除记录", "trash", () => store.deleteDocument(d), { destructive: true }),
  ];
  return (
    <tr className={selected ? "sel" : ""} tabIndex={0} onClick={onSelect} onContextMenu={(e) => ctx.open(e, menu)} aria-selected={selected}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.open({ kind: "document", id: d.id }); if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); onToggle(); } }}>
      <td onClick={(e) => { e.stopPropagation(); onToggle(); }}><span className={`mark sq ${selected ? "on" : ""}`} role="checkbox" aria-checked={selected} aria-label="选择">{selected && <Icon name="checkmark" size={10} strokeWidth={3.5} />}</span></td>
      <td><div className="col" style={{ minWidth: 0, gap: 1 }}><span className="fname name-1" title={d.originalFileName}>{fileName}</span><span className="t-meta muted name-1" title={sub}>{sub}</span></div></td>
      {showOwner && <td className="owner"><span className="row gap6" style={{ minWidth: 0 }}>{c && <span className="v4-code" style={{ width: 24, height: 20, fontSize: 9.5, borderRadius: 6, ...companyTint(store, c.id) }}>{c.jurisdiction}</span>}<span className="name-1" title={store.nameOf(d.owner)}>{store.nameOf(d.owner)}</span></span></td>}
      <td className="date mono">{d.issueDate ?? <span className="missing-val">未填</span>}</td>
      <td className="date mono" style={{ color: f.kind === "expired" ? "var(--risk-bad)" : undefined }}>{expiry === "长期" ? <span className="muted">长期</span> : expiry === "未填日期" ? <span className="missing-val">未填日期</span> : expiry}</td>
      <td><span className="row gap4" style={{ flexWrap: "nowrap" }}><StatusTag s={st} /><ExtraTags d={d} t={t} /></span></td>
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
        {f.kind === "unknown" ? <Button size="small" onClick={() => router.open({ kind: "document", id: d.id })}>补日期</Button>
          : freshnessNeedsAttention(f) ? <Button size="small" onClick={upload} title="类型和归属沿用这份，旧版保留">归档新版</Button>
            : <Button size="small" kind="quiet" onClick={() => void store.openDocument(d)}>打开</Button>}
        {ctx.node}{stageNode}
      </td>
    </tr>
  );
}
