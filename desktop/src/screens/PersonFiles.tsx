// 个人文件：按材料范围区分我负责、中介保管、待确认、不归你管和不适用。
// “已有材料”只展示归档文件；“完整性审阅”按缺件、待处理和保管状态分组。

import { useState } from "react";
import { type ArchiveItem, type Document, type Person, archiveItemName, ref } from "../domain/models";
import { expiryLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Button, Card, PopoverRow } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { useStageFile } from "./common";
import { ExtraTags, StatusTag, statusOfFreshness } from "./Status";
import { PickChip } from "./PropChips";
import { EvidenceEditor, EvidenceLinksChip, RelatedEvidence } from "./Packet";
import {
  ArchiveCountSummary, CustodyChip, FileViewSwitch, archiveReviewGroups, heldArchiveItems,
  hiddenArchiveItems, statusOfArchiveItem, useFileView, visibleArchiveItems,
} from "./ArchiveScope";

export function PersonFiles({ person }: { person: Person }) {
  const { store, router } = useApp();
  const [startStage, stageNode, busy] = useStageFile();
  const [showHidden, setShowHidden] = useState(false);
  const [evidenceDoc, setEvidenceDoc] = useState<Document | null>(null);
  const view = useFileView();
  const items = store.personArchive(person.id);
  const counts = store.personCounts(person.id);
  const visible = visibleArchiveItems(items);
  const hidden = hiddenArchiveItems(items);
  const alerts = visible.filter((i) => i.custody === "mine" || i.custody === "agent" || i.custody === "pending")
    .filter((i) => i.state.kind === "expired" || i.state.kind === "expiring");
  const owner = ref("person", person.id);
  // 默认关联到此人唯一任职的公司
  const companies = [...new Set(store.data.appointments.filter((a) => a.personID === person.id).map((a) => a.companyID))];
  const upload = (typeID?: string, path?: string) => void startStage({
    owner, typeID, path,
    onArchived: (d) => {
      if (companies.length === 1 && d.typeID.startsWith("person.") && ["person.consent", "person.appointment", "person.resignation"].includes(d.typeID)) {
        const appointments = store.data.appointments.filter((a) => a.personID === person.id && a.companyID === companies[0]);
        store.setLinks(d.id, [
          { target: "company", id: companies[0], kind: "appointment" },
          ...appointments.map((a) => ({ target: "appointment" as const, id: a.id, kind: "appointment" as const })),
        ]);
      }
    },
  });
  const onDrop = (paths: string[]) => {
    if (paths.length === 1) upload(undefined, paths[0]);
    else router.startImport(paths, null);
  };

  const row = (i: ArchiveItem) => {
    const docs: (Document | undefined)[] = i.document ? [i.document, ...i.others] : [undefined];
    return <div key={i.typeID} className="col">
      {docs.map((d, index) => {
        const status = d && index > 0 ? statusOfFreshness(store.freshness(d)) : statusOfArchiveItem(i);
        const expiry = d ? expiryLabel(d, i.type) : "";
        const date = d ? expiry === "长期" ? "长期" : `${expiry} 到期` : "";
        const co = d?.relatedCompanyID ? store.company(d.relatedCompanyID) : undefined;
        const muted = !d && i.custody !== "mine";
        return (
          <div key={d?.id ?? i.typeID} className="doc-row" data-type-id={i.typeID} data-custody={i.custody}>
            <span className={`doc-ic ${status.cls}`}><Icon name={d ? "doc.text" : "plus"} size={15} /></span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="row gap6" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ fontWeight: 700, color: d || !muted ? undefined : "var(--muted)" }}>{archiveItemName(i)}{docs.length > 1 ? <span className="t-meta muted" style={{ fontWeight: 400 }}> {index + 1}/{docs.length}</span> : null}</span>
                {i.suggested && !i.explicit && !d && <span className="t-meta muted">常见要求</span>}
                {index === 0 && i.olderVersions > 0 && <span className="t-meta muted">{i.olderVersions} 个旧版</span>}
              </span>
              {d && <span className="t-meta muted ellipsis">{[date, /^[0-9A-F-]{36}\.[a-z]+$/i.test(d.originalFileName) ? "" : d.originalFileName].filter(Boolean).join(" · ")}</span>}
              {!d && <span className="t-meta muted ellipsis">{status.hint}</span>}
            </span>
            {d && <PickChip label={co ? co.name : "关联公司"} title="这份文件和哪家公司有关" width={260} style={co ? undefined : { color: "var(--muted)" }}>
              {(close) => <>
                <PopoverRow title="不关联公司" checked={!co} onClick={() => { close(); store.setDocumentCompany(d.id, undefined); }} />
                {[...companies, ...store.data.companies.map((c) => c.id).filter((id) => !companies.includes(id))].map((id) => {
                  const company = store.company(id);
                  return company && <PopoverRow key={id} title={`${company.jurisdiction} ${company.name}`} checked={co?.id === id} onClick={() => { close(); store.setDocumentCompany(d.id, id); }} />;
                })}
              </>}
            </PickChip>}
            {d && <EvidenceLinksChip doc={d} onEdit={() => setEvidenceDoc(d)} />}
            <StatusTag s={status} />
            {d && <ExtraTags d={d} t={i.type} />}
            {view === "review" && index === 0 && <CustodyChip owner={owner} item={i} />}
            {d ? <>
              <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: d.id })}>查看</Button>
              <Button size="small" kind="quiet" title="上传新版本，旧版保留在历史版本中" onClick={() => void startStage({ owner, typeID: i.typeID, replaces: d })}>更新</Button>
            </> : i.custody !== "agent" && <Button size="small" onClick={() => upload(i.typeID)}>上传</Button>}
          </div>
        );
      })}
    </div>;
  };

  const groups = archiveReviewGroups(visible);
  const shown = view === "held" ? heldArchiveItems(items) : visible;
  return (
    <DropTarget message={`松开即可归档到 ${person.name} 的个人文件`} onDrop={onDrop}>
      <Card
        title={<span className="col gap6">
          <h2 className="t-card">个人文件</h2>
          <ArchiveCountSummary counts={counts} />
        </span>}
        action={<span className="row gap8 wrap">
          {busy && <span className="busy-chip" role="status"><span className="ring" />正在识别…</span>}
          <FileViewSwitch />
          <Button size="small" kind="primary" icon="square.and.arrow.down" onClick={() => upload()}>上传</Button>
        </span>}
      >
        {alerts.length > 0 && <div className="row gap8" style={{ padding: "10px 12px", borderRadius: 12, background: alerts.some((a) => a.state.kind === "expired") ? "var(--red-soft)" : "var(--amber-soft)", color: alerts.some((a) => a.state.kind === "expired") ? "var(--red-text)" : "var(--amber-text)", fontWeight: 700 }}>
          <Icon name="clock" size={14} />{alerts.map((a) => `${archiveItemName(a)}${a.state.kind === "expired" ? "已过期" : "快到期"}`).join("，")}。到期前会和公司文件一样提醒。
        </div>}
        <div className="col" aria-label={view === "held" ? "已有材料" : "完整性审阅"}>
          {view === "held"
            ? shown.map(row)
            : groups.map((group) => group.items.length > 0 && (
              <div key={group.key} className="col" style={{ gap: 0, marginTop: 8 }}>
                <span className="t-label" style={{ padding: "6px 0" }}>
                  {group.title} · {group.items.length}
                  {group.hint && <span className="muted" style={{ fontWeight: 500 }}>　{group.hint}</span>}
                </span>
                {group.items.map(row)}
              </div>
            ))}
          {!shown.length && view === "held" && <span className="muted" style={{ padding: "8px 0" }}>还没有归档的个人文件。把文件拖到这里即可归档。</span>}
          {view === "review" && !groups.some((group) => group.items.length) && <span className="muted" style={{ padding: "8px 0" }}>没有需要审阅的条目。</span>}
        </div>
        {view === "review" && hidden.length > 0 && <button className="link t-meta" style={{ alignSelf: "flex-start" }} onClick={() => setShowHidden((value) => !value)}>
          {showHidden ? "收起" : "显示"}不在范围内或不适用的 {hidden.length} 项
        </button>}
        {view === "review" && showHidden && hidden.map(row)}
        <span className="t-meta muted">把文件拖到这里即可归档；一份文件可以同时关联多家公司和多项任职。</span>
      </Card>
      <div style={{ height: 20 }} />
      <RelatedEvidence target="person" id={person.id} title="其他文件里的证据" />
      {stageNode}
      {evidenceDoc && <EvidenceEditor doc={evidenceDoc} onClose={() => setEvidenceDoc(null)} />}
    </DropTarget>
  );
}
