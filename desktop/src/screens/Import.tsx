// 导入与识别：逐份识别 → 用户确认 → 一次归档；可保存草稿稍后继续。移植自 FilesView.swift 的 ImportView 与 ImportDoneView.swift。

import { useEffect, useRef, useState } from "react";
import * as D from "../domain/day";
import { type Company, type Document, type DocumentType, type NodeRef, emptyArchive, ref, sameRef, typeAppliesTo, uuid, latinPad, latinPadEnd } from "../domain/models";
import { matchCompany } from "../domain/recognize";
import { snapshotTitle } from "../domain/folder";
import { useApp } from "../state/hooks";
import { type ArchiveRequest, type CompanyDraft, type ImportItem, type PendingImport, pendingRemaining } from "../state/store";
import type { ImportContext } from "../state/router";
import { recognitionContext } from "../state/actions";
import { recognizeFile, thumbnail } from "../services/extract";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Checkbox, DateField, FormGroup, Modal, Pill, SelectField, SheetScaffold, Spinner, TextField } from "../ui/kit";
import { PurposeReadinessAction, ReissueRequestSheet, computeReadiness, versionNotice } from "./common";
import { ProgressTrack } from "../ui/kit";

const exts = new Set(["pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff"]);
const extOf = (p: string) => (p.split(".").pop() ?? "").toLowerCase();
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 展开拖入的文件夹：子文件夹名作为公司名线索。 */
async function collect(paths: string[]): Promise<ImportItem[]> {
  const p = platform();
  const out: ImportItem[] = [];
  const blank = (path: string, folderHint?: string): ImportItem => ({
    id: uuid(), path, folderHint, recognized: false, include: true, evidence: [], confidence: 0, needsReview: false, typeUncertain: false, ownerUncertain: false, confirmed: false,
  });
  for (const root of paths) {
    const st = await p.stat(root);
    if (!st.exists) continue;
    if (!st.isDir) { if (exts.has(extOf(root))) out.push(blank(root)); continue; }
    const walk = async (dir: string, rel: string[]) => {
      for (const e of await p.listDir(dir)) {
        if (e.name.startsWith(".")) continue;
        const full = p.join(dir, e.name);
        if (e.isDir) await walk(full, [...rel, e.name]);
        else if (exts.has(extOf(e.name))) out.push(blank(full, rel.length ? rel[0] : baseName(root)));
      }
    };
    await walk(root, []);
  }
  return out;
}

function PathThumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; void thumbnail(path, 52).then((s) => live && setSrc(s)); return () => { live = false; }; }, [path]);
  const frame = { width: 26, height: 32, borderRadius: 4, flex: "none", boxShadow: "0 0 0 .5px rgba(0,0,0,.15)" } as const;
  return src ? <img src={src} alt="" style={{ ...frame, objectFit: "cover", objectPosition: "top", background: "#fff" }} /> : <span style={{ ...frame, background: "var(--band)" }} />;
}

interface Result { count: number; companyIDs: string[]; newCompanyCount: number }

