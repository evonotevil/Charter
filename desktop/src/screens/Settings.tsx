// 设置：数据与同步、提醒、档案清单、文件包用途、合规规则、备份与配置、功能模块。移植自 SettingsView.swift 与 ArchiveItemsSettings.swift。

import { useEffect, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import { type DateAdjust, type DocumentType, type NodeKind, type RuleTemplate, type ValidityKind, dateAdjustLabel, uuid, validityKinds, validityLabel } from "../domain/models";
import { snapshotKeep, snapshotTitle, type DataSnapshot } from "../domain/folder";
import { useApp } from "../state/hooks";
import { type SettingsPane, settingsGroups, settingsPaneSymbol, settingsPaneTitle } from "../state/router";
import { syncDetail, syncNeedsAttention, syncSymbol, syncTitle } from "../state/sync";
import { type ConfigBundle, applyConfig, configImportSummary, exportConfig, readConfig } from "../state/actions";
import { installSampleData } from "../state/sample";
import { nonArchiveTypeIDs } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Checkbox, ConfirmSheet, EmptyStateView, FieldRow, FormGroup, ListField, Modal, Pill, RadioGroup, SelectField, SheetScaffold, Switch, TextField } from "../ui/kit";
import { ScheduleEditor, TrustBadge, RuleConfirmSheet } from "./common";
import { ArchiveItemFields, type ItemDraft, newItemDraft } from "./Companies";
import { PurposeEditor } from "./Packet";

export function SettingsView() {
  const { store, router } = useApp();
  const raw = router.settings ?? "sync";
  const pane: SettingsPane = raw === "rules" && !store.complianceOn ? "sync" : raw;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !router.sheet && !document.querySelector(".overlay .sheet, .popover")) { e.preventDefault(); router.set("settings", null); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="settings-window row" role="dialog" aria-label="设置">
      <nav className="col" style={{ width: 210, flex: "none", padding: "16px 12px 12px", gap: 16, background: "var(--band)" }}>
        <div className="drag-region" style={{ height: platform().os === "mac" ? 18 : 0, margin: "-16px -12px 0" }} />
        {settingsGroups(store.complianceOn).map((g, i) => (
          <div key={i} className="col" style={{ gap: 2 }}>
            {g.title && <span className="t-micro muted" style={{ padding: "0 0 4px 12px" }}>{g.title}</span>}
            {g.panes.map((p) => (
              <button key={p} className="row gap10" onClick={() => router.set("settings", p)} aria-current={p === pane || undefined}
                style={{ height: 32, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: p === pane ? 600 : 400,
                  background: p === pane ? "var(--selection)" : undefined, color: p === pane ? "var(--on-selection)" : "color-mix(in srgb, var(--ink) 75%, transparent)" }}>
                <span style={{ width: 18, display: "grid", placeItems: "center" }}><Icon name={settingsPaneSymbol[p]} size={13} /></span>{settingsPaneTitle[p]}
              </button>
            ))}
          </div>
        ))}
        <span className="spacer" />
        <SyncFooter onClick={() => router.set("settings", "sync")} />
        <Button kind="quiet" size="small" icon="chevron.left" onClick={() => router.set("settings", null)}>返回 Charter</Button>
      </nav>
      <div className="col grow" style={{ minWidth: 0, background: "var(--canvas)" }} key={pane}>
        {pane === "archiveItems" ? <ArchiveItemsSettings /> : pane === "purposes" ? <PacketSettings /> : pane === "rules" ? <RulesSettings /> : <GeneralSettings pane={pane} />}
      </div>
    </div>
  );
}

function SyncFooter({ onClick }: { onClick: () => void }) {
  const { sync } = useApp();
  const s = sync.state;
  return <button className="row gap6" onClick={onClick} style={{ fontSize: 12, paddingLeft: 12, color: syncNeedsAttention(s) ? "var(--amber-text)" : "var(--muted)" }}><Icon name={syncSymbol(s)} size={12} /><span className="ellipsis">{syncTitle(s)}</span></button>;
}

// MARK: - 共用

function PaneHeader({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="row start gap12">
      <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.44 }}>{title}</span>
        {detail && <span className="t-meta muted">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children, gap = 16 }: { title?: string; children: ReactNode; gap?: number }) {
  return (
    <div className="col gap10">
      {title && <span style={{ fontSize: 13, fontWeight: 600, paddingLeft: 6 }} className="muted">{title}</span>}
      <div className="col surface" style={{ padding: 24, gap }}>{children}</div>
    </div>
  );
}

function Row({ icon, title, detail, children }: { icon: string; title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="row gap14">
      <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--band)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={icon} size={14} /></span>
      <span className="col grow" style={{ gap: 2, minWidth: 0 }}><span className="t-row">{title}</span>{detail && <span className="t-meta muted">{detail}</span>}</span>
      {children}
    </div>
  );
}

function Hero({ icon, label, title, status, dot, children }: { icon: string; label: string; title: string; status: ReactNode; dot: string; children?: ReactNode }) {
  return (
    <div className="row surface" style={{ gap: 18, padding: 24 }}>
      <span style={{ width: 64, height: 64, borderRadius: 18, background: "var(--ink)", color: "var(--on-ink)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={icon} size={26} /></span>
      <div className="col grow" style={{ gap: 5, minWidth: 0 }}>
        <span className="t-micro muted">{label}</span>
        <span className="ellipsis" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.44 }}>{title}</span>
        <span className="row gap6 t-meta muted"><span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }} />{status}</span>
      </div>
      {children}
    </div>
  );
}

const Scroll = ({ children, max = 760 }: { children: ReactNode; max?: number }) => (
  <div className="scroll grow"><div className="col" style={{ gap: 26, padding: 28, maxWidth: max, margin: "0 auto" }}>{children}</div></div>
);

// MARK: - 通用

