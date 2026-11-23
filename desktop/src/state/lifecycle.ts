// 5.3 文件生命周期：待整理队列（inbox/）、Charter 废纸篓（trash/）、移除前的影响范围。
// 原则：Charter 归档时总是复制一份；这里的移动、删除只作用于数据文件夹里的副本，从不碰用户原来的文件。

import * as D from "../domain/day";
import type { InboxImportIssue, InboxImportOutcome, InboxImportProgress } from "../domain/inboxImport";
import { inboxImportExtensions } from "../domain/importFormats";
import { type Document, type EvidenceLink, type InboxCategory, type InboxItem, type NodeRef, type TrashEntry, ref, sameRef, trashKeepDays, uuid } from "../domain/models";
import { basename, extname, platform } from "../platform/platform";
import { recognizeFile } from "../services/extract";
import { sha256File } from "../services/hash";
import { recognitionContext } from "./actions";
import type { ArchiveRequest, ImportItem, Store } from "./store";

/** 任职类文件：默认归为“任职证据”。 */
export const evidenceTypeIDs = new Set(["person.consent", "person.appointment", "person.resignation"]);

// MARK: - 影响范围

export interface Impact {
  docs: Document[];
  copies: string[];
  sources: string[];
  promoted: Document[];
  links: number;
  evidence: string[];
}
export function deletionImpact(s: Store, docs: Document[]): Impact {
  const ids = new Set(docs.map((d) => d.id));
  const promoted = s.data.documents.filter((x) => x.supersededBy && ids.has(x.supersededBy) && !ids.has(x.id));
  const evidence = [
    ...s.data.holdings.filter((h) => h.evidence && ids.has(h.evidence.documentID)).map((h) => s.evidenceTargetName({ target: "holding", id: h.id, kind: "shareholding" })),
    ...s.data.appointments.filter((a) => a.evidence && ids.has(a.evidence.documentID)).map((a) => s.evidenceTargetName({ target: "appointment", id: a.id, kind: "appointment" })),
  ];
  return {
    docs, copies: docs.map((d) => d.filePath), sources: docs.map((d) => d.sourcePath ?? ""), promoted,
    links: docs.reduce((n, d) => n + (d.links?.length ?? 0) + (d.relatedCompanyID ? 1 : 0), 0), evidence,
  };
}

// MARK: - 废纸篓

async function moveInto(s: Store, rel: string, entryID: string): Promise<string> {
  const p = platform();
  const dest = `trash/${entryID}/${basename(rel)}`;
  await p.mkdirs(s.folder.abs(`trash/${entryID}`));
  const from = s.folder.abs(rel);
  if ((await p.stat(from)).exists) await p.moveFile(from, s.folder.abs(dest));
  return dest;
}
async function freePath(rel: string, s: Store): Promise<string> {
  const p = platform();
  if (!(await p.stat(s.folder.abs(rel))).exists) return rel;
  const dot = rel.lastIndexOf("."), stem = dot > 0 ? rel.slice(0, dot) : rel, ext = dot > 0 ? rel.slice(dot) : "";
  for (let n = 2; ; n++) { const r = `${stem} (${n})${ext}`; if (!(await p.stat(s.folder.abs(r))).exists) return r; }
}

