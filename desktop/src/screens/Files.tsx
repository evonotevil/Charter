// 文件页：按归属分组的现行文件，筛选、多选、导出 ZIP、继续未完成的导入。移植自 FilesView.swift。

import { companyTint } from "../ui/uistyle";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as D from "../domain/day";
import { type Document, type DocumentType, type NodeRef } from "../domain/models";
import { type Freshness, expiryOf, freshnessLabel, freshnessNeedsAttention, freshnessRank } from "../domain/engine";
import { snapshotTitle } from "../domain/folder";
import { useApp, useAppContext } from "../state/hooks";
import { pendingRemaining } from "../state/store";
import { writeZip } from "../services/files";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { InboxPane, TrashPane } from "./Lifecycle";
import { hasActiveModal, Tabs, Avatar, Button, Checkbox, EmptyStateView, JurisdictionBadge, type MenuEntry, Pill, Segmented, divider, header, item, useContextMenu, PageHeader } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { FileThumb, batchOpen, clearThumbCache, openEntries, ReissueRequestSheet, freshnessPill, useStageFile } from "./common";
import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";
import { DeferredFiles, useFileViewport } from "./DeferredFiles";
import { FilesOwnerPicker, type FilesOwnerOption } from "./FilesOwnerPicker";
import { chooseFilesScope, isBroadScope, ownerKey, setFilesGroupsOpen, type FilesBrowseView, type FilesScope } from "../state/filesBrowse";
import "./files558.css";

interface Snap { d: Document; f: Freshness; owner: string; type?: DocumentType; expiry?: D.Day }

type FSort = "status" | "type" | "issue" | "expiry";
const rowsPerChunk = 12;

function sortDocs(list: Snap[], fsort: FSort) {
  if (fsort === "status") return list;
  return [...list].sort((a, b) => {
    if (fsort === "type") return (a.type?.name ?? "").localeCompare(b.type?.name ?? "", "zh") || (b.d.issueDate ?? "").localeCompare(a.d.issueDate ?? "");
    const ka = fsort === "issue" ? a.d.issueDate : a.expiry, kb = fsort === "issue" ? b.d.issueDate : b.expiry;
    return (kb ?? "").localeCompare(ka ?? "");
  });
}

export function FilesView() {
  const { store, router } = useApp();
  if (router.filesPane !== "files") return <FilesSubPage />;
  return <DocumentsView />;
}

function FilesTabs({ count }: { count: number }) {
  const { store, router } = useApp();
  return <Tabs<"files" | "inbox" | "trash"> value={router.filesPane} onChange={(v) => router.set("filesPane", v)}
    tabs={[["files", "文件", count], ["inbox", "待整理", store.data.inbox.length], ["trash", "废纸篓", store.data.trash.length]]} />;
}

function FilesSubPage() {
  const { store, router } = useApp();
  const inbox = router.filesPane === "inbox";
  const groupIDs = store.companyIDsForFilter(router.groupFilter);
  const view = router.filesBrowse.view;
  const query = view.query.trim().toLowerCase();
  const count = store.data.documents.filter((d) => !d.supersededBy &&
    (d.owner.kind === "person" || !groupIDs || groupIDs.has(d.owner.id)) &&
    (view.scope === "all" || view.scope === d.owner.kind || view.scope === ownerKey(d.owner)) &&
    (!query || [store.docType(d.typeID)?.name, store.nameOf(d.owner), d.originalFileName].some((v) => v?.toLowerCase().includes(query)))).length;
  return (
    <DropTarget message="松开即可加入待整理" onDrop={(paths) => router.startImport(paths, null)} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div className="page"><div className="page-inner">
        <PageHeader title="文件" subtitle={inbox ? `${store.data.inbox.length} 份待整理` : `废纸篓 ${store.data.trash.length} 份：30 天内可恢复。`} />
        <FilesTabs count={count} />
        {inbox ? <InboxPane /> : <TrashPane />}
      </div></div>
    </DropTarget>
  );
}

