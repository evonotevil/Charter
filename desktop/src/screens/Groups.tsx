// 集团：新建/编辑（含图标）、添加上级或下级、集中管理成员。移植自 GroupViews.swift 与 GroupMembershipViews.swift。

import { useEffect, useState } from "react";
import type { Day } from "../domain/day";
import { type CorporateGroup, type NodeKind, type NodeRef, ref, sameRef, uuid } from "../domain/models";
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
const choiceLabel = (store: Store, c: NodeChoice) => (c.kind === "existing" ? store.nameOf(c.ref) : c.kind === "newPerson" ? `${c.name}（新建自然人）` : `${c.name}（新建 ${store.jurisdictionName(c.jurisdiction)} 公司）`);

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

async function squarePNG(bytes: Uint8Array, side = 256): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error("无法读取图片")); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    if (!s) throw new Error("图片为空");
    const c = document.createElement("canvas");
    c.width = c.height = side;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    if (!blob) throw new Error("无法生成图片");
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

export function GroupEditor({ groupID: editID, onClose }: { groupID?: string; onClose: () => void }) {
  const { store, router } = useApp();
  const original = store.group(editID);
  const [id] = useState(original?.id ?? uuid());
  const [name, setName] = useState(original?.name ?? "");
  const [tops, setTops] = useState<NodeChoice[]>(original?.tops.map((r) => ({ kind: "existing", ref: r })) ?? []);
  const [adding, setAdding] = useState<NodeChoice | null>(null);
  const [pickerToken, setPickerToken] = useState(0);
  const [notes, setNotes] = useState(original?.notes ?? "");
  const [pendingIcon, setPendingIcon] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [iconRemoved, setIconRemoved] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [existingIcon, setExistingIcon] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const iconDir = store.folder.groupIconsDir;
  useEffect(() => {
    if (!original?.iconFileName) return;
    const p = platform().join(iconDir, original.iconFileName);
    void platform().stat(p).then((s) => s.exists && setExistingIcon(platform().fileURL(p) + `?v=${s.mtime}`));
  }, []);
  const nameError = attempted && !name.trim() ? "请填写集团名称" : null;
  const pick = async () => {
    setIconError(null);
    const p = (await platform().pickFiles({ multiple: false, extensions: ["png", "jpg", "jpeg"] }))[0];
    if (!p) return;
    try {
      const png = await squarePNG(await platform().readBytes(p));
      setPendingIcon({ bytes: png, url: URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" })) });
      setIconRemoved(false);
    } catch { setIconError("无法读取这张图片，请换一张 PNG 或 JPEG。"); }
  };
  const save = async () => {
    setAttempted(true);
    if (!name.trim()) return;
    const all = [...tops];
    if (!all.length && adding && choiceValid(adding)) all.push(adding);
    const refs = all.map((c) => resolveChoice(store, c));
    const g: CorporateGroup = { ...(original ?? { id, name: "", tops: [], extraCompanyIDs: [], notes: "" }), name: name.trim(), tops: refs, notes };
    const p = platform();
    if (pendingIcon) {
      try { await p.mkdirs(iconDir); const file = safeName(g.id) + ".png"; await p.writeBytes(p.join(iconDir, file), pendingIcon.bytes); g.iconFileName = file; }
      catch (e) { store.setError(`集团图标没有保存：${(e as Error).message}`); }
    } else if (iconRemoved && g.iconFileName) {
      try { await p.removeFile(p.join(iconDir, g.iconFileName)); } catch { /* 忽略 */ }
      g.iconFileName = undefined;
    }
    store.updateGroup(g);
    store.commit((d) => store.tidyGroups(d));
    router.update((r) => { r.groupFilter = g.id; r.showCalendar = false; r.section = "overview"; });
    store.showToast(original ? `已保存 ${g.name}` : `已创建集团 ${g.name}`);
    onClose();
  };
  const hasIcon = !!pendingIcon || (!iconRemoved && !!original?.iconFileName);
  const initial = [...name.trim()][0] ?? "集";
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={original ? "编辑集团" : "新建集团"} subtitle="顶层可以是最终实际控制人，也可以是已知的最顶层公司。下面的公司会按持股关系自动排层。" width={580} height={760} onSubmit={() => void save()}
        leading={original ? <Button onClick={() => setConfirmDelete(true)}>删除集团</Button> : null}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={() => void save()}>{original ? "保存" : "创建"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title="基本信息">
            <FieldRow label="集团名称" error={nameError}><TextField value={name} onChange={setName} placeholder="例如：远澜集团" autoFocus={!original} invalid={!!nameError} /></FieldRow>
            <FieldRow label="集团图标" hint="PNG 或 JPEG，会裁成正方形；未设置时显示名称首字。" error={iconError}>
              <div className="row gap12">
                {pendingIcon ? <img src={pendingIcon.url} alt="" style={{ width: 40, height: 40, borderRadius: 11 }} />
                  : existingIcon && !iconRemoved ? <img src={existingIcon} alt="" style={{ width: 40, height: 40, borderRadius: 11, objectFit: "cover" }} />
                    : <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--hairline)", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 600 }}>{initial}</span>}
                <Button size="small" onClick={() => void pick()}>选择图片…</Button>
                {hasIcon && <Button kind="quiet" size="small" onClick={() => { setPendingIcon(null); setIconRemoved(true); setIconError(null); }}>移除</Button>}
              </div>
            </FieldRow>
            <FieldRow label="备注"><TextField multiline rows={2} value={notes} onChange={setNotes} placeholder="可选" /></FieldRow>
          </FormGroup>
          <FormGroup title="顶层">
            {!tops.length && <span className="muted">还没有顶层。</span>}
            {tops.map((t, i) => (
              <div key={i} className="row gap10">
                <span className="muted" style={{ width: 18 }}><Icon name={(t.kind === "existing" ? t.ref.kind === "person" : t.kind === "newPerson") ? "person.fill" : "building.2"} size={13} /></span>
                <span className="ellipsis grow">{choiceLabel(store, t)}</span>
                <Button kind="quiet" size="small" onClick={() => setTops(tops.filter((_, k) => k !== i))}>移除</Button>
              </div>
            ))}
          </FormGroup>
          <FormGroup title="添加顶层">
            <NodePicker key={pickerToken} title="类型" onChange={setAdding} exclude={tops.flatMap((t) => (t.kind === "existing" ? [t.ref] : []))} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button size="small" disabled={!choiceValid(adding)} onClick={() => { if (adding && choiceValid(adding)) { setTops([...tops, adding]); setAdding(null); setPickerToken(pickerToken + 1); } }}>加为顶层</Button>
            </div>
          </FormGroup>
        </div>
      </SheetScaffold>
      {confirmDelete && original && <ConfirmSheet title={`删除集团“${name}”？`} message="只删除集团本身。公司、人员、持股关系和文件都不受影响。" confirmTitle="删除" destructive
        onClose={() => setConfirmDelete(false)} onConfirm={() => {
          store.deleteGroup(original);
          if (original.iconFileName) void platform().removeFile(platform().join(iconDir, original.iconFileName)).catch(() => {});
          if (router.groupFilter === original.id) router.set("groupFilter", null);
          onClose();
        }} />}
    </Modal>
  );
}

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

type Change = "add" | "remove" | "restore";
const changeLabel: Record<Change, string> = { add: "将加入", remove: "将移出", restore: "将恢复" };

export function GroupMembersSheet({ groupID: initial, onClose }: { groupID: string; onClose: () => void }) {
  const { store } = useApp();
  const [groupID, setGroupID] = useState(initial);
  const [filter, setFilter] = useState<"all" | "members" | "duplicates" | "ungrouped">("all");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Map<string, Change>>(new Map());
  const [reviewing, setReviewing] = useState(false);
  const [query, setQuery] = useState("");
  const g = store.group(groupID);
  const q = query.trim().toLowerCase();
  const companies = !g ? [] : store.data.companies.filter((c) => {
    if (q && ![c.name, ...c.formerNames, ...c.aliases, c.registrationNumber].join(" ").toLowerCase().includes(q)) return false;
    if (filter === "members") { const m = store.membership(c.id, g); return isMember(m) || m.kind === "excluded"; }
    if (filter === "duplicates") return store.groupsContaining(c.id).length > 1;
    if (filter === "ungrouped") return !store.groupsContaining(c.id).length;
    return true;
  }).sort((a, b) => { const ma = isMember(store.membership(a.id, g)), mb = isMember(store.membership(b.id, g)); return ma !== mb ? (ma ? -1 : 1) : a.name.localeCompare(b.name, "zh"); });
  const stage = (ch: Change) => {
    if (!g) return;
    const next = new Map(plan);
    for (const id of selection) {
      const m = store.membership(id, g);
      const ok = ch === "add" ? !isMember(m) : ch === "remove" ? isMember(m) && m.kind !== "top" : m.kind === "excluded";
      if (ok) next.set(id, ch); else next.delete(id);
    }
    setPlan(next); setSelection(new Set());
  };
  const apply = () => {
    const name = g?.name ?? "集团";
    const u = store.undoable("调整集团成员", () => {
      for (const [id, ch] of plan) {
        if (ch === "add") store.addToGroup(id, groupID);
        else if (ch === "remove") store.moveOut(id, groupID);
        else store.restoreToGroup(id, groupID);
      }
      store.commit((d) => store.tidyGroups(d));
    });
    const after = store.group(groupID);
    store.showToast(`已更新${name}：现有 ${after ? store.companyIDsIn(after).size : 0} 家公司`, u ? () => store.undoID(u) : undefined);
    onClose();
  };
  const nameOf = (id: string) => store.company(id)?.name ?? id;
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={reviewing ? "确认集团成员变更" : "管理集团成员"} width={760} height={680} onSubmit={() => (reviewing ? apply() : plan.size && setReviewing(true))}
        subtitle={reviewing ? `以下变化会应用到${g?.name ?? "集团"}，之后可以撤销。` : "勾选公司后批量加入、移出或恢复。手动设置优先于股权推导。"}
        leading={!reviewing ? <span className="t-meta muted">{plan.size ? `${plan.size} 项待应用` : "还没有变更"}</span> : null}
        trailing={reviewing ? <><Button onClick={() => setReviewing(false)}>返回修改</Button><Button kind="primary" onClick={apply}>应用</Button></>
          : <><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!plan.size} onClick={() => setReviewing(true)}>检查变更</Button></>}>
        {reviewing ? (
          <div className="col gap16">
            {(["add", "remove", "restore"] as Change[]).map((ch) => {
              const ids = [...plan].filter(([, c]) => c === ch).map(([id]) => id).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "zh"));
              return ids.length ? <FormGroup key={ch} title={`${changeLabel[ch].replace("将", "")}（${ids.length}）`}>{ids.map((id) => <span key={id}>{nameOf(id)}</span>)}</FormGroup> : null;
            })}
            <span className="t-meta muted">移出按股权推导出的公司时，会记为“已排除”，之后股权变化也不会再把它自动纳入。</span>
          </div>
        ) : (
          <div className="col gap12" style={{ height: "100%" }}>
            <div className="row gap8">
              <SelectField options={store.data.groups.map((x) => [x.id, x.name] as [string, string])} value={groupID} onChange={(v) => { setGroupID(v); setPlan(new Map()); setSelection(new Set()); }} minWidth={200} />
              <Segmented options={[["all", "全部公司"], ["members", "本集团"], ["duplicates", "重复归属"], ["ungrouped", "未归入"]] as ["all" | "members" | "duplicates" | "ungrouped", string][]} value={filter} onChange={setFilter} />
              <span className="spacer" />
              <span style={{ width: 140 }}><TextField value={query} onChange={setQuery} placeholder="筛选" /></span>
            </div>
            <div className="row gap8">
              <span className="t-meta muted grow">{selection.size ? `已选 ${selection.size} 家` : "未选择"}</span>
              <Button size="small" disabled={!selection.size} onClick={() => stage("add")}>加入</Button>
              <Button size="small" disabled={!selection.size} onClick={() => stage("remove")}>移出</Button>
              <Button kind="quiet" size="small" disabled={!selection.size} onClick={() => stage("restore")}>恢复推导</Button>
              <Button kind="quiet" size="small" disabled={!selection.size} onClick={() => setSelection(new Set())}>清除选择</Button>
            </div>
            <div className="surface scroll" style={{ minHeight: 240, flex: 1 }}>
              {g && companies.map((c) => {
                const m = store.membership(c.id, g);
                const others = store.groupsContaining(c.id).filter((x) => x.id !== g.id);
                const p = plan.get(c.id);
                const toggle = () => { const s = new Set(selection); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); setSelection(s); };
                return (
                  <div key={c.id}>
                    <div className="row gap12 hover-band" style={{ padding: "10px 16px", cursor: "default" }} onClick={toggle}>
                      <span onClick={(e) => e.stopPropagation()}><Checkbox checked={selection.has(c.id)} onChange={toggle} /></span>
                      <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                        <span className="t-row ellipsis">{c.name}</span>
                        <span className="t-meta muted ellipsis">{m.kind === "none" ? store.jurisdictionName(c.jurisdiction) : store.membershipExplanation(c.id, g)}</span>
                      </span>
                      {others.map((o) => <Pill key={o.id} text={o.name} kind="outline" />)}
                      {m.kind !== "none" && <Pill text={sourceLabel(m)} kind={isMember(m) ? "neutral" : "outline"} />}
                      {p && <button title="点按取消这项变更" onClick={(e) => { e.stopPropagation(); const n = new Map(plan); n.delete(c.id); setPlan(n); }}><Pill text={changeLabel[p]} kind="lime" /></button>}
                    </div>
                    <div className="hairline" />
                  </div>
                );
              })}
              {!companies.length && <div className="t-body muted" style={{ padding: 16 }}>没有符合条件的公司。</div>}
            </div>
          </div>
        )}
      </SheetScaffold>
    </Modal>
  );
}