/** 把文件移到 Charter 废纸篓：副本移到 trash/，记录、旧版本和核实依据的关系都存下来，可原样恢复。 */
export async function trashDocuments(s: Store, docs: Document[]): Promise<TrashEntry[]> {
  if (!docs.length) return [];
  const ids = new Set(docs.map((d) => d.id));
  const entries: TrashEntry[] = [];
  const moved: [string, string][] = [];
  try {
    for (const d of docs) {
      const id = uuid();
      const path = await moveInto(s, d.filePath, id);
      moved.push([path, d.filePath]);
      entries.push({
        id, kind: "document", trashedOn: s.today, path, originalPath: d.filePath, document: d,
        promoted: s.data.documents.filter((x) => x.supersededBy === d.id && !ids.has(x.id)).map((x) => x.id),
        evidenceRefs: [
          ...s.data.holdings.filter((h) => h.evidence?.documentID === d.id).map((h) => ({ kind: "holding" as const, id: h.id, page: h.evidence!.page, note: h.evidence!.note, verified: h.verified })),
          ...s.data.appointments.filter((a) => a.evidence?.documentID === d.id).map((a) => ({ kind: "appointment" as const, id: a.id, page: a.evidence!.page, note: a.evidence!.note, verified: a.verified })),
        ],
      });
    }
    await s.persistCollections({
      documents: s.data.documents.filter((x) => !ids.has(x.id)).map((x) => (x.supersededBy && ids.has(x.supersededBy) ? { ...x, supersededBy: undefined } : x)),
      holdings: s.data.holdings.map((h) => (h.evidence && ids.has(h.evidence.documentID) ? { ...h, evidence: undefined, verified: false } : h)),
      appointments: s.data.appointments.map((a) => (a.evidence && ids.has(a.evidence.documentID) ? { ...a, evidence: undefined, verified: false } : a)),
      trash: [...s.data.trash, ...entries],
    });
  } catch (e) {
    for (const [now, was] of moved) { try { await platform().moveFile(s.folder.abs(now), s.folder.abs(was)); } catch { /* 忽略 */ } }
    throw e;
  }
  s.replace({
    documents: s.data.documents.filter((x) => !ids.has(x.id)).map((x) => (x.supersededBy && ids.has(x.supersededBy) ? { ...x, supersededBy: undefined } : x)),
    holdings: s.data.holdings.map((h) => (h.evidence && ids.has(h.evidence.documentID) ? { ...h, evidence: undefined, verified: false } : h)),
    appointments: s.data.appointments.map((a) => (a.evidence && ids.has(a.evidence.documentID) ? { ...a, evidence: undefined, verified: false } : a)),
    trash: [...s.data.trash, ...entries],
  });
  return entries;
}

/** 待整理里的文件移到废纸篓。 */
export async function trashInbox(s: Store, items: InboxItem[]): Promise<TrashEntry[]> {
  if (!items.length) return [];
  const ids = new Set(items.map((i) => i.id));
  const entries: TrashEntry[] = [];
  // 5.5.5：移动或记录写入失败时，已移动的文件放回原处
  const moved: [string, string][] = [];
  const undo = async () => { for (const [now, was] of moved) { try { await platform().moveFile(s.folder.abs(now), s.folder.abs(was)); } catch { /* 忽略 */ } } };
  try {
    for (const i of items) { const id = uuid(); const path = await moveInto(s, i.path, id); moved.push([path, i.path]); entries.push({ id, kind: "inbox", trashedOn: s.today, path, originalPath: i.path, inbox: i }); }
  } catch (e) { await undo(); throw e; }
  const next = { inbox: s.data.inbox.filter((x) => !ids.has(x.id)), trash: [...s.data.trash, ...entries] };
  try { await s.persistCollections(next); } catch (e) { await undo(); throw e; }
  s.replace(next);
  return entries;
}

/** 从废纸篓恢复：文件放回原位置（被占用时加序号），记录和关系原样放回。 */
export async function restoreTrash(s: Store, entryIDs: string[]): Promise<number> {
  const p = platform();
  const list = s.data.trash.filter((e) => entryIDs.includes(e.id));
  let docs = [...s.data.documents], inbox = [...s.data.inbox], holdings = [...s.data.holdings], appointments = [...s.data.appointments];
  const moved: [string, string][] = [];
  const undo = async () => { for (const [now, was] of moved) { try { await p.moveFile(s.folder.abs(now), s.folder.abs(was)); } catch { /* 忽略 */ } } };
  for (const e of list) {
    const target = await freePath(e.originalPath, s);
    try {
      await p.mkdirs(s.folder.abs(target.split("/").slice(0, -1).join("/")));
      if ((await p.stat(s.folder.abs(e.path))).exists) { await p.moveFile(s.folder.abs(e.path), s.folder.abs(target)); moved.push([target, e.path]); }
    } catch (err) { await undo(); throw err; }
    if (e.kind === "document" && e.document) {
      const d = { ...e.document, filePath: target };
      docs.push(d);
      docs = docs.map((x) => (e.promoted?.includes(x.id) ? { ...x, supersededBy: d.id } : x));
      for (const r of e.evidenceRefs ?? []) {
        if (r.kind === "holding") holdings = holdings.map((h) => (h.id === r.id && !h.evidence ? { ...h, evidence: { documentID: d.id, page: r.page, note: r.note }, ...(r.verified !== undefined ? { verified: r.verified } : {}) } : h));
        else appointments = appointments.map((a) => (a.id === r.id && !a.evidence ? { ...a, evidence: { documentID: d.id, page: r.page, note: r.note }, ...(r.verified !== undefined ? { verified: r.verified } : {}) } : a));
      }
    } else if (e.inbox) inbox.push({ ...e.inbox, path: target });
  }
  const next = { documents: docs, inbox, holdings, appointments, trash: s.data.trash.filter((e) => !entryIDs.includes(e.id)) };
  try { await s.persistCollections(next); } catch (err) { await undo(); throw err; }
  for (const e of list) { try { await p.removeDir(s.folder.abs(`trash/${e.id}`)); } catch { /* 忽略 */ } }
  s.replace(next);
  return list.length;
}

