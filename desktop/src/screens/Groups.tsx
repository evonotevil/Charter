// 集团：新建/编辑（含图标）、添加上级或下级、集中管理成员。移植自 GroupViews.swift 与 GroupMembershipViews.swift。

import { useEffect, useState } from "react";
import type { Day } from "../domain/day";
import { type CorporateGroup, type NodeKind, type NodeRef, ref, sameRef, uuid, latinPadStart } from "../domain/models";
import { isMember, sourceLabel } from "../domain/groups";
import { safeName } from "../domain/folder";
import { useApp } from "../state/hooks";
import type { Store } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Checkbox, ConfirmSheet, DateField, FieldRow, FormGroup, Modal, Pill, Segmented, SelectField, SheetScaffold, Switch, TextField } from "../ui/kit";
import { PercentField } from "./Editors";

// MARK: - 选择或新建节点

export type NodeChoice = { kind: "existing"; ref: NodeRef } | { kind: "newPerson"; name: string } | { kind: "newCompany"; name: string; jurisdiction: string };
const choiceValid = (c: NodeChoice | null) => !!c && (c.kind === "existing" || !!c.name.trim());
export function resolveChoice(store: Store, c: NodeChoice): NodeRef {
  if (c.kind === "existing") return c.ref;
  if (c.kind === "newPerson") return ref("person", store.createPerson(c.name.trim()).id);
  return ref("company", store.createCompany(c.name.trim(), c.jurisdiction).id);
}

export function NodePicker({ title, onChange, allowPerson = true, allowCompany = true, exclude = [] }: {
  title: string; onChange: (c: NodeChoice | null) => void; allowPerson?: boolean; allowCompany?: boolean; exclude?: NodeRef[];
}) {
  const { store } = useApp();
  const [kind, setKind] = useState<NodeKind>(allowCompany ? "company" : "person");
  const [existing, setExisting] = useState("");
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState(store.data.library.jurisdictions.some((j) => j.code === "HK") ? "HK" : store.data.library.jurisdictions[0]?.code ?? "HK");
  useEffect(() => {
    onChange(existing ? { kind: "existing", ref: ref(kind, existing) } : kind === "company" ? { kind: "newCompany", name, jurisdiction } : { kind: "newPerson", name });
  }, [kind, existing, name, jurisdiction]);
  const ex = (k: NodeKind, id: string) => exclude.some((r) => r.kind === k && r.id === id);
  const options: [string, string][] = [["", kind === "company" ? "新建一家公司…" : "新建一位自然人…"],
    ...(kind === "company" ? [...store.data.companies].sort((a, b) => a.name.localeCompare(b.name, "zh")).filter((c) => !ex("company", c.id)).map((c) => [c.id, c.name] as [string, string])
      : [...store.data.people].sort((a, b) => a.name.localeCompare(b.name, "zh")).filter((p) => !ex("person", p.id)).map((p) => [p.id, p.name] as [string, string]))];
  const both = allowPerson && allowCompany;
  return (
    <>
      {both && <FieldRow label={title}><Segmented options={[["company", "公司"], ["person", "自然人"]] as [NodeKind, string][]} value={kind} onChange={(k) => { setKind(k); setExisting(""); }} /></FieldRow>}
      <FieldRow label={both ? "选择" : title}><SelectField options={options} value={existing} onChange={setExisting} minWidth={260} /></FieldRow>
      {!existing && <FieldRow label={kind === "company" ? "注册名" : "姓名"}><TextField value={name} onChange={setName} placeholder={kind === "company" ? "公司注册名" : "姓名"} /></FieldRow>}
      {!existing && kind === "company" && <FieldRow label="法域"><SelectField options={store.data.library.jurisdictions.map((j) => [j.code, j.name] as [string, string])} value={jurisdiction} onChange={setJurisdiction} minWidth={260} /></FieldRow>}
    </>
  );
}

// MARK: - 集团图标



// MARK: - 添加上级 / 下级

export function RelationSheet({ companyID, upward, onClose }: { companyID: string; upward: boolean; onClose: () => void }) {
  const { store } = useApp();
  const [other, setOther] = useState<NodeChoice | null>(null);
  const [percent, setPercent] = useState(100);
  const [nominee, setNominee] = useState(false);
  const [beneficial, setBeneficial] = useState<NodeChoice | null>(null);
  const [from, setFrom] = useState<Day | undefined>();
  const [promoteTop, setPromoteTop] = useState(true);
  const company = store.company(companyID);
  const self = ref("company", companyID);
  const topOf = store.data.groups.filter((g) => g.tops.some((t) => sameRef(t, self)));
  const bad = percent <= 0 || percent > 100;
  const canSave = choiceValid(other) && !bad && (!nominee || choiceValid(beneficial));
  const save = () => {
    if (!canSave || !other) return;
    const node = resolveChoice(store, other);
    if (upward) {
      const b = nominee && beneficial ? resolveChoice(store, beneficial) : undefined;
      if (!store.addHolding({ holder: node, companyID, percent, nominee, beneficialOwner: b, from })) return;
      if (promoteTop) for (const g of topOf) store.updateGroup({ ...g, tops: g.tops.map((t) => (sameRef(t, self) ? b ?? node : t)) });
    } else if (!store.addHolding({ holder: self, companyID: node.id, percent, nominee: false, from })) return;
    store.commit((d) => store.tidyGroups(d));
    store.showToast(upward ? "已添加上级，层级已重新排列。" : "已添加下级公司，层级已重新排列。");
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={upward ? "添加上级（股东）" : "添加下级公司"} subtitle={upward ? `为 ${company?.name ?? ""} 添加一位股东。` : `为 ${company?.name ?? ""} 添加一家下级公司。`} width={580} height={760} onSubmit={save}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!canSave} onClick={save}>添加</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title={upward ? "股东" : "下级公司"}><NodePicker title="类型" onChange={setOther} allowPerson={upward} exclude={[self]} /></FormGroup>
          <FormGroup title="持股">
            <FieldRow label={upward ? "持有本公司" : "本公司持有"} error={bad ? "持股比例需大于 0、不超过 100%" : null}><PercentField value={percent} onChange={setPercent} invalid={bad} /></FieldRow>
            <FieldRow label="生效日期" hint="未知时可留空"><DateField value={from} onChange={setFrom} placeholder="可留空" /></FieldRow>
            {upward && <Checkbox checked={nominee} onChange={setNominee}>这位股东是名义股东，代他人持有</Checkbox>}
          </FormGroup>
          {upward && nominee && <FormGroup title="实际受益人"><NodePicker title="类型" onChange={setBeneficial} exclude={[self]} /></FormGroup>}
          {upward && topOf.length > 0 && <FormGroup title="集团顶层">
            <Switch checked={promoteTop} onChange={setPromoteTop}>把新上级设为「{topOf.map((g) => g.name).join("、")}」的顶层</Switch>
            <span className="t-meta muted">{company?.name} 现在是这个集团的顶层。打开后，集团顶层改为新上级，{company?.name} 排到它下面。</span>
          </FormGroup>}
          <span className="t-meta muted">保存后，集团层级和股权结构图会按新的持股关系自动重新排列。</span>
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 集中管理集团成员


