// 按 router.sheet 显示对应的弹窗。

import { useApp } from "../state/hooks";
import { CompanyItemsSheet } from "./Companies";
import { CompanyEditor, ObligationSheet } from "./Editors";
import { GroupEditor, GroupMembersSheet, RelationSheet } from "./Groups";
import { ImportView } from "./Import";
import { ChainQuery, QuickSearch } from "./Query";
import { DocumentSheet, ExportSheet, PacketView } from "./Packet";
import { ChangeWizard } from "./ChangeWizard";
import { RuleConfirmSheet } from "./common";

export function SheetHost() {
  const { store, router } = useApp();
  const s = router.sheet;
  if (!s) return null;
  const close = () => router.close();
  // 每种弹窗用不同的 key，换弹窗时状态重置
  const key = JSON.stringify(s);
  switch (s.kind) {
    case "newCompany": return <CompanyEditor key={key} onClose={close} />;
    case "newCompanyInGroup": return <CompanyEditor key={key} groupID={s.group} onClose={close} />;
    case "editCompany": return <CompanyEditor key={key} companyID={s.companyID} onClose={close} />;
    case "newGroup": return <GroupEditor key={key} onClose={close} />;
    case "editGroup": return <GroupEditor key={key} groupID={s.group} onClose={close} />;
    case "groupMembers": return <GroupMembersSheet key={key} groupID={s.group} onClose={close} />;
    case "addRelation": return <RelationSheet key={key} companyID={s.companyID} upward={s.upward} onClose={close} />;
    case "companyItems": return <CompanyItemsSheet key={key} companyID={s.companyID} onClose={close} />;
    case "quickSearch": return <QuickSearch key={key} onClose={close} />;
    case "chainQuery": return <ChainQuery key={key} from={s.from} to={s.to} onClose={close} />;
    case "exportAll": return <ExportSheet key={key} companyID={s.companyID} onClose={close} />;
    case "importFiles": return <ImportView key={key} paths={s.paths} resume={false} context={router.importContext} onClose={close} />;
    case "resumeImport": return <ImportView key={key} paths={[]} resume context={store.pendingImport?.context ?? null} onClose={close} />;
    case "packet": return <PacketView key={key} companyID={s.companyID} onClose={close} />;
    case "packetFor": return <PacketView key={key} companyID={s.companyID} purposeID={s.purposeID} onClose={close} />;
    case "change": return <ChangeWizard key={key} companyID={s.companyID} onClose={close} />;
    case "changeFrom": return <ChangeWizard key={key} companyID={s.companyID} kind={s.changeKind} endingAppointmentID={s.appointmentID} endingHoldingID={s.holdingID} onClose={close} />;
    case "obligation": return <ObligationSheet key={key} obligationKey={s.key} onClose={close} />;
    case "document": return <DocumentSheet key={key} documentID={s.id} onClose={close} />;
    case "confirmRule": return <RuleConfirmSheet key={key} ruleID={s.ruleID} companyID={s.companyID} onClose={close} />;
  }
}