/** 彻底删除：只删数据文件夹 trash/ 里的副本。all = false 时只清超过 30 天的。 */
export async function purgeTrash(s: Store, opts: { all?: boolean; ids?: string[] } = {}): Promise<number> {
  const cutoff = D.addDays(s.today, -trashKeepDays);
  const drop = s.data.trash.filter((e) => opts.ids ? opts.ids.includes(e.id) : opts.all || e.trashedOn < cutoff);
  if (!drop.length) return 0;
  for (const e of drop) { try { await platform().removeDir(s.folder.abs(`trash/${e.id}`)); } catch { /* 忽略 */ } }
  const next = { trash: s.data.trash.filter((e) => !drop.includes(e)) };
  await s.persistCollections(next);
  s.replace(next);
  return drop.length;
}

// MARK: - 待整理

export async function collectInboxFiles(paths: string[]): Promise<{ files: string[]; issues: InboxImportIssue[] }> {
  const p = platform();
  const out: string[] = [];
  const issues: InboxImportIssue[] = [];
  const issue = (path: string, reason: InboxImportIssue["reason"], detail?: unknown) => issues.push({
    path, name: basename(path) || path, reason,
    ...(detail ? { detail: detail instanceof Error ? detail.message : String(detail) } : {}),
  });
  const walk = async (path: string) => {
    try {
      const st = await p.stat(path);
      if (!st.exists) { issue(path, st.error ? "unreadable" : "missing", st.error); return; }
      if (!st.isDir) {
        if (inboxImportExtensions.includes(extname(path).toLowerCase())) out.push(path);
        else issue(path, "unsupported");
        return;
      }
      for (const e of await p.listDir(path)) if (!e.name.startsWith(".")) await walk(p.join(path, e.name));
    } catch (e) {
      // 单个不可读路径不应中断同批其他文件。
      issue(path, "unreadable", e);
    }
  };
  for (const path of paths) {
    const before = out.length + issues.length;
    await walk(path);
    if (out.length + issues.length === before) issue(path, "empty");
  }
  return { files: out, issues };
}

/** 给还没有哈希的已归档文件补上（一次性，之后归档时就会记下）。 */
async function backfillHashes(s: Store, onProgress?: (t: string) => void) {
  const missing = s.data.documents.filter((d) => !d.sha256);
  if (!missing.length) return;
  const map = new Map<string, string>();
  for (const [i, d] of missing.entries()) {
    onProgress?.(`正在比对已归档文件 ${i + 1}/${missing.length}`);
    try { map.set(d.id, await sha256File(s.folder.abs(d.filePath))); } catch { /* 文件不在时跳过 */ }
  }
  if (map.size) s.commit((dd) => { for (const d of dd.documents) { const h = map.get(d.id); if (h) d.sha256 = h; } });
}

export function guessCategory(s: Store, i: Pick<InboxItem, "typeID" | "companyID" | "personIDs" | "textExcerpt">): { category?: InboxCategory; reason: string } {
  const t = i.typeID ? s.docType(i.typeID) : undefined;
  if (i.typeID && evidenceTypeIDs.has(i.typeID)) return { category: "evidence", reason: `看起来是${t?.name}` };
  if (t?.owner === "person") return { category: "person", reason: `看起来是${t.name}` };
  if (t?.owner === "company") return { category: "company", reason: `看起来是${t.name}` };
  if (i.companyID && !i.personIDs?.length) return { category: "company", reason: "提到了已有的公司" };
  if (i.personIDs?.length && !i.companyID) return { category: "person", reason: "提到了已有的人员" };
  if (!i.textExcerpt?.trim()) return { reason: "没有读到文字" };
  return { reason: "没有认出类型、公司或人员" };
}

