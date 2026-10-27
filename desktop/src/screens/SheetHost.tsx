// 按 router.sheet 显示对应的弹窗。

import { useApp } from "../state/hooks";
import { CompanyItemsSheet } from "./Companies";
import { ScopeSheet } from "./Scope";
import { TrashConfirmSheet } from "./Lifecycle";
import { CompanyEditor } from "./Editors";
import { RelationSheet } from "./Groups";
import { ImportView } from "./Import";
import { ChainQuery, QuickSearch } from "./Query";
import { DocumentSheet, ExportSheet, PacketView } from "./Packet";
import { NewCompanySheet } from "./NewCompany";

export function SheetHost() {
  const { store, router } = useApp();
  const s = router.sheet;
  if (!s) return null;
  const close = () => router.close();
  // 每种弹窗用不同的 key，换弹窗时状态重置
  const key = JSON.stringify(s);
  switch (s.kind) {
    case "newCompany": return <NewCompanySheet key={key} onClose={close} />;
    case "newCompanyInGroup": return <NewCompanySheet key={key} groupID={s.group} onClose={close} />;
    case "editCompany": return <CompanyEditor key={key} companyID={s.companyID} onClose={close} />;
    case "newGroup": { queueMicrotask(() => { router.sheet = null; router.openSettings("groups", "new"); }); return null; }
    case "editGroup": { const id = s.group; queueMicrotask(() => { router.sheet = null; router.openSettings("groups", id); }); return null; }
    case "groupMembers": { const id = s.group; queueMicrotask(() => { router.sheet = null; router.openSettings("groups", id); }); return null; }
    case "addRelation": return <RelationSheet key={key} companyID={s.companyID} upward={s.upward} onClose={close} />;
    case "companyItems": return <CompanyItemsSheet key={key} companyID={s.companyID} onClose={close} />;
    case "trashDocs": return <TrashConfirmSheet key={key} ids={s.ids} onClose={close} />;
    case "scope": return <ScopeSheet key={key} kind={s.ownerKind} owners={s.owners} onClose={close} />;
    case "quickSearch": return <QuickSearch key={key} onClose={close} />;
    case "chainQuery": return <ChainQuery key={key} from={s.from} to={s.to} onClose={close} />;
    case "exportAll": return <ExportSheet key={key} companyID={s.companyID} onClose={close} />;
    case "importFiles": return <ImportView key={key} paths={s.paths} resume={false} context={router.importContext} onClose={close} />;
    case "resumeImport": return <ImportView key={key} paths={[]} resume context={store.pendingImport?.context ?? null} onClose={close} />;
    case "packet": return <PacketView key={key} companyID={s.companyID} onClose={close} />;
    case "packetFor": return <PacketView key={key} companyID={s.companyID} purposeID={s.purposeID} onClose={close} />;
    case "change": { const id = s.companyID; queueMicrotask(() => { router.sheet = null; router.openCompany(id); }); return null; }
    case "changeFrom": { const id = s.companyID; queueMicrotask(() => { router.sheet = null; router.openCompany(id); }); return null; }
    case "obligation": { const k = s.key; queueMicrotask(() => { router.sheet = null; router.openDue(k); }); return null; }
    case "document": return <DocumentSheet key={key} documentID={s.id} onClose={close} />;
    case "confirmRule": queueMicrotask(() => { router.sheet = null; router.openSettings("rules"); }); return null;
  }
}
