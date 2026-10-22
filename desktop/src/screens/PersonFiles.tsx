// 个人文件：护照、身份证件、住址证明、简历、董事同意书、委任书、辞任书、个人声明、背景调查。
// 拖入或上传即归档到 files/people/<姓名>/；文件可同时关联一家公司；到期前和公司文件一样提醒。

import { useState } from "react";
import { type Person, archiveCounts, archiveItemName, isHeld, ref } from "../domain/models";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Button, Card, Pill, PopoverRow, ProgressTrack } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { useStageFile } from "./common";
import { StatusTag, statusOfArchive } from "./Status";
import { PickChip } from "./PropChips";

export function PersonFiles({ person }: { person: Person }) {
  const { store, router } = useApp();
  const [startStage, stageNode, busy] = useStageFile();
  const [showOptional, setShowOptional] = useState(false);
  const items = store.personArchive(person.id);
  const required = items.filter((i) => i.required);
  const optionalHeld = items.filter((i) => !i.required && i.document);
  const optionalMissing = items.filter((i) => !i.required && !i.document);
  const cnt = archiveCounts(required);
  const alerts = items.filter((i) => i.state.kind === "expired" || i.state.kind === "expiring");
  const owner = ref("person", person.id);
  // 默认关联到此人唯一任职的公司
  const companies = [...new Set(store.data.appointments.filter((a) => a.personID === person.id).map((a) => a.companyID))];
  const upload = (typeID?: string, path?: string) => void startStage({
    owner, typeID, path,
    onArchived: (d) => { if (companies.length === 1 && d.typeID.startsWith("person.") && ["person.consent", "person.appointment", "person.resignation"].includes(d.typeID)) store.setDocumentCompany(d.id, companies[0]); },
  });
  const onDrop = (paths: string[]) => {
    if (paths.length === 1) upload(undefined, paths[0]);
    else router.startImport(paths, null);
  };
  const row = (i: (typeof items)[number]) => {
    const d = i.document;
    const st = statusOfArchive(i.state);
    const date = d ? (d.expiryDate ? `${d.expiryDate} 到期` : d.issueDate ? `${d.issueDate} 签发` : "") : "";
    const co = d?.relatedCompanyID ? store.company(d.relatedCompanyID) : undefined;
    const tone = !d ? "missing" : i.state.kind === "expired" ? "bad" : i.state.kind === "expiring" || i.state.kind === "needsUpdate" ? "warn" : "";
    return (
      <div key={i.typeID} className="doc-row">
        <span className={`doc-ic ${tone}`}><Icon name={d ? "doc.text" : "plus"} size={15} /></span>
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="row gap6" style={{ minWidth: 0 }}>
            <span className="ellipsis" style={{ fontWeight: 700, color: isHeld(i.state) ? undefined : "var(--muted)" }}>{archiveItemName(i)}</span>
            {i.required && !d && <Pill text="必备" kind="outline" />}
          </span>
          {d && <span className="t-meta muted ellipsis">{[date, /^[0-9A-F-]{36}\.[a-z]+$/i.test(d.originalFileName) ? "" : d.originalFileName].filter(Boolean).join(" · ")}</span>}
        </span>
        {d && <PickChip label={co ? co.name : "关联公司"} title="这份文件和哪家公司有关" width={260} style={co ? undefined : { color: "var(--muted)" }}>
          {(close) => <>
            <PopoverRow title="不关联公司" checked={!co} onClick={() => { close(); store.setDocumentCompany(d.id, undefined); }} />
            {[...companies, ...store.data.companies.map((c) => c.id).filter((id) => !companies.includes(id))].map((id) => {
              const c = store.company(id);
              return c && <PopoverRow key={id} title={`${c.jurisdiction} ${c.name}`} checked={co?.id === id} onClick={() => { close(); store.setDocumentCompany(d.id, id); }} />;
            })}
          </>}
        </PickChip>}
        {d ? <StatusTag s={st} /> : null}
        {d ? <>
          <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: d.id })}>查看</Button>
          <Button size="small" kind="quiet" title="上传新版本，旧版保留在历史版本中" onClick={() => void startStage({ owner, typeID: i.typeID, replaces: d })}>更新</Button>
        </> : <Button size="small" onClick={() => upload(i.typeID)}>上传</Button>}
      </div>
    );
  };
  return (
    <DropTarget message={`松开即可归档到 ${person.name} 的个人文件`} onDrop={onDrop}>
      <Card title={<span className="col gap4"><h2 className="t-card">个人文件</h2>
        <span className="row gap10"><ProgressTrack value={cnt.total ? cnt.held / cnt.total : 1} width={120} /><span className="t-meta muted num">必备 {cnt.held}/{cnt.total}{cnt.missing ? ` · 缺 ${cnt.missing}` : " · 齐全"}</span></span></span>}
        action={<span className="row gap8">{busy && <span className="busy-chip" role="status"><span className="ring" />正在识别…</span>}<Button size="small" kind="primary" icon="square.and.arrow.down" onClick={() => upload()}>上传</Button></span>}>
        {alerts.length > 0 && <div className="row gap8" style={{ padding: "10px 12px", borderRadius: 12, background: alerts.some((a) => a.state.kind === "expired") ? "var(--red-soft)" : "var(--amber-soft)", color: alerts.some((a) => a.state.kind === "expired") ? "var(--red-text)" : "var(--amber-text)", fontWeight: 700 }}>
          <Icon name="clock" size={14} />{alerts.map((a) => `${archiveItemName(a)}${a.state.kind === "expired" ? "已过期" : "快到期"}`).join("，")}。到期前会和公司文件一样提醒。
        </div>}
        <div className="col">
          {required.map(row)}
          {optionalHeld.map(row)}
          {showOptional && optionalMissing.map(row)}
        </div>
        {optionalMissing.length > 0 && <button className="link t-meta" style={{ alignSelf: "flex-start" }} onClick={() => setShowOptional((v) => !v)}>
          {showOptional ? "收起可选文件" : `显示其他 ${optionalMissing.length} 类可选文件（${optionalMissing.map((i) => archiveItemName(i)).join("、")}）`}</button>}
        <span className="t-meta muted">把文件拖到这里即可归档；董事同意书、委任书、辞任书会自动关联到此人任职的公司。</span>
      </Card>
      {stageNode}
    </DropTarget>
  );
}