/** 加入待整理：复制到 inbox/、计算哈希、本地识别、判断重复和建议分类。全部在本机完成。 */
export async function addToInbox(s: Store, paths: string[], onProgress?: (progress: InboxImportProgress) => void): Promise<InboxImportOutcome> {
  const p = platform();
  const { files, issues } = await collectInboxFiles(paths);
  const fileNames = files.map((path) => basename(path));
  const unsupported = issues.filter((i) => i.reason === "unsupported").length;
  const collectFailed = issues.filter((i) => i.reason === "missing" || i.reason === "unreadable").length;
  if (!files.length) return { added: 0, duplicates: 0, unsupported, failed: collectFailed, saveFailed: 0, issues };
  onProgress?.({ phase: "preparing", files: fileNames, total: files.length, completed: 0 });
  await backfillHashes(s, (detail) => onProgress?.({ phase: "preparing", files: fileNames, total: files.length, completed: 0, detail }));
  const byHash = new Map<string, string>();
  for (const d of s.data.documents) if (d.sha256) byHash.set(d.sha256, "document:" + d.id);
  for (const i of s.data.inbox) byHash.set(i.sha256, "inbox:" + i.id);
  const ctx = recognitionContext(s);
  const people = s.data.people.map((x) => ({ id: x.id, names: [x.name, ...x.aliases].filter((n) => [...n].length >= 2) }));
  let added = 0, dups = 0, failed = collectFailed, saveFailed = 0;
  const readyToSave: { path: string; name: string; duplicate: boolean }[] = [];
  try { await p.mkdirs(s.folder.abs("inbox")); }
  catch (e) {
    for (const src of files) issues.push({ path: src, name: basename(src), reason: "copy", detail: e instanceof Error ? e.message : String(e) });
    return { added, duplicates: dups, unsupported, failed: failed + files.length, saveFailed, issues };
  }
  for (const [n, src] of files.entries()) {
    const fileName = basename(src);
    onProgress?.({ phase: "recognizing", files: fileNames, total: files.length, completed: n, currentIndex: n });
    let rel: string | undefined;
    let committed = false;
    let stage: "read" | "copy" = "read";
    try {
      const bytes = await p.readBytes(src);
      const { sha256Bytes } = await import("../services/hash");
      const hash = await sha256Bytes(bytes);
      const id = uuid();
      rel = `inbox/${id}.${extname(src).toLowerCase()}`;
      stage = "copy";
      await p.copyFile(src, s.folder.abs(rel));
      let rec;
      try { rec = await recognizeFile(s.folder.abs(rel), ctx, fileName); } catch { rec = undefined; }
      const hay = ((rec?.text ?? "") + "\n" + fileName).toLowerCase();
      const personIDs = people.filter((x) => x.names.some((nm) => hay.includes(nm.toLowerCase()))).map((x) => x.id);
      const dupOf = byHash.get(hash);
      const item: InboxItem = {
        id, fileName, path: rel, sourcePath: src, sha256: hash, size: bytes.length, addedOn: s.today,
        textExcerpt: rec?.text?.slice(0, 600), typeID: rec?.typeID, companyID: rec?.companyID, personIDs, companyNameGuess: rec?.companyNameGuess,
        issueDate: rec?.issueDate, expiryDate: rec?.expiryDate, confidence: Math.min(1, (rec?.confidence ?? 0) + (personIDs.length ? 0.1 : 0)),
        reasons: [...(rec?.evidence ?? [])], duplicateOf: dupOf,
      };
      const g = guessCategory(s, item);
      item.category = dupOf ? "irrelevant" : g.category;
      item.reasons.unshift(dupOf ? (dupOf.startsWith("document:") ? "和已归档的文件内容完全相同" : "和待整理里的另一份内容完全相同") : g.reason);
      // 使用 Store 自己的写队列追加，避免 await 持久化期间用旧快照覆盖用户
      // 对已有待整理行所作的分类、归属或归档修改。
      s.commit((d) => { d.inbox.push(item); });
      committed = true;
      byHash.set(hash, "inbox:" + id);
      readyToSave.push({ path: src, name: fileName, duplicate: Boolean(dupOf) });
    } catch (e) {
      failed++;
      issues.push({ path: src, name: fileName, reason: stage === "copy" ? "copy" : "unreadable", detail: e instanceof Error ? e.message : String(e) });
      if (rel && !committed) { try { await p.removeFile(s.folder.abs(rel)); } catch { /* 忽略清理失败 */ } }
    }
  }
  // 待整理记录作为一个集合落盘；只在整批的最终快照保存成功后才计为“已加入”。
  // 若保存失败，副本和内存记录保留，设置里的“重试保存”可继续完成。
  if (readyToSave.length) onProgress?.({
    phase: "saving", files: fileNames, total: files.length, completed: files.length, successful: readyToSave.length,
  });
  if (readyToSave.length && !(await s.ensureSaved("完成加入待整理"))) {
    saveFailed = readyToSave.length;
    for (const item of readyToSave) issues.push({ path: item.path, name: item.name, reason: "save", detail: "副本和待整理记录尚未保存到数据文件夹" });
  } else {
    added = readyToSave.length;
    dups = readyToSave.filter((item) => item.duplicate).length;
  }
  return { added, duplicates: dups, unsupported, failed, saveFailed, issues };
}