function DocumentsView() {
  const { store, router } = useApp();
  const session = router.filesBrowse;
  const [browse, setBrowse] = useState(session.view);
  const { scope, query } = browse;
  const page = useRef<HTMLDivElement>(null);
  const restoreTop = useRef<number | null>(session.scrollTop);
  const setView = (view: FilesBrowseView) => {
    session.view = view;
    setBrowse(view);
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [grid, setGridState] = useState(platform().prefGet("files.grid") === "1");
  const search = useRef<HTMLInputElement>(null);
  const [fsort, setFsortState] = useState<FSort>(() => (platform().prefGet("files.sort") as FSort) || "status");
  const setFsort = (k: FSort) => { setFsortState(k); platform().prefSet("files.sort", k); };
  const th = (k: FSort, label: string) => <th aria-sort={fsort === k ? "descending" : "none"}><button className="row gap4" style={{ font: "inherit", color: fsort === k ? "var(--ink)" : "inherit" }} onClick={() => setFsort(fsort === k ? "status" : k)} title={fsort === k ? "恢复按状态排序" : `按${label}排序`}>{label}{fsort === k && <Icon name="chevron.down" size={9} />}</button></th>;
  const setGrid = (g: boolean) => { setGridState(g); platform().prefSet("files.grid", g ? "1" : "0"); if (!g) clearThumbCache(); };
  useEffect(() => () => clearThumbCache(), []);
  const filter = router.filesFilter, horizon = router.filesHorizon;
  const ownerKind = scope === "all" ? null : scope.startsWith("company") ? "company" : "person";

  const q = query.trim().toLowerCase();
  const { groupFilter } = router;
  // 在短列表挂载前记录位置。逐字输入不会覆盖搜索前的浏览位置。
  const positionKey = (view: FilesBrowseView, status: number) =>
    JSON.stringify([groupFilter, view.scope, status, view.query.trim().toLowerCase(), grid, status === 1 ? horizon : null]);
  const changeCriteria = (view: FilesBrowseView, status = filter) => {
    const editingQuery = view.query !== query;
    if (!editingQuery || !q) session.remember(positionKey(browse, filter), page.current?.scrollTop ?? 0);
    restoreTop.current = editingQuery && view.query.trim() ? 0 : session.position(positionKey(view, status));
    setSelected(new Set());
    anchor.current = null;
    setView(view);
    if (status !== filter) router.set("filesFilter", status);
  };
  const changeScope = (next: FilesScope) => {
    if (next !== scope) changeCriteria(chooseFilesScope(browse, next));
  };
  const setQuery = (next: string) => changeCriteria({
    ...browse, query: next, collapsedSearch: q && next.trim() ? browse.collapsedSearch : new Set(),
  });
  const setStatus = (next: number) => {
    if (next !== filter) changeCriteria({ ...browse, collapsedMatches: new Set(), collapsedSearch: new Set() }, next);
  };
  useLayoutEffect(() => {
    if (restoreTop.current === null || !page.current) return;
    page.current.scrollTop = restoreTop.current;
    session.scrollTop = page.current.scrollTop;
    restoreTop.current = null;
  }, [session, browse, filter]);
  const expansionField = q ? "collapsedSearch" : !isBroadScope(scope) || filter === 2 ? "collapsedMatches" : "expanded";
  const groupKeys = browse[expansionField];
  const isGroupOpen = useCallback((key: string) =>
    expansionField === "expanded" ? groupKeys.has(key) : !groupKeys.has(key), [expansionField, groupKeys]);
  const allSnapshots = useMemo(() => {
    const scope = store.companyIDsForFilter(groupFilter);
    return store.data.documents.filter((d) => !d.supersededBy && (d.owner.kind === "person" || !scope || scope.has(d.owner.id)))
      .map((d): Snap => {
        const type = store.docType(d.typeID);
        return { d, f: store.freshness(d), owner: store.nameOf(d.owner), type, expiry: expiryOf(d, type) };
      });
  }, [store, store.data, store.missingFiles, store.today, groupFilter]);
  const owners = useMemo(() => {
    const options = new Map<string, FilesOwnerOption>();
    for (const snap of allSnapshots) {
      const owner = snap.d.owner, key = ownerKey(owner);
      const existing = options.get(key);
      if (existing) { existing.count++; continue; }
      const company = owner.kind === "company" ? store.company(owner.id) : undefined;
      options.set(key, { ...owner, name: snap.owner, count: 1, code: company?.jurisdiction,
        tint: company ? companyTint(store, company.id) : undefined });
    }
    return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [allSnapshots, store]);
  const activeOwner = isBroadScope(scope) ? undefined : owners.find((o) => ownerKey(o) === scope);
  // 导入、删除或切换集团后，失效的具体归属回到原来的范围。
  useLayoutEffect(() => {
    if (!isBroadScope(scope) && !activeOwner) changeScope(browse.broadScope);
  }, [scope, activeOwner]);
  const snapshots = useMemo(() => scope === "all" ? allSnapshots : allSnapshots.filter(({ d }) =>
    isBroadScope(scope) ? d.owner.kind === scope : ownerKey(d.owner) === scope), [allSnapshots, scope]);
  const missingCount = useMemo(() => {
    if (ownerKind === "person") return 0;
    return store.missingSummary(groupFilter, activeOwner?.id).items;
  }, [store, store.data, store.missingFiles, store.today, groupFilter, activeOwner, ownerKind]);
  const { scoped, list, grouped, attention, expiredN, undated } = useMemo(() => {
    const scoped = q ? snapshots.filter((s) => s.type?.name.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q) || s.d.originalFileName.toLowerCase().includes(q)) : snapshots;
    let list = scoped;
    if (filter === 1) list = scoped.filter((s) => s.expiry && D.daysBetween(store.today, s.expiry) >= 0 && D.daysBetween(store.today, s.expiry) <= horizon).sort((a, b) => (a.expiry! < b.expiry! ? -1 : 1));
    else if (filter === 3) list = scoped.filter((s) => { const n = D.daysBetween(s.d.addedOn, store.today); return n >= 0 && n <= 30; }).sort((a, b) => (a.d.addedOn < b.d.addedOn ? 1 : -1));
    else list = (filter === 2 ? scoped.filter((s) => freshnessNeedsAttention(s.f)) : [...scoped]).sort((a, b) => freshnessRank(a.f) - freshnessRank(b.f) || a.owner.localeCompare(b.owner, "zh"));
    const groups = new Map<string, { name: string; owner: NodeRef; docs: Snap[]; rank: number }>();
    if (filter !== 1 && filter !== 3) {
      for (const s of list) {
        const owner = s.d.owner, key = `${owner.kind}:${owner.id}`;
        const group = groups.get(key);
        // list 已按紧急度排序；每组第一份就是最需处理的文件。
        if (group) group.docs.push(s);
        else groups.set(key, { name: s.owner, owner, docs: [s], rank: freshnessRank(s.f) });
      }
    }
    const grouped = [...groups.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "zh"));
    if (grouped.length) {
      for (const group of grouped) group.docs = sortDocs(group.docs, fsort);
    } else list = sortDocs(list, fsort);
    return { scoped, list, grouped, attention: scoped.filter((s) => freshnessNeedsAttention(s.f)).length,
      expiredN: scoped.filter((s) => s.f.kind === "expired").length, undated: scoped.filter((s) => s.f.kind === "unknown").length };
  }, [snapshots, q, filter, horizon, store.today, fsort]);
  const ordered = useMemo(() => (grouped.length ? grouped.flatMap((g) => g.docs) : list).map((s) => s.d), [grouped, list]);
  const visibleOwnerKeys = useMemo(() => grouped.map((group) => ownerKey(group.owner)), [grouped]);
  const allGroupsOpen = visibleOwnerKeys.every(isGroupOpen);
  const changeGroupExpansion = (keys: string[], docs: Snap[], open: boolean) => {
    if (!open && selected.size) {
      const next = new Set(selected);
      for (const { d } of docs) next.delete(d.id);
      setSelected(next);
      if (anchor.current && !next.has(anchor.current)) anchor.current = null;
    }
    setView(setFilesGroupsOpen(browse, keys, expansionField, open));
  };
  const visibleOrder = useRef<Document[]>([]);
  useLayoutEffect(() => {
    visibleOrder.current = grouped.length
      ? grouped.filter((g) => isGroupOpen(ownerKey(g.owner))).flatMap((g) => g.docs.map((s) => s.d))
      : ordered;
  }, [grouped, ordered, isGroupOpen]);
  const selectedDocs = selected.size ? ordered.filter((d) => selected.has(d.id)) : [];

  // Ctrl/⌘ A 全选、Esc 取消、Ctrl/⌘ F 搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (router.sheet || hasActiveModal() || document.querySelector(".files-owner-popover")) return;
      const editing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "f") { e.preventDefault(); search.current?.focus(); return; }
      if (cmd && e.key.toLowerCase() === "a" && !editing && ordered.length) { e.preventDefault(); setSelected(new Set(ordered.map((d) => d.id))); anchor.current = visibleOrder.current[0]?.id ?? null; return; }
      if (e.key === "Escape" && !e.isComposing && !document.querySelector(".popover:not(.ghost-out)")) {
        if (query) { setQuery(""); search.current?.focus({ preventScroll: true }); }
        else if (selected.size) { setSelected(new Set()); anchor.current = null; }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const click = useCallback((e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const visible = visibleOrder.current;
      const i = visible.findIndex((d) => d.id === anchor.current), j = visible.findIndex((d) => d.id === id);
      if (i >= 0 && j >= 0) {
        const range = visible.slice(Math.min(i, j), Math.max(i, j) + 1);
        setSelected((previous) => new Set([...previous, ...range.map((d) => d.id)]));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) { toggle(id); return; }
    setSelected(new Set()); anchor.current = id;
    router.open({ kind: "document", id });
  }, [router, toggle]);
  const removeSelected = async (list: Document[]) => {
    if (!list.length) return;
    router.open({ kind: "trashDocs", ids: list.map((d) => d.id) });
    setSelected(new Set()); anchor.current = null;
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
  const makeBatchMenu = (): MenuEntry[] => {
    const usable = selectedDocs.filter((d) => !store.fileMissing(d)).length;
    return [header(`已选 ${selectedDocs.length} 份`), ...(usable ? [item(`打开 ${usable} 份`, "arrow.up.forward.app", () => batchOpen(store, selectedDocs)),
      item(`${revealLabel} ${usable} 份`, "folder", () => batchOpen(store, selectedDocs, true))] : []),
      item("导出为 ZIP…", "archivebox", () => void exportZIP(selectedDocs)), item(`移到废纸篓 ${selectedDocs.length} 份…`, "trash", () => void removeSelected(selectedDocs)), divider];
  };
  const pending = store.pendingImport;
  const watchFiles = useFileViewport();
  const section = (title: string, owner: NodeRef | null, list: Snap[]) => {
    const bad = list.filter((s) => freshnessNeedsAttention(s.f)).length;
    const row = (s: Snap, index: number) => <FileTableRow key={s.d.id} rowIndex={index + 2} snap={s} showOwner={!owner} selected={selected.has(s.d.id)} extraMenu={selected.size > 1 && selected.has(s.d.id) ? makeBatchMenu : undefined} onSelect={click} onToggle={toggle} />;
    const c = owner?.kind === "company" ? store.company(owner.id) : undefined;
    const key = owner ? ownerKey(owner) : null;
    const isOpen = !key || isGroupOpen(key);
    const expired = list.filter((s) => s.f.kind === "expired").length;
    const risk = expired === bad && expired ? `${expired} 份已逾期` :
      `${bad} 份需处理${expired ? `，含 ${expired} 份逾期` : ""}`;
    const summary = <>
      <span className="files-owner-count num">{list.length} 份</span>
      {bad > 0 && <Pill text={risk} kind={list.some((s) => freshnessPill(s.f) === "bad") ? "bad" : "warn"} />}
    </>;
    return (
      <div key={key ?? title} data-owner-key={key ?? undefined} className={owner ? `files-owner-section${isOpen ? " is-open" : ""}` : "col gap12"}>
        {owner && key ? <div className="files-owner-header">
          <button type="button" className="files-owner-disclosure" aria-expanded={isOpen} title={title}
            onClick={() => changeGroupExpansion([key], list, !isOpen)}>
            <span className="files-owner-chevron"><Icon name="chevron.right" size={14} /></span>
            {c ? <JurisdictionBadge code={c.jurisdiction} size={26} tint={companyTint(store, c.id)} /> : <Avatar name={title} size={26} />}
            <span className="files-owner-heading-body"><span className="files-owner-name">{title}</span>{summary}</span>
          </button>
          {(c || (owner.kind === "person" && store.person(owner.id))) && <button type="button" className="files-owner-profile" aria-label={`查看${title}的资料`} title={`查看${owner.kind === "company" ? "公司" : "人员"}资料`}
            onClick={() => owner.kind === "company" ? router.openCompany(owner.id) : router.openPerson(owner.id)}>
            <Icon name="arrow.up.right" size={14} />
          </button>}
        </div> : <div className="row gap10"><span className="t-card">{title}</span>{summary}</div>}
        {isOpen && (grid ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 200px))", gap: 16 }}>
            {list.map((s) => <DeferredFiles key={s.d.id} watch={watchFiles} label={s.d.originalFileName}>{() =>
              <FileCard snap={s} showOwner={!owner} selected={selected.has(s.d.id)} extraMenu={selected.size > 1 && selected.has(s.d.id) ? makeBatchMenu : undefined} onClick={click} />}
            </DeferredFiles>)}
          </div>
        ) : (
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className={`table files-table ${owner ? "files-table-grouped" : "files-table-flat"}`} aria-rowcount={list.length + 1} aria-label={`${title}的文件`}>
              {/* 5.3.2：各分组共用同一套列宽，跨分组竖向对齐 */}
              <colgroup><col style={{ width: 52 }} /><col />{!owner && <col style={{ width: 220 }} />}<col style={{ width: 132 }} /><col style={{ width: 132 }} /><col style={{ width: 168 }} /><col style={{ width: 132 }} /></colgroup>
              <thead><tr><th><span className="sr-only">选择</span></th>{th("type", "文件")}{!owner && <th>归属</th>}{th("issue", "签发")}{th("expiry", "到期")}{th("status", "状态")}<th><span className="sr-only">操作</span></th></tr></thead>
              {Array.from({ length: Math.ceil(list.length / rowsPerChunk) }, (_, i) => {
                const start = i * rowsPerChunk, end = Math.min(start + rowsPerChunk, list.length);
                return <DeferredFiles key={i} watch={watchFiles} rows={end - start} columns={owner ? 6 : 7}
                  label={`${title}，第 ${start + 1} 至 ${end} 份文件`}>{() => list.slice(start, end).map((doc, offset) => row(doc, start + offset))}</DeferredFiles>;
              })}
            </table>
          </div>
        ))}
      </div>
    );
  };

  const empty = () => {
    if (q) return <EmptyStateView symbol="magnifyingglass" title={`没有找到“${query}”`} message="可以清除搜索，或更换归属后再试。" actionTitle="清除搜索" action={() => setQuery("")} />;
    if (!scoped.length) return <EmptyStateView symbol="doc.on.doc" title="当前范围没有文件" message="当前集团或归属下没有现行文件。" actionTitle="查看全部范围"
      action={() => { changeCriteria(chooseFilesScope(browse, "all"), 0); router.set("groupFilter", null); }} />;
    return <EmptyStateView symbol={filter === 2 ? "checkmark.seal" : "doc.on.doc"} title={filter === 1 ? `未来 ${horizon} 天没有即将到期的文件` : filter === 2 ? "当前范围没有需要处理的文件" : "最近 30 天没有添加文件"}
      message={`当前范围内还有 ${scoped.length} 份现行文件。`} actionTitle="查看全部文件" action={() => setStatus(0)} />;
  };

  return (
    <DropTarget message="松开即可加入待整理" radius={20} onDrop={(paths) => router.startImport(paths, null)} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div className="page files-page" ref={page} onScroll={(e) => { session.scrollTop = e.currentTarget.scrollTop; }}>
        <div className="page-inner" style={{ paddingBottom: selectedDocs.length ? 96 : undefined }}>
          <div className="col gap12">
            <PageHeader title="文件" crumb={groupFilter && <button type="button" className="no-drag" aria-label={`清除集团筛选：${store.filterName(groupFilter)}`}
              title="清除集团筛选，查看全部归属" onClick={() => router.set("groupFilter", null)}>
              集团 · {store.filterName(groupFilter)} <Icon name="xmark" size={12} />
            </button>} stats={[
              { label: "现行文件", value: scoped.length, unit: "份" },
              { label: "已过期", value: expiredN, unit: "份", tone: expiredN ? "bad" : undefined },
              { label: "需处理", value: attention, unit: "份", tone: attention ? "warn" : undefined, onClick: attention ? () => setStatus(2) : undefined },
              ...(ownerKind !== "person" ? [{ label: "缺件", value: missingCount, unit: "项", tone: missingCount ? "warn" as const : undefined }] : []),
            ]} subtitle={(list.length === scoped.length ? `${scoped.length} 份现行文件` : `显示 ${list.length} / ${scoped.length} 份`) + (attention ? `，${attention} 份需处理（${[expiredN ? `${expiredN} 份已过期` : "", undated ? `${undated} 份日期待补` : "", attention - expiredN - undated ? `${attention - expiredN - undated} 份快到期或需更新` : ""].filter(Boolean).join("、")}）` : "，都在有效期内") + "。把文件或文件夹拖进窗口即可加入待整理。"}>
              <Button kind="primary" icon="square.and.arrow.up" title="支持 PDF、DOCX、XLSX 和照片，也可以拖入文件夹" onClick={() => void router.chooseFiles(null)}>加入待整理</Button>
            </PageHeader>
            <FilesTabs count={scoped.length} />
          </div>
          <div className={`files-toolbar ${filter === 1 ? "with-horizon" : ""}`}>
            <div className="files-toolbar-main">
              <FilesOwnerPicker owners={owners} value={scope} onChange={changeScope} onClear={() => changeScope(browse.broadScope)} />
              <Segmented className="files-status-filter seg-scroll" options={[[0, "全部"], [1, "即将到期"], [2, `需处理 ${attention}`], [3, "最近添加"]]} value={filter} onChange={setStatus} />
              {filter === 1 && <Segmented className="files-horizon-filter seg-scroll" options={[[30, "30 天"], [60, "60 天"], [90, "90 天"], [183, "半年"]]} value={horizon} onChange={(v) => router.set("filesHorizon", v)} />}
            </div>
            <div className="files-toolbar-tools">
              <div className="search files-search" title="搜索文件（Ctrl/⌘ F）">
                <Icon name="magnifyingglass" size={14} />
                <input ref={search} className="field" aria-label="搜索文件" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索类型、公司、人员或文件名" />
                {query && <button type="button" className="files-query-clear" aria-label="清除文件搜索"
                  onClick={() => { setQuery(""); search.current?.focus({ preventScroll: true }); }}><Icon name="xmark" size={12} /></button>}
              </div>
              <Segmented className="files-view-filter" options={[[false, "列表"], [true, "缩略图"]]} value={grid} onChange={setGrid} />
              {grouped.length > 1 && <Button kind="quiet" size="small" className="files-group-toggle" icon={allGroupsOpen ? "chevron.up" : "chevron.down"}
                onClick={() => changeGroupExpansion(visibleOwnerKeys, list, !allGroupsOpen)}>{allGroupsOpen ? "全部折叠" : "全部展开"}</Button>}
            </div>
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
          {!store.data.documents.length ? <div className="card"><EmptyStateView symbol="doc.on.doc" title="还没有文件" message="把 PDF、DOCX、XLSX、照片或按公司分好的文件夹拖进窗口，Charter 会识别类型、公司和日期，你确认后才归档。" actionTitle="导入文件" action={() => void router.chooseFiles(null)} /></div>
            : !list.length ? <div className="card">{empty()}</div>
              : filter === 1 || filter === 3 ? section(filter === 1 ? "按到期日排列" : "最近 30 天添加", null, list)
                : <div className="files-owner-groups">{grouped.map((g) => section(g.name, g.owner, g.docs))}</div>}
        </div>
      </div>
      {selectedDocs.length > 0 && (
        <div className="row gap8 floating appear" style={{ position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", height: 48, padding: "0 10px", borderRadius: "var(--r-full)", zIndex: 4 }}>
          <span className="num" style={{ fontSize: 13, fontWeight: 600, padding: "0 4px 0 8px" }}>已选 {selectedDocs.length} 份</span>
          {selectedDocs.some((d) => !store.fileMissing(d)) && <>
            <Button kind="quiet" size="small" onClick={() => batchOpen(store, selectedDocs)}>打开</Button>
            <Button kind="quiet" size="small" onClick={() => batchOpen(store, selectedDocs, true)}>{revealLabel}</Button>
          </>}
          <Button size="small" onClick={() => void removeSelected(selectedDocs)}>移到废纸篓…</Button>
          <Button kind="primary" size="small" disabled={exporting} onClick={() => void exportZIP(selectedDocs)}>{exporting ? "正在导出…" : "导出为 ZIP…"}</Button>
          <span className="vrule" />
          <Button kind="quiet" size="small" icon="xmark" ariaLabel="取消选择" title="取消选择（Esc）" onClick={() => { setSelected(new Set()); anchor.current = null; }} />
        </div>
      )}
    </DropTarget>
  );
}

const FileCard = memo(function FileCard({ snap, showOwner, selected, extraMenu, onClick }: { snap: Snap; showOwner: boolean; selected: boolean; extraMenu?: () => MenuEntry[]; onClick: (e: React.MouseEvent, id: string) => void }) {
  const { store, router } = useAppContext();
  const ctx = useContextMenu();
  const [startStage, stageNode] = useStageFile();
  const [reissue, setReissue] = useState(false);
  const { d, f, type: t } = snap;
  const menu = (): MenuEntry[] => [
    ...(extraMenu?.() ?? []),
    ...openEntries(store, d),
    item("归档新版…", "square.and.arrow.up", () => void startStage({ typeID: d.typeID, owner: d.owner, replaces: d, form: d.form, onArchived: (n) => router.open({ kind: "document", id: n.id }) })),
    divider,
    item("移到废纸篓…", "trash", () => router.open({ kind: "trashDocs", ids: [d.id] }), { destructive: true }),
  ];
  return (
    <button className="col gap12 file-card" onClick={(e) => onClick(e, d.id)} onContextMenu={(e) => ctx.open(e, menu())} title={d.originalFileName} aria-label={`${t?.name ?? "文件"}，${freshnessLabel(f)}`} aria-pressed={selected}
      style={{ padding: 12, borderRadius: "var(--r-tile)", background: "var(--surface)", textAlign: "left", position: "relative", borderColor: selected ? "var(--green)" : undefined }}>
      <span className="thumb" style={{ height: 172, borderRadius: "var(--r-control)", background: "var(--surface-sunken)", display: "grid", placeItems: "center", width: "100%" }}>
        <FileThumb doc={d} alert={freshnessPill(f) === "bad"} width={120} height={150} startDelayMs={120} />
      </span>
      <span className="col" style={{ gap: 2, minWidth: 0, width: "100%" }}>
        <span className="t-row ellipsis">{t?.name ?? "文件"}</span>
        <span className="t-micro muted ellipsis">{showOwner ? store.nameOf(d.owner) : d.issueDate ? `${D.long(d.issueDate)}签发` : "缺少签发日期"}</span>
      </span>
      <span className="row"><Pill text={freshnessLabel(f)} kind={freshnessPill(f)} /></span>
      {selected && <span style={{ position: "absolute", top: 16, right: 16 }}><Icon name="checkmark.circle.fill" size={18} /></span>}
      {ctx.node}{stageNode}
      {reissue && <ReissueRequestSheet owner={d.owner} typeIDs={[d.typeID]} onClose={() => setReissue(false)} />}
    </button>
  );
});

/** 文件表的一行：具体文件名优先；类型、同类第几份在第二行；来源路径和校验值放在详情里。 */
const FileTableRow = memo(function FileTableRow({ snap, rowIndex, showOwner, selected, extraMenu, onSelect, onToggle }: { snap: Snap; rowIndex: number; showOwner: boolean; selected: boolean; extraMenu?: () => MenuEntry[]; onSelect: (e: React.MouseEvent, id: string) => void; onToggle: (id: string) => void }) {
  const { store, router } = useAppContext();
  const ctx = useContextMenu();
  const [startStage, stageNode] = useStageFile();
  const { d, f, type: t, expiry } = snap;
  const st = statusOfFreshness(f);
  const same = store.siblingsOf(d);
  const older = store.olderCountOf(d);
  const c = d.owner.kind === "company" ? store.company(d.owner.id) : undefined;
  const fileName = /^[0-9A-F-]{36}\.[a-z]+$/i.test(d.originalFileName) ? "（无原始文件名）" : d.originalFileName;
  // 第二行只放类型，便于扫读比较；同类份数、旧版和备注放进悬停提示和详情
  const sub = t?.name ?? "未知类型";
  const subTitle = [sub, same.length > 1 ? `同类 ${same.indexOf(d) + 1}/${same.length} 份` : "", older ? `替代了 ${older} 个旧版` : "", d.notes].filter(Boolean).join("\n");
  const upload = () => void startStage({ typeID: d.typeID, owner: d.owner, replaces: d, form: d.form, onArchived: (n) => router.open({ kind: "document", id: n.id }) });
  const menu = (): MenuEntry[] => [
    ...(extraMenu?.() ?? []),
    ...(f.kind === "fileMissing" ? [item("重新定位…", "folder", () => void store.relocateDocument(d))] : [item("打开", "arrow.up.forward.app", () => void store.openDocument(d)),
      item(platform().os === "windows" ? "在资源管理器中显示" : "在访达中显示", "folder", () => void store.revealDocument(d))]),
    item("归档新版…", "square.and.arrow.up", upload),
    divider,
    item("移到废纸篓…", "trash", () => router.open({ kind: "trashDocs", ids: [d.id] }), { destructive: true }),
  ];
  return (
    <tr aria-rowindex={rowIndex} className={selected ? "sel" : ""} tabIndex={0} onClick={(e) => onSelect(e, d.id)} onContextMenu={(e) => ctx.open(e, menu())} aria-selected={selected}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) router.open({ kind: "document", id: d.id }); if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); onToggle(d.id); } }}>
      <td onClick={(e) => { e.stopPropagation(); onToggle(d.id); }}><Checkbox checked={selected} onChange={() => onToggle(d.id)} ariaLabel={`选择 ${fileName}`} /></td>
      <td><div className="col" style={{ minWidth: 0, gap: 1 }}><span className="fname name-1" title={d.originalFileName}>{fileName}</span><span className="t-meta muted name-1" title={subTitle}>{sub}</span></div></td>
      {showOwner && <td className="owner"><span className="row gap6" style={{ minWidth: 0 }}>{c && <span className="v4-code" style={{ width: 24, height: 20, fontSize: 9.5, borderRadius: 6, ...companyTint(store, c.id) }}>{c.jurisdiction}</span>}<span className="name-1" title={store.nameOf(d.owner)}>{store.nameOf(d.owner)}</span></span></td>}
      <td className="date num">{d.issueDate ?? <span className="missing-val">未填日期</span>}</td>
      <td className="date num" style={{ color: f.kind === "expired" ? "var(--risk-bad)" : undefined }}>{expiry ?? (d.noExpiry || t?.validity === "permanent" || t?.validity === "untilChanged" ? <span className="muted">长期</span> : <span className="missing-val">未填日期</span>)}</td>
      <td><span className="row gap4" style={{ flexWrap: "nowrap" }}><StatusTag s={st} /><ExtraTags d={d} t={t} /></span></td>
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
        {f.kind === "fileMissing" ? <Button size="small" onClick={() => void store.relocateDocument(d)} title="源文件不在数据文件夹里：选回它现在的位置，Charter 复制一份进来">重新定位…</Button>
          : f.kind === "unknown" ? <Button size="small" onClick={() => router.open({ kind: "document", id: d.id })}>补充日期</Button>
          : freshnessNeedsAttention(f) ? <Button size="small" onClick={upload} title="类型和归属沿用这份，旧版保留">归档新版</Button>
            : <Button size="small" onClick={() => void store.openDocument(d)}>打开原件</Button>}
        {ctx.node}{stageNode}
      </td>
    </tr>
  );
});
