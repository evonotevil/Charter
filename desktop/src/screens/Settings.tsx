// 设置（Charter 4）：居中浮层。常规（数据与同步、提醒）/ 公司资料（集团、档案清单、文件包用途）/ 到期规则（合规规则）/ 高级（备份与恢复）。

import { useEffect, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import { type CorporateGroup, type DateAdjust, type DocumentType, type NodeKind, type NodeRef, type RuleTemplate, type ValidityKind, brandPalette, dateAdjustLabel, ref, refKey, uuid, validityKinds, validityLabel } from "../domain/models";
import { snapshotKeep, snapshotTitle, type DataSnapshot } from "../domain/folder";
import { sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import { type SettingsPane, settingsGroups, settingsPaneTitle } from "../state/router";
import { syncDetail, syncNeedsAttention, syncTitle } from "../state/sync";
import { type ConfigBundle, applyConfig, configImportDiff, exportConfig, readConfig } from "../state/actions";
import { type OpenedBackup, exportBackup, readBackup, restoreBackup } from "../services/backup";
import { installSampleData } from "../state/sample";
import { nonArchiveTypeIDs } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { Button, Checkbox, ConfirmSheet, EmptyStateView, FieldRow, FormGroup, ListField, Modal, Pill, RadioGroup, SelectField, SheetScaffold, Switch, TextField } from "../ui/kit";
import { ScheduleEditor } from "./common";
import { ArchiveItemFields, type ItemDraft, newItemDraft } from "./Companies";
import { PurposeEditor } from "./Packet";
import { InlineText } from "./Agents";

export function SettingsView() {
  const { router } = useApp();
  const pane: SettingsPane = router.settings ?? "sync";
  const [leaving, setLeaving] = useState(false);
  const close = () => { setLeaving(true); setTimeout(() => router.set("settings", null), 120); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !router.sheet && !document.querySelector(".overlay .sheet, .popover")) { e.preventDefault(); close(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className={`s4-backdrop ${leaving ? "out" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="s4-window appear" role="dialog" aria-label="设置">
        <nav className="s4-nav">
          <div style={{ fontSize: 18, fontWeight: 800, padding: "4px 12px 6px" }}>设置</div>
          {settingsGroups().map((g) => (
            <div key={g.title} className="col" style={{ gap: 2 }}>
              <span className="v4-label" style={{ padding: "14px 12px 6px" }}>{g.title}</span>
              {g.panes.map((p) => (
                <button key={p} className={`s4-navitem ${p === pane ? "on" : ""}`} aria-current={p === pane || undefined} onClick={() => router.set("settings", p)}>{settingsPaneTitle[p]}</button>
              ))}
            </div>
          ))}
          <span className="spacer" />
          <span className="t-micro muted num" style={{ padding: "0 12px" }}>Charter {typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""}</span>
        </nav>
        <div className="col grow" style={{ minWidth: 0, position: "relative" }} key={pane}>
          <button className="v4-x" aria-label="关闭设置" title="关闭（Esc）" onClick={close} style={{ position: "absolute", right: 14, top: 14, zIndex: 2 }}><Icon name="xmark" size={12} /></button>
          {pane === "groups" ? <GroupsSettings /> : pane === "archiveItems" ? <ArchiveItemsSettings /> : pane === "purposes" ? <PacketSettings /> : pane === "rules" ? <RulesSettings /> : <GeneralSettings pane={pane} />}
        </div>
      </div>
    </div>
  );
}

// MARK: - 共用（设置组：白色卡片，行 = 左名称+说明，右控件）

function PaneHeader({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="row start gap12" style={{ paddingRight: 36 }}>
      <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{title}</span>
        {detail && <span className="t-meta muted">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

export function SGroup({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return <div className="col gap8"><div className="s4-card">{children}</div>{footer && <span className="t-meta muted" style={{ padding: "0 4px" }}>{footer}</span>}</div>;
}

export function SRow({ title, detail, children, danger }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; danger?: boolean }) {
  return (
    <div className="s4-row">
      <span className="col" style={{ gap: 3, flex: "1 1 160px", minWidth: 96 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: danger ? "var(--danger)" : undefined }}>{title}</span>
        {detail && <span className="t-meta muted">{detail}</span>}
      </span>
      {children && <span className="row gap8" style={{ flex: "0 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</span>}
    </div>
  );
}

const Scroll = ({ children }: { children: ReactNode; max?: number }) => (
  <div className="scroll grow"><div className="col" style={{ gap: 22, padding: "28px 36px 32px" }}>{children}</div></div>
);

/** 列表 + 详情：左列表 250px，右详情；两栏等高，各自内部滚动。 */
function Split({ header, list, detail }: { header: ReactNode; list: ReactNode; detail: ReactNode }) {
  return (
    <div className="col grow" style={{ minHeight: 0, padding: "28px 36px 28px", gap: 18 }}>
      {header}
      <div className="row grow" style={{ gap: 16, minHeight: 0, alignItems: "stretch" }}>
        <div className="s4-card scroll" style={{ width: 250, flex: "none", padding: 6 }}>{list}</div>
        <div className="scroll grow col" style={{ minWidth: 0, gap: 14 }}>{detail}</div>
      </div>
    </div>
  );
}

function ListItem({ on, onClick, lead, title, sub, trailing }: { on: boolean; onClick: () => void; lead?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode }) {
  return (
    <button className={`s4-item ${on ? "on" : ""}`} onClick={onClick} aria-current={on || undefined}>
      {lead}
      <span className="col grow" style={{ minWidth: 0, gap: 1 }}>
        <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        {sub && <span className="ellipsis" style={{ fontSize: 12, opacity: on ? 0.7 : 1, color: on ? undefined : "var(--muted)" }}>{sub}</span>}
      </span>
      {trailing}
    </button>
  );
}

// MARK: - 常规与高级

const paneDetail: Partial<Record<SettingsPane, string>> = {
  sync: "档案保存在哪个文件夹，以及是否在同步。",
  reminders: "到期事项什么时候提醒、由哪台电脑提醒、写进哪个日历。",
  backup: "完整备份、配置迁移和快照。会删除数据的操作在最下面。",
};

function GeneralSettings({ pane }: { pane: SettingsPane }) {
  const { store, sync } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const [restoring, setRestoring] = useState<DataSnapshot | null>(null);
  const [pendingConfig, setPendingConfig] = useState<{ bundle: ConfigBundle; fileName: string } | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{ opened: OpenedBackup; fileName: string } | null>(null);
  const [confirmFolder, setConfirmFolder] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [newDay, setNewDay] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (pane === "backup") void store.refreshSnapshots(); }, [pane]);
  const p = platform();
  const root = store.folder.root;
  const s = sync.state;
  const cloud = s.kind !== "local";
  const finder = p.os === "windows" ? "在资源管理器中显示" : "在访达中显示";
  const settings = store.data.settings;
  const addDay = () => {
    const d = parseInt(newDay.trim(), 10);
    if (d > 0 && d <= 730 && !settings.reminderDays.includes(d)) store.saveSettings((x) => { x.reminderDays = [...x.reminderDays, d].sort((a, b) => b - a); });
    setNewDay(""); setAdding(false);
  };
  const chooseFolder = async () => {
    setConfirmFolder(false);
    const dir = await p.pickFolder({ title: "选择数据文件夹" });
    if (dir) await store.changeDataRoot(dir);
  };
  const counts = (x: DataSnapshot) => [x.companies != null ? `${x.companies} 家公司` : null, x.documents != null ? `${x.documents} 份文件` : null].filter(Boolean) as string[];
  const icsPath = p.join(root, `${settings.calendarName}.ics`);
  return (
    <Scroll>
      <PaneHeader title={settingsPaneTitle[pane]} detail={paneDetail[pane]} />
      {pane === "sync" && <>
        <SGroup footer="把数据文件夹放进 iCloud 云盘或 OneDrive，Mac 和 Windows 电脑就能共用同一套档案。">
          <SRow title={root.split(/[\\/]/).filter(Boolean).pop()} detail={<span className="selectable mono" title={root}>{root}</span>}>
            <Button size="small" onClick={() => void p.openPath(root)}>{finder}</Button>
            <Button size="small" onClick={() => setConfirmFolder(true)}>更换…</Button>
          </SRow>
          <SRow title={<span className="row gap6"><span className="v4-dot" style={{ background: syncNeedsAttention(s) ? "var(--amber)" : cloud ? "#B5D334" : "var(--muted)" }} />{cloud ? syncTitle(s) : "仅保存在这台电脑上"}</span>} detail={syncDetail(s)}>
            <Button size="small" onClick={() => void sync.refresh()}>立即检查</Button>
          </SRow>
        </SGroup>
      </>}
      {pane === "reminders" && <>
        <SGroup>
          <SRow title="提前提醒" detail="到期前这些天各提醒一次。">
            {[...settings.reminderDays].sort((a, b) => b - a).map((d) => (
              <span key={d} className="v4-chip num">{d} 天{settings.reminderDays.length > 1 && <button aria-label={`移除 ${d} 天`} onClick={() => store.saveSettings((x) => { x.reminderDays = x.reminderDays.filter((y) => y !== d); })}><Icon name="xmark" size={8} /></button>}</span>
            ))}
            {adding ? <input className="v4-input num" autoFocus value={newDay} onChange={(e) => setNewDay(e.target.value.replace(/\D/g, ""))} onBlur={addDay} onKeyDown={(e) => { if (e.key === "Enter") addDay(); if (e.key === "Escape") { e.stopPropagation(); setAdding(false); setNewDay(""); } }} placeholder="天数" aria-label="添加提醒天数" style={{ width: 64, height: 28 }} />
              : <button className="v4-toggle" onClick={() => setAdding(true)}>+ 添加</button>}
          </SRow>
          <SRow title="提醒时间" detail="系统通知和日历提醒都在这个时间。">
            <SelectField options={Array.from({ length: 16 }, (_, i) => [i + 6, `${String(i + 6).padStart(2, "0")}:00`] as [number, string])} value={settings.notificationHour} onChange={(h) => store.saveSettings((x) => { x.notificationHour = h; })} minWidth={110} />
          </SRow>
          <SRow title="由这台电脑发通知" detail={store.isPrimaryDevice ? "多台电脑共用一个数据文件夹时，只让一台发，避免重复。" : `现在由“${settings.primaryDeviceName ?? "另一台电脑"}”发通知。`}>
            <Switch checked={store.isPrimaryDevice} onChange={(v) => store.saveSettings((x) => { if (v) { x.primaryDeviceID = store.deviceID; x.primaryDeviceName = store.deviceName; } else { x.primaryDeviceID = "none"; x.primaryDeviceName = undefined; } })} />
          </SRow>
        </SGroup>
        <SGroup footer="用 Apple 日历或 Outlook 订阅这个文件后，手机上也能看到到期事项。">
          <SRow title="同步到日历" detail={`在数据文件夹里生成 ${settings.calendarName}.ics，事项变化时自动更新。`}>
            <Switch checked={settings.calendarEnabled} onChange={(v) => store.saveSettings((x) => { x.calendarEnabled = v; })} />
          </SRow>
          {settings.calendarEnabled && <SRow title="订阅文件" detail={<span className="mono selectable">{icsPath}</span>}>
            <Button size="small" onClick={() => void p.reveal(icsPath).catch(() => void p.openPath(root))}>{finder}</Button>
            <Button size="small" onClick={() => { void p.copyText(icsPath); store.showToast("路径已复制。"); }}>复制路径</Button>
          </SRow>}
        </SGroup>
      </>}
      {pane === "backup" && <>
        <SGroup>
          <SRow title="导出备份" detail="把公司、集团、人员、中介、事项和归档的 PDF 打包成一个 ZIP，可在另一台电脑上恢复。">
            <Button size="small" kind="primary" disabled={store.isLoading || store.loadFailed || backupBusy} onClick={async () => {
              const t = await p.saveDialog({ defaultName: `Charter 备份 ${store.today}.zip`, extensions: ["zip"], title: "导出备份" });
              if (!t) return;
              setBackupBusy(true);
              try { const i = await exportBackup(store, t); store.showToast(`备份已导出：${i.companies} 家公司、${i.groups} 个集团、${i.files} 个归档文件。`, () => void p.reveal(t), finder); }
              catch (e) { store.setError(`导出备份失败：${(e as Error).message}。请换一个可写入的位置再试。`); }
              finally { setBackupBusy(false); }
            }}>{backupBusy ? "正在导出…" : "导出备份…"}</Button>
          </SRow>
          <SRow title="从备份恢复" detail="用备份替换当前全部档案。恢复前会先给当前状态做快照。">
            <Button size="small" disabled={store.isLoading || store.isImporting || backupBusy} onClick={async () => {
              const f = (await p.pickFiles({ multiple: false, extensions: ["zip"], title: "选择备份" }))[0];
              if (!f) return;
              try { setPendingBackup({ opened: await readBackup(f), fileName: f.split(/[\\/]/).pop()! }); } catch (e) { store.setError((e as Error).message); }
            }}>选择备份…</Button>
          </SRow>
        </SGroup>
        <SGroup footer="配置只含提醒设置和模板库（法域、档案条目、规则、文件包用途），不含公司和文件。">
          <SRow title="导出配置" detail="让另一套数据沿用同样的规则和清单。">
            <Button size="small" onClick={async () => { const t = await p.saveDialog({ defaultName: `Charter 配置 ${store.today}.json`, extensions: ["json"], title: "导出" }); if (t) await exportConfig(store, t); }}>导出…</Button>
          </SRow>
          <SRow title="导入配置" detail="先列出会有哪些变化，确认后再应用。">
            <Button size="small" disabled={store.isLoading || store.loadFailed} onClick={async () => {
              const f = (await p.pickFiles({ multiple: false, extensions: ["json"], title: "读取配置" }))[0];
              if (!f) return;
              try { setPendingConfig({ bundle: await readConfig(f), fileName: f.split(/[\\/]/).pop()! }); } catch (e) { store.setError((e as Error).message); }
            }}>导入…</Button>
          </SRow>
        </SGroup>
        <SGroup footer={`每天第一次打开，以及恢复、清空、导入配置之前自动保存，保留最近 ${snapshotKeep} 份。`}>
          <SRow title="本地快照" detail="档案记录的自动存档。">
            <Button size="small" onClick={() => void store.revealSnapshots()}>{finder}</Button>
            <Button size="small" disabled={store.isLoading || store.loadFailed} onClick={() => void store.backUpNow()}>立即保存</Button>
          </SRow>
          {store.snapshots.slice(0, 5).map((x) => (
            <SRow key={x.id} title={<span className="num" style={{ fontWeight: 500 }}>{snapshotTitle(x.date)}</span>} detail={[x.reason, ...counts(x)].join(" · ")}>
              <Button size="small" kind="quiet" disabled={store.isLoading || store.isImporting} onClick={() => setRestoring(x)}>恢复…</Button>
            </SRow>
          ))}
        </SGroup>
        <SGroup>
          <SRow title="载入示例数据" detail="一套虚构的远澜、明岸集团数据。会替换当前档案，建议先换一个空文件夹。"><Button size="small" onClick={() => setConfirmSample(true)}>载入…</Button></SRow>
          <SRow title="清空所有数据" danger detail="移除公司、集团、人员、中介、文件和事项，设置与模板库保留。清空前自动保存快照。">
            <Button kind="danger" size="small" disabled={store.isLoading || store.isImporting || store.loadFailed} onClick={() => setConfirmClear(true)}>清空…</Button>
          </SRow>
        </SGroup>
      </>}
      {confirmFolder && <ConfirmSheet title="更换数据文件夹？" message="Charter 会改用新文件夹里的档案；当前文件夹的内容原样保留，不会移动或删除。" confirmTitle="选择文件夹…" onClose={() => setConfirmFolder(false)} onConfirm={() => void chooseFolder()} />}
      {confirmSample && <ConfirmSheet title="载入示例数据？" message="示例数据会替换当前档案。载入前会自动保存快照，可以恢复。" confirmTitle="载入" destructive onClose={() => setConfirmSample(false)} onConfirm={() => { setConfirmSample(false); void installSampleData(store); }} />}
      {confirmClear && <ConfirmSheet title="清空所有数据？" message="清空前会自动保存一份快照（连同归档文件），需要时可在这里恢复。设置和模板库会保留。" details={store.clearSummaryLines}
        confirmTitle="清空" destructive onClose={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); void store.clearAllData(); }} />}
      {restoring && <ConfirmSheet title={`恢复到 ${snapshotTitle(restoring.date)} 的状态？`} message="当前状态会先自动保存一份快照，之后也可以再恢复回来。"
        details={[`快照原因：${restoring.reason}`, ...counts(restoring).map((c) => `快照里有 ${c}`), `当前：${store.data.companies.length} 家公司、${store.data.documents.length} 份文件`]}
        confirmTitle="恢复" onClose={() => setRestoring(null)} onConfirm={() => { const x = restoring; setRestoring(null); void store.restoreFromSnapshot(x); }} />}
      {pendingBackup && (() => {
        const i = pendingBackup.opened.info, d = store.data;
        const when = new Date(i.exportedAt);
        return <ConfirmSheet title="用这份备份替换当前档案？" message={`来自“${pendingBackup.fileName}”，导出于 ${isNaN(+when) ? i.exportedAt : when.toLocaleString("zh-CN")}。当前档案会先自动保存一份快照。`}
          details={[`备份里：${i.companies} 家公司、${i.groups} 个集团、${i.people} 个人员、${i.files} 个归档文件`, `当前：${d.companies.length} 家公司、${d.groups.length} 个集团、${d.people.length} 个人员`]}
          confirmTitle="恢复" onClose={() => setPendingBackup(null)} onConfirm={() => { const x = pendingBackup.opened; setPendingBackup(null); void restoreBackup(store, x); }} />;
      })()}
      {pendingConfig && <ConfigImportSheet bundle={pendingConfig.bundle} fileName={pendingConfig.fileName} onClose={() => setPendingConfig(null)} />}
    </Scroll>
  );
}

// MARK: - 集团

function GroupsSettings() {
  const { store, router } = useApp();
  const groups = [...store.data.groups].sort((a, b) => a.name.localeCompare(b.name));
  const sel = store.group(router.settingsGroupID) ?? groups[0];
  const loose = store.ungroupedCompanies.length;
  const create = () => {
    const used = new Set(store.data.groups.map((g) => store.brandColor(g)));
    const g: CorporateGroup = { id: uuid(), name: "新集团", tops: [], extraCompanyIDs: [], notes: "", color: brandPalette.find((c) => !used.has(c)) ?? brandPalette[0] };
    store.commit((d) => { d.groups.push(g as any); }, { label: "新建集团" });
    router.set("settingsGroupID", g.id);
  };
  useEffect(() => { if (router.settingsGroupID === "new") create(); }, [router.settingsGroupID]);
  return (
    <Split
      header={<PaneHeader title="集团" detail="结构图顶部的分组。删除集团只删除分组，公司和持股不受影响。"><Button kind="primary" icon="plus" onClick={create}>新建集团</Button></PaneHeader>}
      list={<>
        {groups.map((g) => <ListItem key={g.id} on={g.id === sel?.id} onClick={() => router.set("settingsGroupID", g.id)}
          lead={<span className="v4-dot" style={{ background: store.brandColor(g) }} />} title={g.name} sub={`${store.companyIDsIn(g).size} 家公司`} />)}
        {!groups.length && <span className="muted t-meta" style={{ padding: 12 }}>还没有集团。</span>}
        {loose > 0 && <><div className="hairline" style={{ margin: "6px 8px" }} /><span className="row gap8 t-meta muted" style={{ padding: "10px 12px" }}><span className="v4-dot" style={{ boxShadow: "inset 0 0 0 1.5px var(--muted)" }} />不属于任何集团 · {loose} 家</span></>}
      </>}
      detail={sel ? <GroupDetail key={sel.id} g={sel} /> : <EmptyStateView symbol="square.stack.3d.up" title="还没有集团" message="新建一个集团，选它最上层的公司，成员会按持股自动算出。" actionTitle="新建集团" action={create} />}
    />
  );
}

function GroupDetail({ g }: { g: CorporateGroup }) {
  const { store, router } = useApp();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<"top" | "member" | null>(null);
  const save = (fn: (x: CorporateGroup) => void, label?: string) => store.commit((d) => { const x = d.groups.find((y) => y.id === g.id); if (x) fn(x as CorporateGroup); }, label ? { label } : {});
  const rows = store.rowsOf(g);
  const excluded = (g.excludedCompanyIDs ?? []).map((id) => store.company(id)).filter(Boolean);
  const ql = q.trim().toLowerCase();
  const options = !pick ? [] : [
    ...store.data.companies.filter((c) => !ql || c.name.toLowerCase().includes(ql)).map((c) => ({ r: ref("company", c.id), name: c.name, code: c.jurisdiction })),
    ...(pick === "top" ? store.data.people.filter((p) => !ql || p.name.toLowerCase().includes(ql)).map((p) => ({ r: ref("person", p.id), name: p.name, code: [...p.name][0] })) : []),
  ].filter((o) => pick === "top" ? !g.tops.some((t) => refKey(t) === refKey(o.r)) : !rows.some((r) => r.companyID === o.r.id)).slice(0, 8);
  const remove = () => {
    const name = g.name;
    if (router.groupFilter === g.id) router.set("groupFilter", null);
    const { undoID } = store.commit((d) => { d.groups = d.groups.filter((x) => x.id !== g.id); }, { label: `删除集团 ${name}` });
    router.set("settingsGroupID", null);
    store.showToast(`已删除集团“${name}”，公司不受影响。`, undoID ? () => store.undoID(undoID) : undefined);
  };
  const choose = (r: NodeRef) => {
    if (pick === "top") save((x) => { x.tops = [...x.tops, r]; }, "设置集团顶层");
    else store.addToGroup(r.id, g.id);
    setPick(null); setQ("");
  };
  return (
    <>
      <div className="s4-card">
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>名称</span>}>
          <InlineText value={g.name} label="集团名称" onCommit={(v) => v.trim() && save((x) => { x.name = v.trim(); }, "重命名集团")} style={{ fontWeight: 700, textAlign: "right", width: 220 }} />
        </SRow>
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>颜色</span>}>
          {brandPalette.map((c) => {
            const on = store.brandColor(g) === c;
            return <button key={c} aria-label={`颜色 ${c}`} aria-pressed={on} onClick={() => save((x) => { x.color = c; })}
              style={{ width: 20, height: 20, borderRadius: "50%", background: c, boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink)" : undefined }} />;
          })}
        </SRow>
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }} title="从这里沿持股往下，自动算出成员">顶层</span>}>
          <span className="row gap6 wrap" style={{ justifyContent: "flex-end", maxWidth: 380 }}>
            {g.tops.map((t) => (
              <span key={refKey(t)} className="v4-chip" style={{ maxWidth: 320 }}>{t.kind === "company" ? store.company(t.id)?.jurisdiction + " " : ""}{store.nameOf(t)}
                <button aria-label={`移除顶层 ${store.nameOf(t)}`} onClick={() => save((x) => { x.tops = x.tops.filter((y) => refKey(y) !== refKey(t)); }, "移除集团顶层")}><Icon name="xmark" size={8} /></button></span>
            ))}
            <button className="link t-meta" style={{ whiteSpace: "nowrap" }} onClick={() => { setPick(pick === "top" ? null : "top"); setQ(""); }}>+ 添加</button>
          </span>
        </SRow>
      </div>
      {pick && (
        <div className="s4-card" style={{ padding: 8 }}>
          <input className="v4-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={pick === "top" ? "选公司或人做顶层…" : "选要加入的公司…"} aria-label="搜索" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setPick(null); } }} />
          <div className="col" style={{ marginTop: 6 }}>
            {options.map((o) => <button key={refKey(o.r)} className="v4-opt" onClick={() => choose(o.r)}><span className="v4-code" style={o.r.kind === "person" ? { borderRadius: "50%" } : undefined}>{o.code}</span><span className="grow ellipsis">{o.name}</span></button>)}
            {!options.length && <span className="t-meta muted" style={{ padding: 10 }}>没有可选的。</span>}
          </div>
        </div>
      )}
      <div className="s4-card">
        <SRow title="成员" detail={`${rows.length} 家公司`}><button className="link t-meta" onClick={() => { setPick(pick === "member" ? null : "member"); setQ(""); }}>+ 手动加入公司</button></SRow>
        {rows.map((r) => {
          const c = store.company(r.companyID);
          if (!c) return null;
          const m = store.membership(c.id, g);
          return (
            <div key={c.id} className="s4-row" style={{ minHeight: 50 }}>
              <span className="v4-code">{c.jurisdiction}</span>
              <span className="grow ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</span>
              <span className="t-meta muted">{sourceLabel(m)}</span>
              {m.kind !== "top" && <button className="link t-meta" onClick={() => { let msg = ""; const u = store.undoable("移出集团", () => { msg = store.moveOut(c.id, g.id); }); store.showToast(msg || `已把 ${c.name} 移出 ${g.name}。`, u ? () => store.undoID(u) : undefined); }}>移出</button>}
            </div>
          );
        })}
        {!rows.length && <div className="s4-row t-meta muted">先添加顶层，成员会按持股自动算出。</div>}
      </div>
      {excluded.length > 0 && <div className="s4-card">
        <SRow title="已移出" detail="按持股本属于这个集团，你把它们移出了。" />
        {excluded.map((c) => <div key={c!.id} className="s4-row" style={{ minHeight: 46 }}><span className="v4-code">{c!.jurisdiction}</span><span className="grow ellipsis">{c!.name}</span><button className="link t-meta" onClick={() => store.restoreToGroup(c!.id, g.id)}>恢复</button></div>)}
      </div>}
      <div className="row" style={{ padding: "0 4px", justifyContent: "space-between", gap: 16 }}>
        <span className="t-meta muted">成员从顶层沿持股自动算出。共用的上层控股公司画在集团上方，不算成员。</span>
        <button className="t-meta" style={{ color: "var(--danger)", fontWeight: 600, whiteSpace: "nowrap" }} onClick={remove}>删除集团</button>
      </div>
    </>
  );
}

function ConfigImportSheet({ bundle, fileName, onClose }: { bundle: ConfigBundle; fileName: string; onClose: () => void }) {
  const { store } = useApp();
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const when = new Date(bundle.exportedAt);
  const diff = configImportDiff(store, bundle, mode);
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title="导入配置" width={520} subtitle={`来自“${fileName}”，导出于 ${isNaN(+when) ? bundle.exportedAt : when.toLocaleString("zh-CN")}。公司、文件等档案数据不受影响。`}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind={mode === "replace" ? "danger" : "primary"} disabled={!diff.changes} onClick={() => { void applyConfig(store, bundle, mode); onClose(); }}>{mode === "merge" ? "合并导入" : "全部替换"}</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <FormGroup title="导入方式"><RadioGroup options={[["merge", "合并（同名覆盖）"], ["replace", "全部替换"]]} value={mode} onChange={setMode} /></FormGroup>
          <FormGroup title="将会改变">{diff.changes ? diff.lines.map((l, i) => <span key={i}>{l}</span>) : <span className="muted">这份配置和当前的完全一样，导入后不会有任何变化。配置只包含设置和模板库；要找回公司、集团和文件，请用“从备份恢复”。</span>}</FormGroup>
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
      {type.builtIn && <span className="t-meta muted" style={{ padding: "0 4px" }}>内置类型，可以修改。名称和有效期请按中介和银行的要求核对。</span>}
    </div>
  );
}

// MARK: - 档案清单

const personScope = "__person";

function ArchiveItemsSettings() {
  const { store, router } = useApp();
  const lib = store.data.library;
  const [code, setCode] = useState<string>(() => {
    const w = router.archiveScope;
    router.archiveScope = null;
    return w && store.jurisdiction(w) ? w : lib.jurisdictions[0]?.code ?? personScope;
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [addingJ, setAddingJ] = useState(false);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const personTypes = lib.documentTypes.filter((t) => t.owner === "person");
  const saveType = (t: DocumentType) => store.saveLibrary((l) => { const i = l.documentTypes.findIndex((x) => x.id === t.id); if (i >= 0) l.documentTypes[i] = t as any; });
  const deleteType = (id: string) => {
    const before = store.data;
    const name = store.docType(id)?.name ?? "";
    store.saveLibrary((l) => {
      l.documentTypes = l.documentTypes.filter((t) => t.id !== id);
      if (l.archiveItems) for (const k of Object.keys(l.archiveItems)) l.archiveItems[k] = l.archiveItems[k].filter((x) => x !== id);
    });
    const u = store.recordUndo(`删除条目 ${name}`, before);
    setEditing(null);
    store.showToast(`已删除条目“${name}”。`, u ? () => store.undoID(u) : undefined);
  };
  const person = code === personScope;
  const ids = person ? personTypes.map((t) => t.id) : store.templateItems(code);
  const candidates = person ? [] : lib.documentTypes.filter((t) => t.owner === "company" && !ids.includes(t.id) && !nonArchiveTypeIDs.has(t.id) && (!t.jurisdictions.length || t.jurisdictions.includes(code)));
  const move = (i: number, d: number) => { const a = [...ids]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; store.setTemplateItems(a, code); };
  const name = person ? "人员文件" : store.jurisdictionName(code);
  return (<>
    <Split
      header={<PaneHeader title="档案清单" detail="每个法域的公司默认管理哪些文件。新建公司时自动套用，之后可以逐家调整。"><Button kind="primary" icon="plus" onClick={() => setCreatingIn(code)}>新建条目</Button></PaneHeader>}
      list={<>
        {lib.jurisdictions.map((j) => {
          const n = store.data.companies.filter((c) => c.jurisdiction === j.code).length;
          return <ListItem key={j.code} on={code === j.code} onClick={() => setCode(j.code)} lead={<span className="v4-code">{j.code}</span>} title={j.name}
            sub={`${store.templateItems(j.code).length} 个条目 · ${n ? `${n} 家公司` : "暂无公司"}${lib.archiveItems?.[j.code] ? " · 已调整" : ""}`} />;
        })}
        <ListItem on={person} onClick={() => setCode(personScope)} lead={<span className="v4-code" style={{ borderRadius: "50%" }}>人</span>} title="人员文件" sub={`${personTypes.length} 个条目`} />
        <button className="s4-item" style={{ color: "var(--muted)", minHeight: 40 }} onClick={() => setAddingJ(true)}><Icon name="plus" size={12} />新建法域</button>
      </>}
      detail={<>
        <SGroup footer={person ? "护照、身份证等挂在人名下的文件。" : "内置条目是管理用的起始清单，不代表已核验的法定要求。"}>
          <SRow title={name} detail={person ? "挂在人名下的文件。" : `${name}公司默认管理这些文件。`}>
            {!person && lib.archiveItems?.[code] && <Button size="small" kind="quiet" onClick={() => store.saveLibrary((l) => { if (l.archiveItems) delete l.archiveItems[code]; })}>恢复内置</Button>}
          </SRow>
          {!ids.length && <SRow title={<span className="muted" style={{ fontWeight: 400 }}>还没有条目。</span>} />}
          {ids.map((id, i) => {
            const t = store.docType(id);
            return (
              <div key={id} className="s4-row item-row" style={{ minHeight: 56, cursor: "default" }} onDoubleClick={() => setEditing(id)}>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}><span className="ellipsis" style={{ fontWeight: 600 }}>{t?.name ?? id}</span><span className="t-meta muted ellipsis">{t ? validityText(t) : ""}</span></span>
                <span className="row gap4 tools">
                  {!person && <><button className="tool" title="上移" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevron.up" size={10} /></button>
                    <button className="tool" title="下移" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><Icon name="chevron.down" size={10} /></button>
                    <button className="tool" title={`从${name}的清单中去掉（不删除已有文件）`} onClick={() => store.setTemplateItems(ids.filter((x) => x !== id), code)}><Icon name="minus" size={10} /></button></>}
                </span>
                <Button size="small" onClick={() => setEditing(id)}>编辑</Button>
              </div>
            );
          })}
        </SGroup>
        {candidates.length > 0 && <SGroup>
          <SRow title="可添加的已有类型" detail="其他法域也在用的文件类型。" />
          {candidates.map((c) => <SRow key={c.id} title={<span style={{ fontWeight: 500 }}>{c.name}</span>}><Button size="small" kind="quiet" icon="plus" onClick={() => store.setTemplateItems([...ids, c.id], code)}>添加</Button></SRow>)}
        </SGroup>}
      </>}
    />
    {editing && <ItemEditSheet id={editing} scope={code} onClose={() => setEditing(null)} onDelete={deleteType} />}
    {creatingIn && <NewItemSheet scope={creatingIn} onClose={() => setCreatingIn(null)} onCreated={(id) => { setCreatingIn(null); setEditing(id); }} />}
    {addingJ && <JurisdictionForm onClose={() => setAddingJ(false)} onAdded={(c) => setCode(c)} />}
  </>);
}

function ItemEditSheet({ id, scope, onClose, onDelete }: { id: string; scope: string; onClose: () => void; onDelete: (id: string) => void }) {
  const { store } = useApp();
  const t = store.data.library.documentTypes.find((x) => x.id === id);
  if (!t) return null;
  const save = (n: DocumentType) => store.saveLibrary((l) => { const i = l.documentTypes.findIndex((x) => x.id === n.id); if (i >= 0) l.documentTypes[i] = n as any; });
  const used = store.data.documents.filter((d) => d.typeID === t.id).length;
  const forms = scope !== personScope && t.owner === "company" ? store.jurisdiction(scope)?.entityForms ?? [] : [];
  const chosen = new Set(t.entityForms ?? []);
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={t.name || "未命名条目"} subtitle={used ? `已有 ${used} 份文件使用这个类型` : "还没有文件使用这个类型"} width={620}
        leading={!t.builtIn && <Button kind="quiet" disabled={used > 0} title={used ? "仍有文件使用这个类型" : "从所有法域删除这个类型"} onClick={() => { onClose(); onDelete(t.id); }}>删除类型</Button>}
        trailing={<Button kind="primary" onClick={onClose}>完成</Button>}>
        <div className="col" style={{ gap: 18 }}>
          {forms.length > 0 && <FormGroup title="适用的实体类型">
            <span className="t-meta muted">{chosen.size ? "只有所选类型的公司会出现这个条目。" : "所有类型的公司都需要。选择后只对所选类型生效。"}</span>
            <div className="row wrap gap6">{forms.map((f) => {
              const on = chosen.has(f);
              return <button key={f} className={`v4-seg ${on ? "on" : ""}`} onClick={() => { const s = new Set(chosen); if (on) s.delete(f); else s.add(f); save({ ...t, entityForms: s.size ? forms.filter((x) => s.has(x)) : undefined }); }}>{f}</button>;
            })}</div>
          </FormGroup>}
          <DocumentTypeForm type={t} onChange={save} />
        </div>
      </SheetScaffold>
    </Modal>
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
  return (
    <Scroll>
      <PaneHeader title="文件包用途" detail="准备文件包时按用途挑选材料，例如银行开户、年度审计、KYC 更新。">
        <Button kind="primary" icon="plus" onClick={() => setEditing({})}>新建用途</Button>
      </PaneHeader>
      <SGroup>
        {!packets.length && <SRow title="还没有用途" detail="新建用途，选它需要哪些类别的文件。" />}
        {packets.map((p) => (
          <SRow key={p.id} title={p.name || "未命名用途"}
            detail={[p.categories.length ? p.categories.join("、") : "未选文件类别", p.includeDirectorsPassports ? "附董事护照" : "", p.maxAgeMonths ? `${p.maxAgeMonths} 个月内签发` : ""].filter(Boolean).join(" · ")}>
            <Button size="small" onClick={() => setEditing({ id: p.id })}>编辑</Button>
          </SRow>
        ))}
      </SGroup>
      {editing && <PurposeEditor purposeID={editing.id} onClose={() => setEditing(null)} />}
    </Scroll>
  );
}

// MARK: - 合规规则（只管算法；日期对不对在每件到期事项上确认）

function RulesSettings() {
  const { store } = useApp();
  const [selection, setSelection] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const rules = store.data.library.rules;
  const lib = store.data.library;
  const rule = rules.find((r) => r.id === selection);
  const ql = q.trim().toLowerCase();
  const byJ = lib.jurisdictions.map((j) => ({ j, list: rules.filter((r) => r.jurisdictions.includes(j.code) && (!ql || (r.name + r.localName).toLowerCase().includes(ql))) })).filter((x) => x.list.length);
  const add = () => {
    const j = rule?.jurisdictions[0] ?? lib.jurisdictions[0]?.code ?? "HK";
    const r: RuleTemplate = { id: `custom.${uuid().slice(0, 8)}`, name: "新规则", localName: "", jurisdictions: [j], entityForms: [], schedule: { kind: "annualFixed", date: "12-31" }, adjust: "none",
      requiredDocTypeIDs: [], responsibleHint: "", penalty: "", notes: "", needsReview: false, enabled: true, builtIn: false };
    store.saveLibrary((l) => { l.rules.push(r as any); });
    setSelection(r.id);
  };
  const remove = (r: RuleTemplate) => {
    const before = store.data;
    store.saveLibrary((l) => { l.rules = l.rules.filter((x) => x.id !== r.id); });
    const id = store.recordUndo(`删除规则 ${r.name}`, before);
    setSelection(null);
    store.showToast(`已删除规则“${r.name}”。`, id ? () => store.undoID(id) : undefined);
  };
  return (
    <Split
      header={<PaneHeader title="合规规则" detail="各法域的截止日怎么算。算出来的日期在每件到期事项上确认或修改。"><Button kind="primary" icon="plus" onClick={add}>新建规则</Button></PaneHeader>}
      list={<>
        <input className="v4-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索规则" aria-label="搜索规则" style={{ height: 34, marginBottom: 4 }} />
        {byJ.map(({ j, list }) => (
          <div key={j.code} className="col" style={{ gap: 1 }}>
            <span className="v4-label" style={{ padding: "10px 10px 4px" }}>{j.name}</span>
            {list.map((r) => <ListItem key={r.id} on={r.id === selection} onClick={() => setSelection(r.id)} title={<span style={{ color: r.enabled || r.id === selection ? undefined : "var(--muted)" }}>{r.name || "未命名规则"}</span>}
              sub={r.enabled ? store.scheduleText(r.schedule) : "已停用"} />)}
          </div>
        ))}
        {!byJ.length && <span className="muted t-meta" style={{ padding: 12 }}>没有符合的规则。</span>}
      </>}
      detail={rule ? <RuleForm key={rule.id} rule={rule} onDelete={() => remove(rule)} />
        : <div className="col grow" style={{ justifyContent: "center" }}><EmptyStateView symbol="calendar.badge.clock" title="选择一条规则" message="可以调整截止日的算法、遇周末怎么处理，以及适用哪些公司。" /></div>}
    />
  );
}

function RuleForm({ rule, onDelete }: { rule: RuleTemplate; onDelete: () => void }) {
  const { store } = useApp();
  const [r, setR] = useState<RuleTemplate>(rule);
  useEffect(() => setR(rule), [rule]);
  useEffect(() => {
    if (JSON.stringify(r) === JSON.stringify(rule)) return;
    const t = setTimeout(() => store.updateRule(r), 400);
    return () => clearTimeout(t);
  }, [r]);
  const set = (patch: Partial<RuleTemplate>) => setR((x) => ({ ...x, ...patch }));
  const n = store.data.companies.filter((c) => r.enabled && r.jurisdictions.includes(c.jurisdiction) && !c.disabledRuleIDs.includes(r.id)).length;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="s4-card">
        <SRow title={<InlineText value={r.name} label="规则名称" onCommit={(name) => set({ name })} style={{ fontSize: 17, fontWeight: 700 }} />} detail={`${store.scheduleText(r.schedule)} · 适用 ${n} 家公司`}>
          <Switch checked={r.enabled} onChange={(enabled) => set({ enabled })}>启用</Switch>
        </SRow>
      </div>
      <FormGroup title="截止日计算" canvas>
        <ScheduleEditor schedule={r.schedule} onChange={(schedule) => set({ schedule })} />
        <FieldRow label="遇周末"><SelectField options={(Object.keys(dateAdjustLabel) as DateAdjust[]).map((k) => [k, dateAdjustLabel[k]] as [DateAdjust, string])} value={r.adjust} onChange={(adjust) => set({ adjust })} minWidth={220} /></FieldRow>
      </FormGroup>
      <FormGroup title="适用范围" canvas>
        <FieldRow label="法域" hint="法域代码，用逗号分隔，例如 HK, SG。"><ListField values={r.jurisdictions} onChange={(jurisdictions) => set({ jurisdictions })} placeholder="HK, SG" /></FieldRow>
        <FieldRow label="公司类型" hint="留空则适用全部。"><ListField values={r.entityForms} onChange={(entityForms) => set({ entityForms })} placeholder="全部" /></FieldRow>
      </FormGroup>
      <FormGroup title="说明" canvas>
        <FieldRow label="当地名称"><TextField value={r.localName} onChange={(localName) => set({ localName })} placeholder="可选" /></FieldRow>
        <FieldRow label="通常办理方"><TextField value={r.responsibleHint} onChange={(responsibleHint) => set({ responsibleHint })} placeholder="例如公司秘书、税务代理" /></FieldRow>
        <FieldRow label="逾期后果"><TextField multiline rows={2} value={r.penalty} onChange={(penalty) => set({ penalty })} placeholder="可选" /></FieldRow>
        <FieldRow label="备注"><TextField multiline rows={3} value={r.notes} onChange={(notes) => set({ notes })} placeholder="可选" /></FieldRow>
      </FormGroup>
      <div className="row" style={{ justifyContent: "flex-end", padding: "0 4px" }}>
        <button className="t-meta" style={{ color: "var(--danger)", fontWeight: 600 }} onClick={onDelete}>删除规则</button>
      </div>
    </div>
  );
}