export function updateInbox(s: Store, ids: string[], chosen: InboxItem["chosen"]) {
  s.commit((d) => { for (const i of d.inbox) if (ids.includes(i.id)) i.chosen = { ...(i.chosen ?? {}), ...chosen } as any; });
}

const ownerKindForCategory = (category?: InboxCategory): NodeRef["kind"] | undefined => category === "company" ? "company"
  : category === "person" || category === "evidence" ? "person"
    : undefined;

function compatibleChosenTarget(s: Store, i: InboxItem): { category?: InboxCategory; ownerKind?: NodeRef["kind"]; owner?: NodeRef; typeID?: string } {
  const category = i.chosen?.category ?? i.category;
  const ownerKind = ownerKindForCategory(category) ?? i.chosen?.owner?.kind ?? (i.chosen?.typeID ? s.docType(i.chosen.typeID)?.owner : undefined);
  const owner = !ownerKind || i.chosen?.owner?.kind === ownerKind ? i.chosen?.owner : undefined;
  // “任职证据”在待整理界面没有类型选择器，固定按任职证明处理；切换分类时遗留的个人类型不能偷带进来。
  const typeID = category !== "evidence" && i.chosen?.typeID && (!ownerKind || s.docType(i.chosen.typeID)?.owner === ownerKind) ? i.chosen.typeID : undefined;
  return { category, ownerKind, owner, typeID };
}

/** 待整理中由用户明确选择的值进入导入向导时优先于再次识别。 */
export function applyInboxChoiceToImport(s: Store, item: ImportItem, source?: InboxItem): ImportItem {
  const chosen = source?.chosen;
  if (!chosen) return item;
  const target = compatibleChosenTarget(s, source);
  if (target.category === "irrelevant") return { ...item, include: false, newCompanyKey: undefined };
  const owner = target.owner ?? (target.ownerKind && item.owner?.kind !== target.ownerKind ? undefined : item.owner);
  const selectedTypeID = target.typeID ?? (target.category === "evidence" ? "person.appointment" : undefined);
  const typeID = selectedTypeID ?? (target.ownerKind && item.typeID && s.docType(item.typeID)?.owner !== target.ownerKind ? undefined : item.typeID);
  const manuallyReady = !!target.owner && (!!target.typeID || target.category === "evidence");
  return {
    ...item,
    owner,
    typeID,
    newCompanyKey: target.owner || target.ownerKind === "person" ? undefined : item.newCompanyKey,
    ownerUncertain: target.owner ? false : item.ownerUncertain,
    typeUncertain: selectedTypeID ? false : item.typeUncertain,
    confirmed: item.confirmed || manuallyReady,
  };
}

const comparablePath = (path: string) => platform().os === "windows" ? path.replace(/\\/g, "/").toLowerCase() : path;