export function ImportView({ paths, resume, context, onClose }: { paths: string[]; resume: boolean; context: ImportContext | null; onClose: () => void }) {
  const { store, router } = useApp();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [drafts, setDrafts] = useState<CompanyDraft[]>([]);
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [working, setWorking] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const finished = useRef(false);
  const state = useRef({ items, drafts });
  state.current = { items, drafts };
  const started = useRef(false);

  const contextCompany = context?.kind === "company" ? store.company(context.id) : undefined;
  const contextGroup = context?.kind === "group" ? store.group(context.id) : undefined;
  const draftOf = (its = state.current.items, ds = state.current.drafts): PendingImport => ({ deviceID: store.deviceID, savedAt: Date.now(), context, rows: its, drafts: ds });

  // 关闭（稍后继续、Esc）：保存未确认的行
  const close = () => {
    router.importContext = null;
    if (!finished.current && !result && state.current.items.length) store.savePendingImport(draftOf());
    onClose();
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (resume && store.pendingImport) { void load(store.pendingImport).then(() => scan([])); }
    else if (store.pendingImport && paths.length) setAsking(true);
    else void scan(paths);
  }, []);

  async function load(p: PendingImport) {
    const rows: ImportItem[] = [];
    for (const r of p.rows) {
      const ok = (await platform().stat(r.path)).exists;
      rows.push(ok ? r : { ...r, missing: true, include: false });
    }
    state.current = { items: rows, drafts: p.drafts };
    setItems(rows); setDrafts(p.drafts);
  }

  async function scan(newPaths: string[]) {
    let its = [...state.current.items];
    let ds = [...state.current.drafts];
    const firstNew = its.length;
    its.push(...(await collect(newPaths)));
    const todo = its.map((x, i) => [x, i] as const).filter(([x]) => !x.recognized && !x.missing).map(([, i]) => i);
    let done = its.length - todo.length;
    setItems(its); setProgress(done); setWorking(todo.length > 0);
    const ctx = recognitionContext(store);
    if (contextGroup) {
      const inGroup = store.companyIDsIn(contextGroup);
      ctx.companies = [...ctx.companies.filter((c) => inGroup.has(c.id)), ...ctx.companies.filter((c) => !inGroup.has(c.id))];
    }
    const defaultJ = store.data.library.jurisdictions[0]?.code ?? "HK";
    const folderMatched = new Set<string>();
    if (!contextCompany) {
      for (let i = firstNew; i < its.length; i++) {
        const hint = its[i].folderHint;
        if (!hint) continue;
        const cid = matchCompany(hint, ctx);
        if (cid) { its[i] = { ...its[i], owner: ref("company", cid) }; folderMatched.add(its[i].id); }
        else { its[i] = { ...its[i], newCompanyKey: hint }; if (!ds.some((d) => d.key === hint)) ds.push({ key: hint, name: hint, jurisdiction: defaultJ, registrationNumber: "", create: true }); }
      }
    }
    for (const i of todo) {
      let it = { ...its[i] };
      let r;
      try { r = await recognizeFile(it.path, ctx); }
      catch { r = { text: "", evidence: ["无法读取文件内容"], confidence: 0, typeFromContent: false, usedOCR: false } as Awaited<ReturnType<typeof recognizeFile>>; }
      Object.assign(it, { typeID: r.typeID, issueDate: r.issueDate, expiryDate: r.expiryDate, evidence: [...r.evidence], companyNameGuess: r.companyNameGuess,
        jurisdiction: r.jurisdiction, registrationNumber: r.registrationNumber, incorporationDate: r.incorporationDate, typeUncertain: !r.typeID || !r.typeFromContent });
      let confidence = r.confidence;
      let ownerUncertain = !r.companyID;
      if (folderMatched.has(it.id) || it.newCompanyKey) { if (!r.companyID) confidence += 0.2; ownerUncertain = false; }
      if (contextCompany) {
        const target = contextCompany;
        it.owner = ref("company", target.id); it.newCompanyKey = undefined; ownerUncertain = false;
        if (!r.companyID) confidence += 0.2;
        let other: string | undefined;
        if (r.companyID && r.companyID !== target.id) other = store.company(r.companyID)?.name ?? r.companyNameGuess;
        else if (!r.companyID && r.companyNameGuess && [...r.companyNameGuess].length > 2) {
          const names = [target.name, ...target.formerNames, ...target.aliases].map((n) => n.toLowerCase()).filter((n) => [...n].length >= 3);
          const g = r.companyNameGuess.toLowerCase();
          if (!names.some((n) => g.includes(n) || n.includes(g))) other = r.companyNameGuess;
        }
        if (other) { ownerUncertain = true; it.evidence.push(`文件上的公司名称与当前公司不同：${other}`); }
      }
      if (!it.owner && !it.newCompanyKey && r.companyID) it.owner = ref("company", r.companyID);
      if (r.typeID && store.docType(r.typeID)?.owner === "person" && it.owner?.kind !== "person") {
        const p = store.data.people.find((x) => r.text.includes(x.name) || x.aliases.some((a) => r.text.toLowerCase().includes(a.toLowerCase())));
        if (p) { it.owner = ref("person", p.id); it.newCompanyKey = undefined; ownerUncertain = false; if (!r.companyID) confidence += 0.2; }
      }
      if (!it.owner && !it.newCompanyKey && r.companyNameGuess && [...r.companyNameGuess].length > 2) {
        const key = "guess:" + r.companyNameGuess.toLowerCase();
        if (!ds.some((d) => d.key === key)) ds.push({ key, name: r.companyNameGuess, jurisdiction: r.jurisdiction ?? defaultJ, incorporationDate: r.incorporationDate, registrationNumber: r.registrationNumber ?? "", create: true });
        it.newCompanyKey = key; ownerUncertain = true;
      }
      if (it.newCompanyKey) {
        const di = ds.findIndex((d) => d.key === it.newCompanyKey);
        if (di >= 0) {
          const d = { ...ds[di] };
          if (r.jurisdiction) d.jurisdiction = r.jurisdiction;
          if (r.typeID && store.docType(r.typeID)?.category === "注册证书") {
            d.incorporationDate = r.incorporationDate ?? r.issueDate ?? d.incorporationDate;
            if (r.registrationNumber) d.registrationNumber = r.registrationNumber;
            if (r.companyNameGuess && [...r.companyNameGuess].length > 2) d.name = r.companyNameGuess;
          }
          ds[di] = d;
        }
      }
      confidence = Math.min(Math.max(confidence, 0), 1);
      it = { ...it, confidence, ownerUncertain, recognized: true,
        needsReview: confidence < 0.8 || !r.typeID || ownerUncertain || (!it.owner && !it.newCompanyKey) };
      its = its.map((x, k) => (k === i ? it : x));
      done++;
      state.current = { items: its, drafts: ds };
      setItems(its); setDrafts(ds); setProgress(done);
    }
    its = its.map((x, i) => [x, i] as const).sort((a, b) => (a[0].needsReview !== b[0].needsReview ? (a[0].needsReview ? -1 : 1) : a[1] - b[1])).map(([x]) => x);
    state.current = { items: its, drafts: ds };
    setItems(its); setDrafts(ds); setWorking(false);
    if (its.length && !finished.current) store.savePendingImport(draftOf(its, ds));
  }

  const update = (id: string, patch: Partial<ImportItem>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const ready = (i: ImportItem) => i.include && !!i.typeID && (!!i.owner || (!!i.newCompanyKey && drafts.some((d) => d.key === i.newCompanyKey && d.create)));
  const resolved = (i: ImportItem) => !i.include || (ready(i) && (!i.needsReview || i.confirmed));
  const replaced = (i: ImportItem): Document | undefined => i.typeID && i.owner ? store.data.documents.find((d) => d.typeID === i.typeID && sameRef(d.owner, i.owner!) && !d.supersededBy && !((d.issueDate ?? store.today) > (i.issueDate ?? store.today))) : undefined;
  const pending = working ? 0 : items.filter((i) => !resolved(i)).length;
  const readyCount = items.filter(ready).length;
  const evidenceParts = (i: ImportItem) => { const p = [...i.evidence]; if (i.folderHint) p.push(`归属参考文件夹名“${i.folderHint}”`); return p.length ? p : ["按文件内容和文件名识别"]; };
  const basis = (i: ImportItem) => (i.missing ? "找不到原文件（已移动或删除），不会归档" : !i.recognized ? "识别中…" : replaced(i) ? versionNotice(replaced(i)!, i.keepBoth ?? false) : "依据：" + evidenceParts(i).join("，"));
  const fullBasis = (i: ImportItem) => { const l = evidenceParts(i); const r = replaced(i); if (r) l.unshift(versionNotice(r, i.keepBoth ?? false)); l.push(`把握程度 ${Math.round(i.confidence * 100)}%`); return l.join("\n"); };
  const typeOptions = (i: ImportItem): DocumentType[] => {
    const j = i.owner ? (i.owner.kind === "company" ? store.company(i.owner.id)?.jurisdiction : undefined) : drafts.find((d) => d.key === i.newCompanyKey)?.jurisdiction;
    const kind = i.owner?.kind ?? "company";
    return store.data.library.documentTypes.filter((t) => t.owner === kind && (!j || typeAppliesTo(t, j)));
  };
  const ownerChoices: [string, string][] = [
    ...drafts.filter((d) => d.create).map((d) => ["new:" + d.key, `新公司：${d.name}`] as [string, string]),
    ...store.data.companies.map((c) => ["company:" + c.id, c.name] as [string, string]),
    ...store.data.people.map((p) => ["person:" + p.id, `人员：${p.name}`] as [string, string]),
    ["create", "新建一家公司…"],
  ];
  const ownerValue = (i: ImportItem) => (i.newCompanyKey ? "new:" + i.newCompanyKey : i.owner ? `${i.owner.kind}:${i.owner.id}` : "");
  const setOwner = (i: ImportItem, v: string) => {
    const patch: Partial<ImportItem> = { newCompanyKey: undefined, owner: undefined };
    if (v === "create") {
      const key = "manual:" + uuid();
      setDrafts((ds) => [...ds, { key, name: i.companyNameGuess ?? i.folderHint ?? baseName(i.path).replace(/\.[^.]+$/, ""), jurisdiction: i.jurisdiction ?? store.data.library.jurisdictions[0]?.code ?? "HK",
        incorporationDate: i.incorporationDate, registrationNumber: i.registrationNumber ?? "", create: true }]);
      patch.newCompanyKey = key;
    } else if (v.startsWith("new:")) patch.newCompanyKey = v.slice(4);
    else if (v.startsWith("company:")) patch.owner = ref("company", v.slice(8));
    else if (v.startsWith("person:")) patch.owner = ref("person", v.slice(7));
    if (v && i.typeID) patch.confirmed = true;
    update(i.id, patch);
  };

  const discard = () => {
    finished.current = true;
    const draft = draftOf();
    store.savePendingImport(null);
    router.importContext = null;
    onClose();
    store.showToast("已放弃这次导入，原文件没有改动。", () => store.savePendingImport(draft));
  };

  const commit = async () => {
    setCommitError(null);
    const byKey = new Map<string, Company>();
    for (const d of drafts) {
      if (!d.create || !items.some((i) => i.newCompanyKey === d.key && i.include)) continue;
      const c = store.newCompanyDraft(d.name, d.jurisdiction);
      byKey.set(d.key, { ...c, registrationNumber: d.registrationNumber, incorporationDate: d.incorporationDate, archive: c.archive ?? emptyArchive() });
    }
    const reqs: ArchiveRequest[] = [];
    for (const i of items.filter(ready)) {
      const owner: NodeRef | undefined = i.owner ?? (i.newCompanyKey && byKey.get(i.newCompanyKey) ? ref("company", byKey.get(i.newCompanyKey)!.id) : undefined);
      if (!owner || !i.typeID) continue;
      reqs.push({ path: i.path, typeID: i.typeID, owner, issued: i.issueDate, expiry: i.expiryDate, keepBoth: !!i.keepBoth && !!replaced(i), sourcePath: i.path });
    }
    if (!reqs.length) return;
    setCommitting(true);
    const ids: string[] = [];
    for (const r of reqs) if (r.owner.kind === "company" && !ids.includes(r.owner.id)) ids.push(r.owner.id);
    await store.snapshotBeforeChange(`导入 ${reqs.length} 份文件前`);
    const before = store.data;
    try {
      const archived = await store.archiveBatch(reqs, [...byKey.values()]);
      let received = "";
      store.commit((d) => {
        if (contextGroup) for (const c of byKey.values()) {
          const g = d.groups.find((x) => x.id === contextGroup.id);
          if (g && !g.extraCompanyIDs.includes(c.id)) g.extraCompanyIDs.push(c.id);
        }
        received = store.closeRequests(d, archived);
      });
      const undoID = store.recordUndo(`归档 ${archived.length} 份文件`, before, archived.map((a) => a.filePath));
      finished.current = true;
      store.savePendingImport(null);
      const n = byKey.size;
      store.showToast(`已归档 ${archived.length} 份文件${received}${n ? `，新建 ${n} 家公司。请补充新公司的财年结束日和中介。` : "。"}`, undoID ? () => store.undoID(undoID) : undefined);
      setResult({ count: archived.length, companyIDs: ids, newCompanyCount: n });
    } catch (e) {
      setCommitError(`归档失败，档案没有改动：${(e instanceof Error ? e.message : String(e))}`);
    } finally { setCommitting(false); }
  };

  if (result) return <ImportDoneView result={result} focusCompanyID={contextCompany?.id} onClose={() => { router.importContext = null; onClose(); }} />;

  if (asking && store.pendingImport) {
    const old = store.pendingImport;
    return (
      <Modal onClose={() => { finished.current = true; onClose(); }}>
        <SheetScaffold title="继续上次的导入，还是开始新的？" width={560}
          subtitle={`上次还有 ${pendingRemaining(old)} 份文件没有归档（${snapshotTitle(old.savedAt)} 保存）。继续时，这次的 ${paths.length} 项会一起加进来识别。`}
          leading={<Button kind="quiet" onClick={() => { finished.current = true; onClose(); }}>取消</Button>}
          trailing={<>
            <Button onClick={() => { store.savePendingImport(null); setAsking(false); void scan(paths); }}>开始新的</Button>
            <Button kind="primary" onClick={() => { setAsking(false); void load(old).then(() => scan(paths)); }}>继续上次的</Button>
          </>}><span /></SheetScaffold>
      </Modal>
    );
  }

  const title = committing ? `正在归档 ${readyCount} 份文件` : working ? `正在识别 ${progress} / ${items.length} 份文件` : pending > 0 ? `识别完成，请确认 ${pending} 处` : "都确认好了，可以归档";
  const base = committing ? "正在复制文件并一次写入档案，请保持窗口打开。" : working ? "逐份读取首页，找出公司名称、注册编号、文件类型和签发日期。全部在这台电脑上完成，不会上传。" : "把握高的已自动归位。琥珀色的需要你看一眼，改好或点“确认”后一起归档。";
  const subtitle = (contextCompany ? `归档到 ${contextCompany.name}。` : contextGroup ? `优先在${latinPad(contextGroup.name)}的公司中匹配，新公司会归入这个集团。` : "") + base;
  const shown = working ? items.filter((i) => i.recognized) : items;
  const hasRecognized = items.some((i) => i.recognized);
  const companies = new Set(items.filter((i) => i.include).map((i) => (i.owner?.kind === "company" ? i.owner.id : i.newCompanyKey ? "new:" + i.newCompanyKey : null)).filter(Boolean)).size;
  const fig = (n: number, l: string) => <span className="row baseline gap4"><span className="num" style={{ fontSize: 16, fontWeight: 600 }}>{n}</span><span className="muted">{l}</span></span>;
  const flag = (on: boolean) => (on ? { borderRadius: "var(--r-field)", boxShadow: "0 0 0 1.5px var(--amber-text)" } : undefined);
  const C = { check: 22, type: 200, owner: 210, date: 150, state: 150 };
  return (
    <Modal onClose={() => !committing && close()} dismissOnEscape={!committing}>
      <SheetScaffold title={title} subtitle={subtitle} width={1240} height={820} onSubmit={() => { if (!working && !committing && !pending && readyCount) void commit(); }}
        leading={committing ? <Spinner /> : !working ? <span className="row" style={{ gap: 18 }}>{fig(items.filter((i) => i.include).length, "份文件")}{fig(companies, "家公司")}{fig(pending, "处待确认")}</span> : null}
        trailing={<>
          {hasRecognized ? <>
            <Button kind="quiet" disabled={committing} title="不归档这些文件，也不保存草稿" onClick={discard}>放弃</Button>
            <Button disabled={committing} title="保存识别结果和你的修改，可以从“文件”页继续" onClick={close}>稍后继续</Button>
          </> : <Button disabled={committing} onClick={close}>取消</Button>}
          <Button kind="primary" disabled={working || committing || pending > 0 || !readyCount} onClick={() => void commit()}>{pending > 0 ? `还有 ${pending} 处待确认` : "归档全部"}</Button>
        </>}>
        <div className="col" style={{ gap: 18 }}>
          {commitError && <div className="row gap6 amber-text selectable"><Icon name="exclamationmark.triangle.fill" />{commitError}</div>}
          {working && <div style={{ height: 6, borderRadius: 3, background: "var(--hairline)", overflow: "hidden" }} role="progressbar" aria-label="识别进度" aria-valuenow={Math.round(progress / Math.max(items.length, 1) * 100)}>
            <div style={{ height: "100%", width: `${(progress / Math.max(items.length, 1)) * 100}%`, background: "var(--ink)", transition: "width var(--standard) var(--ease)" }} />
          </div>}
          {drafts.length > 0 && <FormGroup title="新公司（归档时新建档案）">
            {drafts.map((d, k) => {
              const set = (patch: Partial<CompanyDraft>) => setDrafts((ds) => ds.map((x, j) => (j === k ? { ...x, ...patch } : x)));
              return <div key={d.key} className="row gap10" style={{ opacity: committing ? .6 : 1, pointerEvents: committing ? "none" : undefined }}>
                <Checkbox checked={d.create} onChange={(create) => set({ create })}>建档</Checkbox>
                <span style={{ width: 260 }}><TextField value={d.name} onChange={(name) => set({ name })} placeholder="注册名" /></span>
                <SelectField options={store.data.library.jurisdictions.map((j) => [j.code, j.name] as [string, string])} value={d.jurisdiction} onChange={(jurisdiction) => set({ jurisdiction })} minWidth={150} />
                <span style={{ width: 140 }}><TextField value={d.registrationNumber} onChange={(registrationNumber) => set({ registrationNumber })} placeholder="注册编号" /></span>
                <DateField value={d.incorporationDate} onChange={(incorporationDate) => set({ incorporationDate })} placeholder="成立日期" minWidth={150} />
              </div>;
            })}
          </FormGroup>}
          <div className="col gap4" style={{ opacity: committing ? .6 : 1, pointerEvents: committing ? "none" : undefined }}>
            <div className="band-header" style={{ gap: 10 }}>
              <span style={{ width: C.check }} /><span className="grow">文件</span><span style={{ width: C.type }}>类型</span><span style={{ width: C.owner }}>归属</span>
              <span style={{ width: C.date }}>签发日期</span><span style={{ width: C.date }}>到期日期</span><span style={{ width: C.state }}>结果</span>
            </div>
            {shown.map((i, k) => {
              const unresolved = i.include && i.recognized && !resolved(i);
              const typeFlag = unresolved && (!i.typeID || (i.needsReview && !i.confirmed && i.typeUncertain));
              const ownerFlag = unresolved && ((!i.owner && !i.newCompanyKey) || (i.needsReview && !i.confirmed && i.ownerUncertain));
              return (
                <div key={i.id}>
                  {k > 0 && <div className="hairline" style={{ marginLeft: 16 }} />}
                  <div className="row appear" style={{ gap: 10, padding: "8px 16px", opacity: i.include ? 1 : 0.55 }}>
                    <span style={{ width: C.check, flex: "none" }}><Checkbox checked={i.include} onChange={(include) => !i.missing && update(i.id, { include })} /></span>
                    <div className="row gap8 grow" style={{ minWidth: 0 }}>
                      <PathThumb path={i.path} />
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="ellipsis" title={i.path}>{baseName(i.path)}</span>
                        <span className="t-meta muted ellipsis" title={fullBasis(i)}>{basis(i)}</span>
                        {i.recognized && !i.missing && replaced(i) && <Checkbox checked={i.keepBoth ?? false} onChange={(keepBoth) => update(i.id, { keepBoth })}><span className="t-meta" title="勾选后不替换现有版本，两份都保留为现行文件">另存为一份</span></Checkbox>}
                      </div>
                    </div>
                    <span style={{ width: C.type, flex: "none", ...flag(typeFlag) }}>
                      <SelectField options={typeOptions(i).map((t) => [t.id, t.name + (t.jurisdictions.length === 1 ? `（${t.jurisdictions[0]}）` : "")] as [string, string])}
                        value={i.typeID ?? ""} onChange={(typeID) => update(i.id, { typeID, confirmed: true })} placeholder="请选择类型" minWidth={C.type} maxWidth={C.type} />
                    </span>
                    <span style={{ width: C.owner, flex: "none", ...flag(ownerFlag) }}>
                      <SelectField options={ownerChoices} value={ownerValue(i)} onChange={(v) => setOwner(i, v)} placeholder="请选择归属" minWidth={C.owner} maxWidth={C.owner} />
                    </span>
                    <span style={{ width: C.date, flex: "none" }}><DateField value={i.issueDate} onChange={(issueDate) => update(i.id, { issueDate })} placeholder="可留空" minWidth={C.date} /></span>
                    <span style={{ width: C.date, flex: "none" }}><DateField value={i.expiryDate} onChange={(expiryDate) => update(i.id, { expiryDate })} placeholder="可留空" relativeTo={i.issueDate} minWidth={C.date} /></span>
                    <span style={{ width: C.state, flex: "none" }}>
                      {!i.recognized ? <Spinner size={12} /> : !i.include ? <Pill text="不归档" />
                        : resolved(i) ? <Pill text={i.needsReview ? "✓ 已确认" : "✓ 把握高"} kind="valid" title={i.needsReview ? "你已确认" : `把握程度 ${Math.round(i.confidence * 100)}%`} />
                          : <span className="row gap6"><Pill text="请确认" kind="warn" title={`把握程度 ${Math.round(i.confidence * 100)}%`} />
                            <Button kind="quiet" size="small" disabled={!ready(i)} title={ready(i) ? "类型和归属没问题" : "先选好类型和归属"} onClick={() => update(i.id, { confirmed: true })}>确认</Button></span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 归档完成

export function ImportDoneView({ result, focusCompanyID, onClose }: { result: Result; focusCompanyID?: string; onClose: () => void }) {
  const { store, router } = useApp();
  const [reissue, setReissue] = useState<{ owner: NodeRef; typeIDs: string[] } | null>(null);
  const focus = store.company(focusCompanyID);
  const rows = computeReadiness(store, focus ? [focus.id] : result.companyIDs).map((r, i) => [r, i] as const)
    .sort((a, b) => (a[0].complete !== b[0].complete ? (a[0].complete ? 1 : -1) : a[0].missing.length - b[0].missing.length || a[1] - b[1])).map(([r]) => r);
  const n = result.companyIDs.length;
  let s: string;
  if (focus) { const p = store.archiveProgress(focus); s = `${latinPadEnd(focus.name)}的档案清单已归档 ${p.have}/${p.total} 项。`; }
  else if (!n) s = "文件已归入人员档案。";
  else if (result.newCompanyCount) s = `建立了 ${result.newCompanyCount} 家公司的档案` + (n > result.newCompanyCount ? `，并更新了 ${n - result.newCompanyCount} 家公司。` : "。");
  else s = `更新了 ${n} 家公司的档案。`;
  const readyP = [...new Set(rows.filter((r) => r.complete).map((r) => r.templateName))];
  const incomplete = rows.filter((r) => !r.complete).length;
  if (readyP.length) s += readyP.join("、") + "材料已经可以随时导出" + (incomplete ? "；" : "。");
  if (incomplete) s += `还有 ${incomplete} 项用途缺文件。`;
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={focus ? `已归档到 ${focus.name}` : "归档完成"} width={860} height={820}
        leading={<span className="muted">{focus ? "下一步：在档案清单里补齐缺失文件。" : "下一步：打开公司页，补齐缺失文件。"}</span>}
        trailing={<>
          <Button onClick={onClose}>完成</Button>
          {focus ? <Button kind="primary" onClick={() => { router.companyTab = 0; router.openCompany(focus.id); onClose(); }}>查看档案</Button>
            : <Button kind="primary" onClick={() => { const first = rows[0] && store.data.companies.find((c) => rows.some((r) => r.companyID === c.id)); if (first) router.openCompany(first.id); else router.go("companies"); onClose(); }}>打开公司页</Button>}
        </>}>
        <div className="col gap32">
          <div className="row" style={{ gap: 28, padding: 32, borderRadius: 26, background: "var(--lime)", color: "var(--on-lime)" }}>
            <ArchiveSeal size={120} />
            <div className="col gap8 grow">
              <span style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}><span className="num" style={{ letterSpacing: -2.2, marginRight: 10 }}>{result.count}</span>份已归档</span>
              <span style={{ fontSize: 15, opacity: .8 }}>{s}</span>
            </div>
          </div>
          {rows.length > 0 && <>
            <div className="col gap4">
              <span className="t-section">随时能出哪些材料</span>
              <span className="t-body muted">{focus ? "按用途检查还缺什么。" : "按用途检查每家公司缺什么。"}</span>
            </div>
            <div className="col" style={{ background: "var(--band)", borderRadius: "var(--r-surface)" }}>
              {rows.map((r, i) => (
                <div key={r.templateID + r.companyID}>
                  {i > 0 && <div className="hairline" />}
                  <div className="row gap16" style={{ padding: "18px 22px" }}>
                    <div className="col gap4" style={{ width: 220, flex: "none" }}><span className="t-row">{r.templateName}</span><span className="t-meta muted ellipsis">{r.companyName}</span></div>
                    <div className="col gap6 grow">
                      <ProgressTrack value={r.total ? r.got / r.total : 0} width={240} />
                      <span className="t-meta muted" title={r.complete ? "" : r.missingDetail.join("\n")}>{r.complete ? "齐全，可随时导出" : "还缺：" + r.missing.join("、")}</span>
                    </div>
                    <span className="row" style={{ width: 140, justifyContent: "flex-end", flex: "none" }}><PurposeReadinessAction row={r} onReissue={(owner, typeIDs) => setReissue({ owner, typeIDs })} /></span>
                  </div>
                </div>
              ))}
            </div>
          </>}
        </div>
      </SheetScaffold>
      {reissue && <ReissueRequestSheet owner={reissue.owner} typeIDs={reissue.typeIDs} onClose={() => setReissue(null)} />}
    </Modal>
  );
}

/** Charter 的印章：先画出圆环，再弹出中心圆点。 */
export function ArchiveSeal({ size = 120 }: { size?: number }) {
  const u = size / 1024;
  const r = 300 * u, c = 2 * Math.PI * r, arc = (1520 / 1885) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ flex: "none" }}>
      <rect width={size} height={size} rx={230 * u} fill="var(--emphasis)" />
      <circle className="seal-ring" cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lime)" strokeWidth={96 * u} strokeLinecap="round"
        strokeDasharray={`${arc} ${c}`} transform={`rotate(28 ${size / 2} ${size / 2})`} style={{ ["--len" as string]: arc }} />
      <circle cx={size / 2} cy={size / 2} r={150 * u} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={18 * u} />
      <circle className="seal-dot" cx={size / 2} cy={size / 2} r={52 * u} fill="var(--lime)" />
    </svg>
  );
}

void D;