const paneDetail: Partial<Record<SettingsPane, string>> = {
  sync: "档案数据保存在哪里，以及它现在是否已经同步。",
  reminders: "什么时候、由哪台电脑提醒你文件到期。",
  modules: "按需打开的功能。关闭后已有数据仍会保留。",
  backup: "快照、配置迁移，以及会删除数据的操作。",
};

function GeneralSettings({ pane }: { pane: SettingsPane }) {
  const { store, sync } = useApp();
  const [confirmSample, setConfirmSample] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [restoring, setRestoring] = useState<DataSnapshot | null>(null);
  const [pendingConfig, setPendingConfig] = useState<{ bundle: ConfigBundle; fileName: string } | null>(null);
  const [newDay, setNewDay] = useState("");
  useEffect(() => { if (pane === "backup") void store.refreshSnapshots(); }, [pane]);
  const p = platform();
  const root = store.folder.root;
  const s = sync.state;
  const cloud = s.kind !== "local";
  const reveal = p.os === "windows" ? "在资源管理器中打开" : "在访达中打开";
  const settings = store.data.settings;
  const addDay = () => {
    const d = parseInt(newDay.trim(), 10);
    if (d > 0 && d <= 730 && !settings.reminderDays.includes(d)) store.saveSettings((x) => { x.reminderDays = [...x.reminderDays, d].sort((a, b) => b - a); });
    setNewDay("");
  };
  const chooseFolder = async () => {
    const dir = await p.pickFolder({ title: "选择数据文件夹" });
    if (dir) await store.changeDataRoot(dir);
  };
  const counts = (x: DataSnapshot) => [x.companies != null ? `${x.companies} 家公司` : null, x.documents != null ? `${x.documents} 份文件` : null].filter(Boolean) as string[];
  const device = "电脑"; // 主设备可能是 Mac 也可能是 Windows，统一叫“电脑”
  return (
    <Scroll>
      <PaneHeader title={settingsPaneTitle[pane]} detail={paneDetail[pane]} />
      {pane === "sync" && <>
        <div className="row surface" style={{ gap: 18, padding: 24 }}>
          <span style={{ width: 64, height: 64, borderRadius: 18, background: "var(--ink)", color: "var(--on-ink)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={cloud ? "icloud.fill" : "folder.fill"} size={26} /></span>
          <div className="col grow" style={{ gap: 5, minWidth: 0 }}>
            <span className="t-micro muted">数据文件夹</span>
            <span className="ellipsis" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.44 }}>{root.split(/[\\/]/).filter(Boolean).pop()}</span>
            <span className="row gap6 t-meta muted"><span style={{ width: 7, height: 7, borderRadius: "50%", background: syncNeedsAttention(s) ? "var(--amber-text)" : cloud ? "var(--lime)" : "color-mix(in srgb, var(--muted) 50%, transparent)" }} />
              {cloud ? `在同步盘中 · ${syncTitle(s)}` : "仅保存在这台电脑上"}</span>
            <span className="ellipsis selectable" title={root} style={{ fontSize: 11, color: "color-mix(in srgb, var(--muted) 80%, transparent)", direction: "rtl", textAlign: "left" }}>{root}</span>
          </div>
          <div className="col gap8" style={{ alignItems: "flex-end" }}>
            <Button size="small" onClick={() => void p.openPath(root)}>{reveal}</Button>
            <Button kind="quiet" size="small" onClick={() => void chooseFolder()}>更换文件夹…</Button>
          </div>
        </div>
        <Section title="同步状态">
          <Row icon={syncSymbol(s)} title={syncTitle(s)} detail={syncDetail(s)}><Button size="small" onClick={() => void sync.refresh()}>立即检查</Button></Row>
        </Section>
        <span className="t-meta muted" style={{ padding: "0 6px" }}>把数据文件夹放进 iCloud 云盘、OneDrive 或其他同步盘，Mac 和 Windows 电脑就能共用同一套档案。</span>
      </>}
      {pane === "reminders" && <Section title="提醒">
        <Row icon="bell.badge" title="到期前提醒" detail={`文件到期前按这些天数提醒，每天 ${settings.notificationHour}:00 发出。`} />
        <div className="row wrap gap8" style={{ paddingLeft: 52 }}>
          {[...settings.reminderDays].sort((a, b) => b - a).map((d) => (
            <span key={d} className="row gap6 num" style={{ height: 28, padding: "0 12px", borderRadius: 999, background: "var(--lime-soft)", color: "var(--lime-text)", fontSize: 12.5, fontWeight: 600 }}>
              {d} 天{settings.reminderDays.length > 1 && <button aria-label={`移除 ${d} 天`} onClick={() => store.saveSettings((x) => { x.reminderDays = x.reminderDays.filter((y) => y !== d); })}><Icon name="xmark" size={8.5} /></button>}
            </span>
          ))}
          <label className="row gap4" title="输入天数后按回车添加" style={{ height: 28, padding: "0 10px", borderRadius: 999, border: "1px dashed var(--hairline)" }}>
            <Icon name="plus" size={10} className="muted" />
            <input value={newDay} onChange={(e) => setNewDay(e.target.value)} onBlur={addDay} onKeyDown={(e) => e.key === "Enter" && addDay()} placeholder="天数" inputMode="numeric"
              style={{ width: 34, border: 0, outline: "none", background: "transparent", font: "inherit", fontSize: 12.5, color: "inherit" }} />
          </label>
        </div>
        <Row icon="clock" title="提醒时间" detail="通知和日历提醒统一在这个时间。">
          <SelectField options={Array.from({ length: 16 }, (_, i) => [i + 6, `${i + 6}:00`] as [number, string])} value={settings.notificationHour} onChange={(h) => store.saveSettings((x) => { x.notificationHour = h; })} minWidth={110} />
        </Row>
        <Row icon="laptopcomputer" title={`主${device}`} detail={`只有主${device}发送到期通知，避免多台电脑重复提醒。`}>
          {store.isPrimaryDevice ? <Pill text={`这台${device}`} kind="valid" /> : <span className="row gap8">
            <span className="t-meta muted">{settings.primaryDeviceName ?? "另一台电脑"}</span>
            <Button size="small" onClick={() => store.saveSettings((x) => { x.primaryDeviceID = store.deviceID; x.primaryDeviceName = store.deviceName; })}>设为主{device}</Button>
          </span>}
        </Row>
        {store.complianceOn && <Row icon="calendar" title="同步到日历" detail={`在数据文件夹里生成“${settings.calendarName}.ics”，可用 Apple 日历、Outlook 或 Google 日历订阅。`}>
          <Switch checked={settings.calendarEnabled} onChange={(v) => store.saveSettings((x) => { x.calendarEnabled = v; })} />
        </Row>}
      </Section>}
      {pane === "modules" && <Section title="模块">
        <Row icon="checklist" title="合规申报与交办" detail="在总览“接下来 30 天”里显示年报、税表等申报截止日，并可打开合规日历、交办给负责方。关闭后总览只显示文件，已有数据仍会保留。">
          <Switch checked={store.complianceOn} onChange={(v) => store.saveSettings((x) => { x.complianceEnabled = v; })} />
        </Row>
      </Section>}
      {pane === "backup" && <>
        <Section title="配置">
          <Row icon="square.and.arrow.up" title="导出配置" detail="把提醒设置和模板库（法域、文件类型、档案条目、规则、用途）存成一个文件，可在另一套数据里导入。不含公司、文件等档案数据。">
            <Button size="small" onClick={async () => { const t = await p.saveDialog({ defaultName: `Charter 配置 ${store.today}.json`, extensions: ["json"], title: "导出" }); if (t) await exportConfig(store, t); }}>导出配置…</Button>
          </Row>
          <Row icon="square.and.arrow.down" title="导入配置" detail="读取导出的配置文件，确认变化后再应用。">
            <Button size="small" disabled={store.isLoading || store.loadFailed} onClick={async () => {
              const f = (await p.pickFiles({ multiple: false, extensions: ["json"], title: "读取配置" }))[0];
              if (!f) return;
              try { setPendingConfig({ bundle: await readConfig(f), fileName: f.split(/[\\/]/).pop()! }); } catch (e) { store.setError((e as Error).message); }
            }}>导入配置…</Button>
          </Row>
        </Section>
        <Section title="备份与恢复">
          <Row icon="clock.arrow.circlepath" title="本地快照" detail={`每天第一次打开，以及导入、批量移除、清空数据、导入配置之前，自动保存一份档案记录的快照（不含 PDF），保留最近 ${snapshotKeep} 份。`}>
            <span className="row gap8">
              <Button kind="quiet" size="small" onClick={() => void store.revealSnapshots()}>{p.os === "windows" ? "在资源管理器中显示" : "在访达中显示"}</Button>
              <Button size="small" disabled={store.isLoading || store.loadFailed} onClick={() => void store.backUpNow()}>立即备份</Button>
            </span>
          </Row>
          {!store.snapshots.length ? <span className="t-meta muted" style={{ paddingLeft: 52 }}>还没有快照。</span> : (
            <div className="col" style={{ paddingLeft: 52 }}>
              {store.snapshots.slice(0, 5).map((x, i) => (
                <div key={x.id}>
                  {i > 0 && <div className="hairline" />}
                  <div className="row gap12" style={{ padding: "8px 0" }}>
                    <span className="col grow" style={{ gap: 2, minWidth: 0 }}><span className="t-row num">{snapshotTitle(x.date)}</span><span className="t-meta muted ellipsis">{[x.reason, ...counts(x)].join(" · ")}</span></span>
                    <Button kind="quiet" size="small" disabled={store.isLoading || store.isImporting} onClick={() => setRestoring(x)}>恢复…</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="危险操作">
          <Row icon="shippingbox" title="载入示例数据" detail="一套虚构的远澜集团数据，会覆盖当前文件夹里的公司、人员和负责方。建议先更换为空文件夹。"><Button size="small" onClick={() => setConfirmSample(true)}>载入…</Button></Row>
          <Row icon="trash" title="清空所有数据" detail="删除公司、集团、人员、关系、文件（含数据文件夹里的归档文件）、负责方和事项记录。设置和模板库保留。适合试用结束后重新开始。">
            <Button kind="danger" size="small" disabled={store.isLoading || store.isImporting || store.loadFailed} onClick={() => setConfirmClear(true)}>清空…</Button>
          </Row>
        </Section>
      </>}
      {confirmSample && <ConfirmSheet title="载入示例数据？" message="示例数据会覆盖当前数据文件夹里的公司、人员和负责方。建议先更换为空文件夹。" confirmTitle="载入" destructive onClose={() => setConfirmSample(false)} onConfirm={() => { setConfirmSample(false); void installSampleData(store); }} />}
      {confirmClear && <ConfirmSheet title="清空所有数据？" message="以下内容会被永久删除，数据文件夹里的归档文件也会一起删除，无法撤销。设置和模板库（法域、档案条目、规则、用途）会保留。" details={store.clearSummaryLines}
        confirmTitle="清空" destructive onClose={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); void store.clearAllData(); }} />}
      {restoring && <ConfirmSheet title={`恢复到 ${snapshotTitle(restoring.date)} 的状态？`} message="当前状态会先自动保存一份快照，之后也可以再恢复回来。快照只包含档案记录，不包含 PDF 文件本身。"
        details={[`快照原因：${restoring.reason}`, ...counts(restoring).map((c) => `快照里有 ${c}`), `当前：${store.data.companies.length} 家公司、${store.data.documents.length} 份文件`]}
        confirmTitle="恢复" onClose={() => setRestoring(null)} onConfirm={() => { const x = restoring; setRestoring(null); void store.restoreFromSnapshot(x); }} />}
      {pendingConfig && <ConfigImportSheet bundle={pendingConfig.bundle} fileName={pendingConfig.fileName} onClose={() => setPendingConfig(null)} />}
    </Scroll>
  );
}

function ConfigImportSheet({ bundle, fileName, onClose }: { bundle: ConfigBundle; fileName: string; onClose: () => void }) {
  const { store } = useApp();
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const when = new Date(bundle.exportedAt);
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="导入配置" width={520} subtitle={`来自“${fileName}”，导出于 ${isNaN(+when) ? bundle.exportedAt : when.toLocaleString("zh-CN")}。公司、文件等档案数据不受影响。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind={mode === "replace" ? "danger" : "primary"} onClick={() => { void applyConfig(store, bundle, mode); onClose(); }}>{mode === "merge" ? "合并导入" : "全部替换"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title="导入方式"><RadioGroup options={[["merge", "合并（同名覆盖）"], ["replace", "全部替换"]]} value={mode} onChange={setMode} /></FormGroup>
          <FormGroup title="将会改变">{configImportSummary(store, bundle, mode).map((l, i) => <span key={i}>{l}</span>)}</FormGroup>
          {mode === "replace" && <span className="t-meta amber-text">全部替换会移除这里有、配置里没有的规则、用途和未使用的文件类型。</span>}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 文件类型表单

function validityText(t: DocumentType) {
  const v = t.validity === "monthsAfterIssue" ? `签发后 ${t.validityMonths ?? 6} 个月有效` : t.validity === "expiryOnDocument" ? "按文件上的到期日" : t.validity === "untilChanged" ? "信息变更前有效" : "长期有效";
  return `${t.category}，${v}`;
}

function DocumentTypeForm({ type, onChange }: { type: DocumentType; onChange: (t: DocumentType) => void }) {
  const set = (patch: Partial<DocumentType>) => onChange({ ...type, ...patch });
  const months = [...new Set([1, 3, 6, 12, 24, 36, type.validityMonths ?? 6])].sort((a, b) => a - b);
  return (
    <div className="col" style={{ gap: 18 }}>
      <FormGroup title="基本信息" canvas>
        <FieldRow label="显示名称"><TextField value={type.name} onChange={(name) => set({ name })} placeholder="例如：商业登记证" /></FieldRow>
        <FieldRow label="通用类别" hint="跨法域归并同类文件，例如“存续证明”；也用作矩阵的列"><TextField value={type.category} onChange={(category) => set({ category })} placeholder="例如：存续证明" /></FieldRow>
        <FieldRow label="归属"><RadioGroup horizontal options={[["company", "公司"], ["person", "人"]] as [NodeKind, string][]} value={type.owner} onChange={(owner) => set({ owner })} /></FieldRow>
      </FormGroup>
      <FormGroup title="识别" canvas>
        <FieldRow label="当地名称" hint="当地叫法与别名，用逗号分隔"><ListField values={type.localNames} onChange={(localNames) => set({ localNames })} placeholder="例如：Certificate of Incumbency" /></FieldRow>
        <FieldRow label="识别线索" hint="文件里常出现的词，用逗号分隔"><ListField values={type.hints} onChange={(hints) => set({ hints })} placeholder="例如：incumbency, registered agent" /></FieldRow>
        <FieldRow label="适用法域" hint="法域代码，用逗号分隔；留空表示所有法域"><ListField values={type.jurisdictions} onChange={(jurisdictions) => set({ jurisdictions })} placeholder="例如：KY, BVI" /></FieldRow>
      </FormGroup>
      <FormGroup title="有效期" canvas>
        <RadioGroup options={validityKinds.map((k) => [k, validityLabel[k]] as [ValidityKind, string])} value={type.validity} onChange={(validity) => set({ validity })} />
        {type.validity === "monthsAfterIssue" && <FieldRow label="有效月数" hint="从签发日起算"><SelectField options={months.map((m) => [m, `${m} 个月`] as [number, string])} value={type.validityMonths ?? 6} onChange={(validityMonths) => set({ validityMonths })} minWidth={140} /></FieldRow>}
      </FormGroup>
      {type.builtIn && <span className="t-meta muted" style={{ padding: "0 4px" }}>内置类型，可以修改。名称和有效期请按负责方和银行的要求核对。</span>}
    </div>
  );
}

// MARK: - 档案清单

const personScope = "__person";

function ArchiveItemsSettings() {
  const { store, router } = useApp();
  const [code, setCode] = useState<string | null>(() => {
    const w = router.archiveScope;
    router.archiveScope = null;
    return w && store.jurisdiction(w) ? w : null;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [addingJ, setAddingJ] = useState(false);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => setSelected(null), [code]);
  const lib = store.data.library;
  const personTypes = lib.documentTypes.filter((t) => t.owner === "person");
  const saveType = (t: DocumentType) => store.saveLibrary((l) => { const i = l.documentTypes.findIndex((x) => x.id === t.id); if (i >= 0) l.documentTypes[i] = t as any; });
  const deleteType = (id: string) => {
    store.saveLibrary((l) => {
      l.documentTypes = l.documentTypes.filter((t) => t.id !== id);
      if (l.archiveItems) for (const k of Object.keys(l.archiveItems)) l.archiveItems[k] = l.archiveItems[k].filter((x) => x !== id);
    });
    setSelected(null);
  };

  if (!code) return (
    <Scroll max={820}>
      <PaneHeader title="档案清单" detail="每个法域的公司默认管理哪些文件。新建公司时自动套用，之后可以逐家调整。">
        <Button size="small" icon="plus" onClick={() => setAddingJ(true)}>新建法域</Button>
      </PaneHeader>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {lib.jurisdictions.map((j) => {
          const n = store.data.companies.filter((c) => c.jurisdiction === j.code).length;
          return <ScopeCard key={j.code} title={j.name} code={j.code} count={store.templateItems(j.code).length} note={n ? `${n} 家公司在用` : "暂无公司"} customized={!!lib.archiveItems?.[j.code]} onOpen={() => setCode(j.code)} />;
        })}
        <ScopeCard title="人员文件" count={personTypes.length} note={`${store.data.people.length} 位人员`} customized={false} onOpen={() => setCode(personScope)} />
      </div>
      <span className="t-meta muted">内置条目是管理用的起始清单，不代表已核验的法定要求。</span>
      {addingJ && <JurisdictionForm onClose={() => setAddingJ(false)} onAdded={(c) => setCode(c)} />}
    </Scroll>
  );

  const person = code === personScope;
  const ids = person ? personTypes.map((t) => t.id) : store.templateItems(code);
  const candidates = person ? [] : lib.documentTypes.filter((t) => t.owner === "company" && !ids.includes(t.id) && !nonArchiveTypeIDs.has(t.id) && (!t.jurisdictions.length || t.jurisdictions.includes(code)));
  const move = (i: number, d: number) => { const a = [...ids]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; store.setTemplateItems(a, code); };
  const t = selected ? lib.documentTypes.find((x) => x.id === selected) : undefined;
  const used = t ? store.data.documents.filter((d) => d.typeID === t.id).length : 0;
  const forms = !person && t?.owner === "company" ? store.jurisdiction(code)?.entityForms ?? [] : [];
  const chosen = new Set(t?.entityForms ?? []);
  return (
    <div className="row grow start" style={{ gap: 20, padding: 24, minHeight: 0 }}>
      <div className="col" style={{ width: 340, flex: "none", gap: 14, height: "100%" }}>
        <button className="row gap4 t-meta muted" onClick={() => setCode(null)}><Icon name="chevron.left" size={10} />全部法域</button>
        <PaneHeader title={person ? "人员文件" : store.jurisdictionName(code)} detail={person ? "挂在人名下的文件。" : "这个法域的公司默认管理哪些文件。新建公司时自动套用。"} />
        <div className="surface scroll grow col" style={{ padding: 8, gap: 2, minHeight: 0 }}>
          {!ids.length && <span className="muted" style={{ padding: "12px 10px" }}>{person ? "还没有人员文件类型。" : "这个法域还没有条目。"}</span>}
          {ids.map((id, i) => {
            const on = selected === id;
            const tt = store.docType(id);
            return (
              <div key={id} className={`row gap8 item-row ${on ? "on" : "hover-band"}`} onClick={() => setSelected(id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(id)}
                style={{ height: 48, padding: "0 10px", borderRadius: 12, background: on ? "var(--selection)" : undefined, color: on ? "var(--on-selection)" : "var(--ink)", flex: "none" }}>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-row ellipsis">{tt?.name ?? id}</span>
                  <span className="t-meta ellipsis" style={{ opacity: on ? .7 : 1, color: on ? undefined : "var(--muted)" }}>{tt ? validityText(tt) : ""}</span>
                </span>
                {!person && <span className="row gap4 tools" onClick={(e) => e.stopPropagation()}>
                  <button className="tool" title="上移" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevron.up" size={10} /></button>
                  <button className="tool" title="下移" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><Icon name="chevron.down" size={10} /></button>
                  <button className="tool" title={`从${store.jurisdictionName(code)}条目中去掉（不删除已有文件）`} onClick={() => { store.setTemplateItems(ids.filter((x) => x !== id), code); setSelected(null); }}><Icon name="minus" size={10} /></button>
                </span>}
              </div>
            );
          })}
          {candidates.length > 0 && <>
            <div className="hairline" style={{ margin: "10px 10px 6px" }} />
            <span className="t-micro muted" style={{ padding: "0 10px 4px" }}>可添加的已有类型</span>
            {candidates.map((c) => <div key={c.id} className="row gap8" style={{ height: 36, padding: "0 10px", flex: "none" }}>
              <span className="muted ellipsis grow">{c.name}</span>
              <Button kind="quiet" size="small" icon="plus" title={`添加到${store.jurisdictionName(code)}的条目`} onClick={() => store.setTemplateItems([...ids, c.id], code)}>添加</Button>
            </div>)}
          </>}
        </div>
        <span className="t-meta muted" style={{ padding: "0 4px" }}>{person ? "护照、身份证等挂在人名下的文件。" : "内置条目是管理用的起始清单，不代表已核验的法定要求。实际要求请按公司情况与接收方确认。"}</span>
        <div className="row gap8">
          <Button kind="primary" icon="plus" onClick={() => setCreatingIn(code)}>新建条目</Button>
          <span className="spacer" />
          {!person && lib.archiveItems?.[code] && <Button kind="quiet" size="small" title={`把${store.jurisdictionName(code)}的条目恢复为内置清单`}
            onClick={() => store.saveLibrary((l) => { if (l.archiveItems) delete l.archiveItems[code]; })}>恢复内置</Button>}
        </div>
      </div>
      <div className="scroll grow" style={{ height: "100%", minWidth: 0 }}>
        {t ? (
          <div className="col" style={{ gap: 20, paddingBottom: 8 }}>
            <PaneHeader title={t.name || "未命名条目"} detail={validityText(t)}>
              {!t.builtIn && <Button size="small" disabled={used > 0} title={used ? "仍有文件使用这个类型。请先将这些文件改为其他类型，再删除。" : "从所有法域删除这个类型"} onClick={() => setDeleting(t.id)}>删除类型</Button>}
            </PaneHeader>
            <span className="row gap6 t-meta muted" style={{ marginTop: -10 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: used ? "var(--lime)" : "color-mix(in srgb, var(--muted) 50%, transparent)" }} />{used ? `已有 ${used} 份文件使用这个类型` : "还没有文件使用这个类型"}</span>
            {forms.length > 0 && <div className="col gap8">
              <span className="t-row">适用的实体类型</span>
              <span className="t-meta muted">{chosen.size ? "只有所选类型的公司会出现这个条目；其他类型的公司自动隐藏，不算缺件。" : `所有${store.jurisdictionName(code)}公司都需要。选择类型后，只有这些类型的公司会出现这个条目。`}</span>
              <div className="row wrap gap6">{forms.map((f) => {
                const on = chosen.has(f);
                return <button key={f} className="row gap4" onClick={() => { const s = new Set(chosen); if (on) s.delete(f); else s.add(f); saveType({ ...t, entityForms: s.size ? forms.filter((x) => s.has(x)) : undefined }); }}
                  style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 500, background: on ? "var(--lime-soft)" : "var(--band)", color: on ? "var(--lime-text)" : "var(--ink)" }}>{on && <Icon name="checkmark" size={9} />}{f}</button>;
              })}</div>
            </div>}
            <DocumentTypeForm key={t.id} type={t} onChange={saveType} />
          </div>
        ) : <div className="col" style={{ height: "100%", justifyContent: "center" }}><EmptyStateView symbol="list.bullet.rectangle" title="选择条目以查看和编辑" message="可在这里修改名称、当地名称、识别线索和有效期。" /></div>}
      </div>
      {creatingIn && <NewItemSheet scope={creatingIn} onClose={() => setCreatingIn(null)} onCreated={(id) => { setSelected(id); setCreatingIn(null); }} />}
      {deleting && <ConfirmSheet title="删除这个条目类型？" message="会从所有法域的档案条目中去掉，之后不能恢复。" details={["目前没有文件使用这个类型", "各公司单独添加的此条目也会一并删除"]} confirmTitle="删除" destructive
        onClose={() => setDeleting(null)} onConfirm={() => { const id = deleting; setDeleting(null); deleteType(id); }} />}
    </div>
  );
}

function ScopeCard({ title, code, count, note, customized, onOpen }: { title: string; code?: string; count: number; note: string; customized: boolean; onOpen: () => void }) {
  return (
    <button className="col surface scope-card" onClick={onOpen} style={{ padding: 18, gap: 10, textAlign: "left" }}>
      <span className="row baseline"><span className="ellipsis grow" style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>{code && <span className="t-meta muted">{code}</span>}</span>
      <span className="row baseline gap4"><span className="num" style={{ fontSize: 30, fontWeight: 800 }}>{count}</span><span className="t-meta muted">个条目</span></span>
      <span className="row gap6"><span className="t-meta muted">{note}</span>{customized && <Pill text="已调整" />}<span className="spacer" /><Icon name="chevron.right" size={11} className="muted" /></span>
    </button>
  );
}

function NewItemSheet({ scope, onClose, onCreated }: { scope: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { store } = useApp();
  const person = scope === personScope;
  const [draft, setDraft] = useState<ItemDraft>({ ...newItemDraft(), validity: person ? "expiryOnDocument" : "permanent" });
  const [all, setAll] = useState(false);
  const jName = person ? "人员文件" : store.jurisdictionName(scope);
  const valid = !!draft.name.trim();
  const create = () => {
    if (!valid) return;
    const name = draft.name.trim();
    const months = draft.validity === "monthsAfterIssue" ? draft.months : undefined;
    if (person) {
      const t = store.createItem({ name, category: draft.category, validity: draft.validity, months, owner: "person" });
      onCreated(t.id);
    } else {
      const t = store.createItem({ name, category: draft.category, jurisdiction: scope, validity: draft.validity, months });
      if (all) store.saveLibrary((l) => { const x = l.documentTypes.find((y) => y.id === t.id); if (x) x.jurisdictions = []; });
      onCreated(t.id);
    }
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="新建条目" width={560} onSubmit={create} subtitle={person ? "添加到人员文件，例如护照、身份证、住址证明。" : `添加到${jName}的档案清单；之后新建${jName}公司时自动带出。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!valid} onClick={create}>添加</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <ArchiveItemFields draft={draft} onChange={setDraft} />
          {!person && <FormGroup title="适用范围"><Checkbox checked={all} onChange={setAll}>其他法域的公司也可以添加这个条目</Checkbox></FormGroup>}
        </div>
      </SheetScaffold>
    </Modal>
  );
}

function JurisdictionForm({ onClose, onAdded }: { onClose: () => void; onAdded: (code: string) => void }) {
  const { store } = useApp();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const c = code.trim().toUpperCase();
  const dup = store.jurisdiction(c);
  const error = !c ? (attempted ? "请填写法域代码" : null) : dup ? `已有法域 ${dup.name}（${c}）` : null;
  const add = () => {
    setAttempted(true);
    if (!c || dup) return;
    store.saveLibrary((l) => {
      l.jurisdictions.push({ code: c, name: name.trim() || c, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, entityForms: [] });
      l.archiveItems = { ...(l.archiveItems ?? {}), [c]: [] };
    });
    store.showToast(`已添加法域 ${name.trim() || c}`);
    onAdded(c);
    onClose();
  };
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="新建法域" subtitle="新建后可以为这个法域设置档案条目。" width={460} onSubmit={add} trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={add}>添加</Button></>}>
        <FormGroup>
          <FieldRow label="代码" hint="2–3 个字母，例如 MY" error={error}><TextField value={code} onChange={setCode} placeholder="MY" autoFocus /></FieldRow>
          <FieldRow label="名称"><TextField value={name} onChange={setName} placeholder="例如：马来西亚" /></FieldRow>
        </FormGroup>
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 文件包用途

function PacketSettings() {
  const { store } = useApp();
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const packets = store.data.library.packets;
  const chip = (text: string, muted: boolean, icon?: string, title?: string) => (
    <span key={text} title={title} className="row gap4" style={{ height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: muted ? "var(--band)" : "var(--lime-soft)", color: muted ? "var(--muted)" : "var(--lime-text)" }}>
      {icon && <Icon name={icon} size={9.5} />}{text}
    </span>
  );
  return (
    <Scroll>
      <Hero icon="shippingbox.fill" label="文件包用途" title={packets.length ? `${packets.length} 个用途` : "还没有用途"} status="准备文件包时按用途挑选材料，例如银行开户、年度审计、KYC 更新"
        dot={packets.length ? "var(--lime)" : "color-mix(in srgb, var(--muted) 50%, transparent)"}>
        <Button kind="primary" icon="plus" onClick={() => setEditing({})}>新建用途</Button>
      </Hero>
      <Section title="用途" gap={0}>
        {!packets.length && <span className="muted">还没有用途。新建用途并选择所需的文件类别。</span>}
        {packets.map((p, i) => (
          <div key={p.id}>
            {i > 0 && <div className="hairline" style={{ margin: "14px 0 14px 52px" }} />}
            <div className="row start gap14" onDoubleClick={() => setEditing({ id: p.id })}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--band)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="shippingbox" size={14} /></span>
              <div className="col grow gap8" style={{ minWidth: 0 }}>
                <span className="t-row" style={{ minHeight: 20 }}>{p.name || "未命名用途"}</span>
                <div className="row wrap gap6">
                  {!p.categories.length && chip("未选文件类别", true)}
                  {p.categories.slice(0, 6).map((c) => chip(c, false))}
                  {p.categories.length > 6 && chip(`+${p.categories.length - 6}`, false, undefined, p.categories.slice(6).join("、"))}
                  {p.includeDirectorsPassports && chip("附董事护照", true, "person.text.rectangle")}
                  {p.maxAgeMonths && chip(`${p.maxAgeMonths} 个月内签发`, true, "clock")}
                </div>
              </div>
              <Button size="small" onClick={() => setEditing({ id: p.id })}>编辑</Button>
            </div>
          </div>
        ))}
      </Section>
      {editing && <PurposeEditor purposeID={editing.id} onClose={() => setEditing(null)} />}
    </Scroll>
  );
}

// MARK: - 合规规则

function RulesSettings() {
  const { store } = useApp();
  const [selection, setSelection] = useState<string | null>(null);
  const [jurisdiction, setJurisdiction] = useState("全部");
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rules = store.data.library.rules;
  const isDraft = (r: RuleTemplate) => r.verification?.status !== "confirmed";
  const list = rules.filter((r) => (jurisdiction === "全部" || r.jurisdictions.includes(jurisdiction)) && (!draftsOnly || isDraft(r)));
  const rule = rules.find((r) => r.id === selection);
  const add = () => {
    const j = jurisdiction === "全部" ? [store.data.library.jurisdictions[0]?.code ?? "HK"] : [jurisdiction];
    const r: RuleTemplate = { id: `custom.${uuid().slice(0, 8)}`, name: "新规则", localName: "", jurisdictions: j, entityForms: [], schedule: { kind: "annualFixed", date: "12-31" }, adjust: "none",
      requiredDocTypeIDs: [], responsibleHint: "", penalty: "", notes: "", needsReview: false, enabled: true, builtIn: false };
    store.saveLibrary((l) => { l.rules.push(r as any); });
    setSelection(r.id);
  };
  return (
    <div className="row grow start" style={{ gap: 20, padding: 24, minHeight: 0 }}>
      <div className="col" style={{ width: 340, flex: "none", gap: 14, height: "100%" }}>
        <PaneHeader title="合规规则" detail="各法域申报截止日的计算方式。只有核对过的规则才按确定日期提醒。" />
        <div className="row gap8">
          <SelectField options={[["全部", "全部法域"] as [string, string], ...store.data.library.jurisdictions.map((j) => [j.code, j.name] as [string, string])]} value={jurisdiction} onChange={setJurisdiction} minWidth={150} />
          <span className="spacer" />
          <Checkbox checked={draftsOnly} onChange={setDraftsOnly}>只看待核对（{rules.filter(isDraft).length}）</Checkbox>
        </div>
        <div className="surface scroll grow col" style={{ padding: 8, gap: 2, minHeight: 0 }}>
          {!list.length && <span className="muted" style={{ margin: "auto" }}>没有符合条件的规则。</span>}
          {list.map((r) => {
            const on = r.id === selection;
            const detail = `${r.jurisdictions.join("、")}，${store.scheduleText(r.schedule)}`;
            return (
              <button key={r.id} className={`row gap10 ${on ? "" : "hover-band"}`} onClick={() => setSelection(r.id)}
                style={{ minHeight: 48, padding: "0 10px", borderRadius: 12, textAlign: "left", background: on ? "var(--selection)" : undefined, flex: "none" }}>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-row ellipsis" style={{ color: on ? "var(--on-selection)" : r.enabled ? "var(--ink)" : "var(--muted)" }}>{r.name || "未命名规则"}</span>
                  <span className="t-meta ellipsis" style={{ color: on ? "color-mix(in srgb, var(--on-selection) 70%, transparent)" : "var(--muted)" }}>{r.enabled ? detail : `已停用，${detail}`}</span>
                </span>
                {isDraft(r) && <TrustBadge trust={{ kind: "draft" } as any} />}
              </button>
            );
          })}
        </div>
        <span><Button kind="primary" icon="plus" onClick={add}>新建规则</Button></span>
      </div>
      <div className="scroll grow" style={{ height: "100%", minWidth: 0 }}>
        {rule ? <RuleForm key={rule.id} rule={rule} onConfirm={() => setConfirming(rule.id)} onDelete={() => setDeleting(true)} />
          : <div className="col" style={{ height: "100%", justifyContent: "center" }}><EmptyStateView symbol="calendar.badge.clock" title="选择要编辑的规则" message="可在这里核对规则、调整截止日算法和提醒。" /></div>}
      </div>
      {confirming && <RuleConfirmSheet ruleID={confirming} onClose={() => setConfirming(null)} />}
      {deleting && rule && <ConfirmSheet title="删除这条规则？" message="删除后不再按这条规则生成待办事项。已完成事项的记录会保留。" confirmTitle="删除" destructive onClose={() => setDeleting(false)}
        onConfirm={() => { setDeleting(false); store.saveLibrary((l) => { l.rules = l.rules.filter((x) => x.id !== rule.id); }); setSelection(null); }} />}
    </div>
  );
}

function RuleForm({ rule, onConfirm, onDelete }: { rule: RuleTemplate; onConfirm: () => void; onDelete: () => void }) {
  const { store } = useApp();
  const [r, setR] = useState<RuleTemplate>(rule);
  useEffect(() => setR(rule), [rule]);
  // 文本输入在本地更新，停顿后再保存（算法改动会把规则退回“待核对”）
  useEffect(() => {
    if (JSON.stringify(r) === JSON.stringify(rule)) return;
    const t = setTimeout(() => store.updateRule(r), 400);
    return () => clearTimeout(t);
  }, [r]);
  const set = (patch: Partial<RuleTemplate>) => setR((x) => ({ ...x, ...patch }));
  const v = r.verification;
  const overrides = store.data.companies.filter((c) => c.ruleOverrides?.[r.id]);
  const [reminderText, setReminderText] = useState(r.reminders?.join(", ") ?? "");
  return (
    <div className="col" style={{ gap: 20, paddingBottom: 8, minWidth: 400 }}>
      <PaneHeader title={r.name || "未命名规则"} detail={store.scheduleText(r.schedule)}><Button size="small" onClick={onDelete}>删除规则</Button></PaneHeader>
      <FormGroup title="基本信息" canvas>
        <FieldRow label="名称"><TextField value={r.name} onChange={(name) => set({ name })} placeholder="名称" /></FieldRow>
        <FieldRow label="当地名称"><TextField value={r.localName} onChange={(localName) => set({ localName })} placeholder="可选" /></FieldRow>
        <FieldRow label="适用法域" hint="法域代码，用逗号分隔，例如 HK, SG。"><ListField values={r.jurisdictions} onChange={(jurisdictions) => set({ jurisdictions })} placeholder="HK, SG" /></FieldRow>
        <FieldRow label="公司类型" hint="只适用于这些公司类型；留空则适用全部。"><ListField values={r.entityForms} onChange={(entityForms) => set({ entityForms })} placeholder="全部" /></FieldRow>
        <Switch checked={r.enabled} onChange={(enabled) => set({ enabled })}>启用这条规则</Switch>
      </FormGroup>
      <FormGroup title="核对" canvas>
        <FieldRow label="状态"><TrustBadge trust={v?.status === "confirmed" ? { kind: "confirmed", scope: "该法域通用", on: v.confirmedOn } as any : { kind: "draft" } as any} showConfirmed /></FieldRow>
        {v?.status === "confirmed" && <>
          <FieldRow label="依据"><span className="selectable">{v.source ? `${v.sourceKind}：${v.source}` : v.sourceKind}</span></FieldRow>
          <FieldRow label="核对人"><span className="selectable">{v.confirmedBy}</span></FieldRow>
          <FieldRow label="核对日期"><span>{v.confirmedOn ? D.long(v.confirmedOn) : "—"}</span></FieldRow>
        </>}
        {overrides.length > 0 && <FieldRow label="单独确认"><span>{overrides.map((c) => c.name).join("、")}</span></FieldRow>}
        <div className="row gap12"><Button kind="primary" size="small" onClick={onConfirm}>{v?.status === "confirmed" ? "修改核对信息…" : "确认这条规则…"}</Button><span className="t-meta muted">修改下面的算法后，这条规则会退回“待核对”。</span></div>
      </FormGroup>
      <FormGroup title="截止日计算" canvas>
        <ScheduleEditor schedule={r.schedule} onChange={(schedule) => set({ schedule })} />
        <FieldRow label="遇周末"><SelectField options={(Object.keys(dateAdjustLabel) as DateAdjust[]).map((k) => [k, dateAdjustLabel[k]] as [DateAdjust, string])} value={r.adjust} onChange={(adjust) => set({ adjust })} minWidth={220} /></FieldRow>
        <FieldRow label="提前提醒" hint="到期前几天提醒，用逗号分隔；留空则用通用设置。">
          <span style={{ maxWidth: 220, display: "block" }}><TextField value={reminderText} placeholder="60, 30, 7" onChange={(t) => {
            setReminderText(t);
            const d = t.split(/[,，\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
            set({ reminders: d.length ? d.sort((a, b) => b - a) : undefined });
          }} /></span>
        </FieldRow>
      </FormGroup>
      <FormGroup title="说明" canvas>
        <FieldRow label="通常办理方"><TextField value={r.responsibleHint} onChange={(responsibleHint) => set({ responsibleHint })} placeholder="例如公司秘书、税务代理" /></FieldRow>
        <FieldRow label="逾期后果"><TextField multiline rows={2} value={r.penalty} onChange={(penalty) => set({ penalty })} placeholder="可选" /></FieldRow>
        <FieldRow label="备注"><TextField multiline rows={3} value={r.notes} onChange={(notes) => set({ notes })} placeholder="可选" /></FieldRow>
      </FormGroup>
      {!!r.revisions?.length && <FormGroup title="修改记录" canvas>
        {[...r.revisions].reverse().map((x, i) => <FieldRow key={i} label={D.long(x.on)}><span>{x.summary}</span></FieldRow>)}
      </FormGroup>}
    </div>
  );
}