/** 导入向导会反复按路径查询待整理来源；建立一次索引，避免每行渲染和识别都扫描整个队列。 */
export function inboxItemLookup(s: Store): (path: string) => InboxItem | undefined {
  const byPath = new Map(s.data.inbox.map((item) => [comparablePath(s.folder.abs(item.path)), item]));
  return (path) => byPath.get(comparablePath(path));
}

/** 单独解析当前归属；类型和归属都有效时才生成归档请求。 */
export function resolveTarget(s: Store, i: InboxItem): { owner?: NodeRef; req?: Omit<ArchiveRequest, "path">; problem?: string; category?: InboxCategory } {
  const chosen = compatibleChosenTarget(s, i);
  const category = chosen.category;
  if (!category) return { problem: "还没分类" };
  if (category === "irrelevant") return { category };
  let typeID = chosen.typeID ?? (chosen.ownerKind && s.docType(i.typeID ?? "")?.owner !== chosen.ownerKind ? undefined : i.typeID);
  let owner: NodeRef | undefined = chosen.owner;
  const links: EvidenceLink[] = [];
  if (category === "company") {
    owner ??= i.companyID ? ref("company", i.companyID) : undefined;
    if (!owner || owner.kind !== "company") return { category, problem: "选一家公司" };
    if (!typeID || s.docType(typeID)?.owner !== "company") return { category, owner, problem: "选文件类型" };
  } else {
    owner ??= i.personIDs?.[0] ? ref("person", i.personIDs[0]) : undefined;
    if (!owner || owner.kind !== "person") return { category, problem: "选一个人" };
    if (category === "evidence") typeID = "person.appointment";
    if (!typeID || s.docType(typeID)?.owner !== "person") return { category, owner, problem: "选文件类型" };
    if (category === "evidence") {
      const appts = i.chosen?.appointmentIDs ?? s.data.appointments.filter((a) => a.personID === owner!.id && (!i.companyID || a.companyID === i.companyID)).map((a) => a.id);
      for (const a of appts) links.push({ target: "appointment", id: a, kind: "appointment" });
      const cos = new Set(appts.map((a) => s.data.appointments.find((x) => x.id === a)?.companyID).filter(Boolean) as string[]);
      for (const c of cos) links.push({ target: "company", id: c, kind: "appointment" });
    } else if (i.companyID) links.push({ target: "company", id: i.companyID, kind: "other" });
  }
  return { category, owner, req: { typeID: typeID!, owner, issued: i.issueDate, expiry: i.expiryDate, source: i.sourcePath, sha256: i.sha256, links } };
}

/** 向导未改变任职证据的类型和归属时，保留待整理中已经确认的任职关联。 */
export function inboxLinksForImport(s: Store, source: InboxItem | undefined, typeID: string, owner: NodeRef): EvidenceLink[] | undefined {
  if (!source) return undefined;
  const target = resolveTarget(s, source);
  return target.req && target.req.typeID === typeID && sameRef(target.req.owner, owner) ? target.req.links : undefined;
}

/** 按当前分类归档选中的待整理文件；“无关文件”移到废纸篓。返回归档数和跳过的数量。 */
export async function processInbox(s: Store, ids: string[]): Promise<{ archived: Document[]; trashed: number; skipped: number }> {
  const items = s.data.inbox.filter((i) => ids.includes(i.id));
  const reqs: ArchiveRequest[] = [], used: InboxItem[] = [], junk: InboxItem[] = [];
  let skipped = 0;
  for (const i of items) {
    const r = resolveTarget(s, i);
    if (r.category === "irrelevant") { junk.push(i); continue; }
    if (!r.req) { skipped++; continue; }
    reqs.push({ ...r.req, path: s.folder.abs(i.path) }); used.push(i);
  }
  let archived: Document[] = [];
  if (reqs.length) {
    archived = await s.archiveBatch(reqs);
    const gone = new Set(used.map((i) => i.id));
    const next = { inbox: s.data.inbox.filter((x) => !gone.has(x.id)) };
    await s.persistCollections(next);
    s.replace(next);
    // 记录先可靠落盘，再删待整理副本；删除失败只留下无引用副本，不会造成坏记录。
    for (const i of used) { try { await platform().removeFile(s.folder.abs(i.path)); } catch { /* 下次整理时仍可人工处理残留副本 */ } }
  }
  const trashed = (await trashInbox(s, junk)).length;
  return { archived, trashed, skipped };
}
