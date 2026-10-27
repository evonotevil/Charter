// 个人文件（5.3）：保管范围由用户设置，“我负责”的就是必备；两种视图；文件可经证据链关联多家公司、多个任职。

import { useState } from "react";
import { type ArchiveItem, type Document, type Person, archiveItemName, hasFile, inView, ref } from "../domain/models";
import { useApp } from "../state/hooks";
import { Icon } from "../ui/Icon";
import { Button, Card } from "../ui/kit";
import { DropTarget } from "../ui/drop";
import { useStageFile } from "./common";
import { StatusTag, statusOfFreshness } from "./Status";
import { CustodyChip, FileViewToggle, ScopeSummary, ScopedItems, itemStatus, useFileView } from "./Scope";
import { EvidenceList, EvidenceSheet, LinkChips } from "./Evidence";

const isUUIDName = (n: string) => /^[0-9A-F-]{36}\.[a-z]+$/i.test(n);

export function PersonFiles({ person }: { person: Person }) {
  const { store, router } = useApp();
  const [startStage, stageNode, busy] = useStageFile();
  const [linking, setLinking] = useState<Document | null>(null);
  const view = useFileView();
  const items = store.personArchive(person.id);
  const cnt = store.personCounts(person.id);
  const owner = ref("person", person.id);
  const alerts = items.filter((i) => inView(i.custody) && (i.state.kind === "expired" || i.state.kind === "expiring"));
  const appts = store.data.appointments.filter((a) => a.personID === person.id);
  const companies = [...new Set(appts.map((a) => a.companyID))];
  const upload = (typeID?: string, path?: string) => void startStage({
    owner, typeID, path,
    // 任职类文件：此人只在一家公司任职时，自动关联到那项任职
    onArchived: (d) => {
      if (companies.length === 1 && ["person.consent", "person.appointment", "person.resignation"].includes(d.typeID)) {
        const a = appts.filter((x) => x.companyID === companies[0]);
        store.setLinks(d.id, [{ target: "company", id: companies[0], kind: "appointment" }, ...a.map((x) => ({ target: "appointment" as const, id: x.id, kind: "appointment" as const }))]);
      }
    },
  });
  const onDrop = (paths: string[]) => { if (paths.length === 1) upload(undefined, paths[0]); else router.startImport(paths, null); };
  // 同类现行文件逐份显示（例如两家公司的董事同意书），不再只留最新一份
  const row = (i: ArchiveItem) => {
    const all = i.document ? [i.document, ...i.others] : [undefined];
    return <div key={i.typeID} className="col">{all.map((d, k) => line(i, d, k, all.length))}</div>;
  };
  const line = (i: ArchiveItem, d: Document | undefined, k: number, n: number) => {
    const date = d ? (d.expiryDate ? `${d.expiryDate} 到期` : d.issueDate ? `${d.issueDate} 签发` : "") : "";
    const fr = d && k > 0 ? store.freshness(d).kind : i.state.kind;
    const tone = !d ? "missing" : fr === "expired" ? "bad" : fr === "expiring" || fr === "needsUpdate" ? "warn" : "";
    return (
      <div key={d?.id ?? i.typeID} className="doc-row">
        <span className={`doc-ic ${tone}`}><Icon name={d ? "doc.text" : "plus"} size={15} /></span>
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="row gap6" style={{ minWidth: 0 }}>
            <span className="ellipsis" style={{ fontWeight: 700, color: d ? undefined : "var(--muted)" }}>{archiveItemName(i)}{n > 1 && <span className="t-meta muted" style={{ fontWeight: 400 }}> {k + 1}/{n}</span>}</span>
            {i.suggested && !i.explicit && !d && <span className="t-meta muted">常见要求</span>}
          </span>
          {d && <span className="t-meta muted ellipsis">{[date, isUUIDName(d.originalFileName) ? "" : d.originalFileName].filter(Boolean).join(" · ")}</span>}
        </span>
        {d && <LinkChips doc={d} onEdit={() => setLinking(d)} />}
        <StatusTag s={d && k > 0 ? statusOfFreshness(store.freshness(d)) : itemStatus(i)} />
        {view === "review" && (k === 0 ? <CustodyChip owner={owner} item={i} /> : <span style={{ width: 0 }} />)}
        {d ? <>
          <Button size="small" kind="quiet" onClick={() => router.open({ kind: "document", id: d.id })}>查看</Button>
          <Button size="small" kind="quiet" title="上传新版本，旧版保留在历史版本中" onClick={() => void startStage({ owner, typeID: i.typeID, replaces: d })}>更新</Button>
        </> : i.custody !== "agent" && <Button size="small" onClick={() => upload(i.typeID)}>上传</Button>}
      </div>
    );
  };
  const hidden = items.filter((i) => !inView(i.custody)).length;
  return (
    <DropTarget message={`松开即可归档到 ${person.name} 的个人文件`} onDrop={onDrop}>
      <Card title={<span className="col gap6"><h2 className="t-card">个人文件</h2>
        <ScopeSummary counts={cnt} onConfigure={() => router.open({ kind: "scope", ownerKind: "person", owners: [person.id] })} /></span>}
        action={<span className="row gap8">{busy && <span className="busy-chip" role="status"><span className="ring" />正在识别…</span>}<FileViewToggle /><Button size="small" kind="primary" icon="square.and.arrow.down" onClick={() => upload()}>上传</Button></span>}>
        {alerts.length > 0 && <div className="row gap8" style={{ padding: "10px 12px", borderRadius: 12, background: alerts.some((a) => a.state.kind === "expired") ? "var(--red-soft)" : "var(--amber-soft)", color: alerts.some((a) => a.state.kind === "expired") ? "var(--red-text)" : "var(--amber-text)", fontWeight: 700 }}>
          <Icon name="clock" size={14} />{alerts.map((a) => `${archiveItemName(a)}${a.state.kind === "expired" ? "已过期" : "快到期"}`).join("，")}。到期前会和公司文件一样提醒。
        </div>}
        <ScopedItems items={items} view={view} row={row}
          empty={<span className="muted" style={{ padding: "8px 0" }}>{view === "held" ? "还没有归档的个人文件。把文件拖到这里即可归档。" : "没有需要审阅的条目。"}</span>} />
        {view === "review" && hidden > 0 && <button className="link t-meta" style={{ alignSelf: "flex-start" }} onClick={() => router.open({ kind: "scope", ownerKind: "person", owners: [person.id] })}>不在范围或不适用的 {hidden} 项已隐藏</button>}
        {view === "held" && !cnt.configured && <span className="t-meta muted">哪些个人材料由你保管还没设置。切到“完整性审阅”或点“设置范围”。</span>}
        <span className="t-meta muted">把文件拖到这里即可归档。一份文件可以同时关联多家公司、多项任职，例如合并 KYC 或董事会文件。</span>
      </Card>
      <div style={{ height: 20 }} />
      <EvidenceList target="person" id={person.id} title="其他文件里的证据" />
      {stageNode}
      {linking && <EvidenceSheet doc={linking} onClose={() => setLinking(null)} />}
    </DropTarget>
  );
}

void hasFile;
