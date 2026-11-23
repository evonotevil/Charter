// 设置（Charter 4）：居中浮层。常规（数据与同步、提醒）/ 公司资料（集团、档案清单、文件包用途）/ 到期规则（合规规则）/ 高级（备份与恢复）。

import { AboutSettings } from "./About";
import { safeName } from "../domain/folder";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as D from "../domain/day";
import { type CorporateGroup, type DateAdjust, type DocumentType, type NodeKind, type NodeRef, type RuleTemplate, type ValidityKind, brandPalette, isHexColor, isStatusLike, dateAdjustLabel, ref, refKey, uuid, validityKinds, validityLabel } from "../domain/models";
import { reminderDays } from "../domain/engine";
import { snapshotKeep, snapshotTitle, type DataSnapshot } from "../domain/folder";
import { sourceLabel } from "../domain/groups";
import { useApp } from "../state/hooks";
import { type SettingsPane, settingsGroups, settingsPaneTitle, settingsPaneSymbol } from "../state/router";
import { syncDetail, syncNeedsAttention, syncTitle } from "../state/sync";
import { type ConfigBundle, applyConfig, configImportDiff, exportConfig, readConfig } from "../state/actions";
import { type OpenedBackup, exportBackup, readBackup, restoreBackup } from "../services/backup";
import { installSampleData } from "../state/sample";
import { ShareCard } from "./Share";
import { nonArchiveTypeIDs } from "../state/store";
import { platform } from "../platform/platform";
import { Icon } from "../ui/Icon";
import { autoSyncOn, autoSyncPref, autoSyncStatus, autoSyncSupported, describeError, disableCalendarSync, remindersEnabled, runCalendarSync, setRemindersEnabled } from "../services/calendarSync";
import { writeCalendarFile } from "../services/packets";
import { useChildMotion } from "../ui/motion";
import { companyTint, groupRing, setDensity, useDensity } from "../ui/uistyle";
import { Avatar, Banner, Card, PageHeader, Button, Segmented, Checkbox, ConfirmSheet, EmptyStateView, FieldRow, FormGroup, ListField, Modal, Pill, Popover, RadioGroup, SelectField, SheetScaffold, Switch, TextField, Note } from "../ui/kit";
import { ScheduleEditor } from "./common";
import { ArchiveItemFields, type ItemDraft, newItemDraft } from "./Companies";
import { PurposeEditor } from "./Packet";
import { InlineText } from "./Agents";
import { ReminderTimeField } from "../ui/ReminderTimeField";
import { addReminderDayValue } from "./reminderDays";
import "./settings557.css";
import "./reminders559.css";

export function SettingsView() {
  const { router } = useApp();
  const pane: SettingsPane = router.settingsPane === "sync" ? "reminders" : router.settingsPane;
  return (
    <div className="page settings-page-557"><div className="page-inner">
      <PageHeader title="设置" subtitle="提醒、外观、集团、档案清单、规则和备份。" />
      <div className="settings">
        <nav className="settings-nav" aria-label="设置分类">
          {settingsGroups().map((g) => (
            <div key={g.title} className="nav">
              <span className="nav-head" role="presentation">{g.title}</span>
              {g.panes.map((p) => (
                <button key={p} className="nav-item" aria-current={p === pane ? "page" : undefined} onClick={() => router.set("settingsPane", p)}><Icon name={settingsPaneSymbol[p]} size={15} />{settingsPaneTitle[p]}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className={`col ${pane === "groups" || pane === "archiveItems" || pane === "rules" ? "settings-pane-fixed-557" : "settings-pane-scroll-557"}`} style={{ minWidth: 0 }} key={pane}>
          {pane === "about" ? <AboutSettings /> : pane === "appearance" ? <AppearanceSettings /> : pane === "scope" ? <ScopeSettings /> : pane === "privacy" ? <PrivacySettings /> : pane === "groups" ? <GroupsSettings /> : pane === "archiveItems" ? <ArchiveItemsSettings /> : pane === "purposes" ? <PacketSettings /> : pane === "rules" ? <RulesSettings /> : <GeneralSettings pane={pane} />}
        </div>
      </div>
    </div></div>
  );
}

/** 设备与同步：数据文件夹、同步状态、这台电脑、外观偏好。 */
export function SyncView() {
  const { store, sync } = useApp();
  const [confirmFolder, setConfirmFolder] = useState(false);
  const p = platform();
  const root = store.folder.root;
  const s = sync.state;
  const cloud = s.kind !== "local";
  const warn = syncNeedsAttention(s);
  const finder = p.os === "windows" ? "在资源管理器中显示" : "在访达中显示";
  const chooseFolder = async () => {
    setConfirmFolder(false);
    const dir = await p.pickFolder({ title: "选择数据文件夹" });
    if (dir) await store.changeDataRoot(dir);
  };
  return (
    <div className="page"><div className="page-inner">
      <PageHeader crumb="工作区" title="设备与同步" subtitle="这台电脑是不是最新的，档案存在哪里。" />
      <Banner tone={warn ? "warn" : "ok"} icon={cloud ? "icloud" : "desktopcomputer"} title={cloud ? syncTitle(s) : "档案只保存在这台电脑上"}
        actions={cloud ? <Button onClick={() => void sync.refresh()}>立即检查</Button> : undefined}>{syncDetail(s)}</Banner>
      <div className="sync-grid-557">
        <ShareCard>
          <div className="pref data-folder-557">
            <div className="device grow">
              <span className="ic"><Icon name="folder" size={22} /></span>
              <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
                <span className="t-row">数据文件夹</span>
                <span className="t-row">{root.split(/[\\/]/).filter(Boolean).pop()}</span>
                <span className="t-meta muted mono selectable" style={{ overflowWrap: "anywhere" }}>{root}</span>
              </div>
            </div>
            <div className="row gap8 wrap data-folder-actions-557">
              <Button size="small" onClick={() => void p.openPath(root)}>{finder}</Button>
              <Button size="small" onClick={() => setConfirmFolder(true)}>更换文件夹…</Button>
            </div>
          </div>
        </ShareCard>
        <Card title="这台电脑">
            <div className="device">
              <span className="ic blue"><Icon name={p.os === "mac" ? "laptopcomputer" : "desktopcomputer"} size={22} /></span>
              <div className="col grow" style={{ minWidth: 0, gap: 4 }}>
                <span className="row gap8"><span className="t-row">{store.deviceName}</span><span className="pill info">本机</span>{store.isPrimaryDevice && <span className="pill ok">发提醒的电脑</span>}</span>
                <span className="t-meta muted">{store.isPrimaryDevice ? "到期提醒由这台电脑发出。" : `到期提醒由“${store.data.settings.primaryDeviceName ?? "另一台电脑"}”发出。`}</span>
              </div>
            </div>
        </Card>
      </div>
      {confirmFolder && <ConfirmSheet title="更换数据文件夹？" message="Charter 会改用新文件夹里的档案；当前文件夹的内容原样保留，不会移动或删除。" confirmTitle="选择文件夹…" onClose={() => setConfirmFolder(false)} onConfirm={() => void chooseFolder()} />}
    </div></div>
  );
}

// MARK: - 共用（设置组：白色卡片，行 = 左名称+说明，右控件）

export function PaneHeader({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="row start gap12">
      <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
        <h2 className="t-title ellipsis">{title}</h2>
        {detail && <span className="t-meta muted">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

export function SGroup({ children, footer, scope }: { children: ReactNode; footer?: ReactNode; scope?: string }) {
  const box = useChildMotion<HTMLDivElement>(scope);
  return <div className="col gap8"><div ref={box} className="s4-card" style={{ position: "relative" }}>{children}</div>{footer && <span className="t-meta muted" style={{ padding: "0 4px" }}>{footer}</span>}</div>;
}

export function SRow({ title, detail, children, danger }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; danger?: boolean }) {
  return (
    <div className="s4-row">
      <span className="col" style={{ gap: 3, flex: "1 1 160px", minWidth: 96 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: danger ? "var(--danger)" : undefined }}>{title}</span>
        {detail && <span className="t-meta muted">{detail}</span>}
      </span>
      {children && <span className="row gap8" style={{ flex: "0 1 auto", minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</span>}
    </div>
  );
}

export const Scroll = ({ children }: { children: ReactNode; max?: number }) => (
  <div className="col" style={{ gap: 20 }}>{children}</div>
);

/** 列表 + 详情：左列表 250px，右详情；两栏等高，各自内部滚动。 */
function Split({ header, list, detail, scope }: { header: ReactNode; list: ReactNode; detail: ReactNode; scope?: string }) {
  const box = useChildMotion<HTMLDivElement>(scope);
  return (
    <div className="col settings-split-wrap" style={{ gap: 20 }}>
      {header}
      <div className="settings-split">
        <div ref={box} className="s4-card scroll settings-split-list">{list}</div>
        <div className="grow col scroll settings-split-detail">{detail}</div>
      </div>
    </div>
  );
}

function ListItem({ mid, on, onClick, lead, title, sub, trailing }: { mid?: string; on: boolean; onClick: () => void; lead?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode }) {
  return (
    <button data-mid={mid} className={`s4-item ${on ? "on" : ""}`} onClick={onClick} aria-current={on || undefined}>
      {lead}
      <span className="col grow" style={{ minWidth: 0, gap: 1 }}>
        <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {sub && <span className="ellipsis" style={{ fontSize: 12, opacity: on ? 0.7 : 1, color: on ? undefined : "var(--muted)" }}>{sub}</span>}
      </span>
      {trailing}
    </button>
  );
}

// MARK: - 常规与高级

const paneDetail: Partial<Record<SettingsPane, string>> = {
  sync: "档案保存在哪个文件夹，以及是否在同步。",
  reminders: "同步后，申报事项显示在日历的截止日。系统日历会按设定的时间提前通知。",
  backup: "完整备份、配置迁移和快照。会删除数据的操作在最下面。",
};

function AppearanceSettings() {
  const density = useDensity();
  const initial = (() => {
    try {
      const stored = localStorage.getItem("charter.theme");
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch { return "system"; }
  })();
  const [theme, setThemeState] = useState(initial);
  const setTheme = (value: string) => {
    setThemeState(value);
    try { if (value === "system") localStorage.removeItem("charter.theme"); else localStorage.setItem("charter.theme", value); } catch { /* 本机偏好不可写时保持当前会话 */ }
    if (value === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = value;
  };
  return <Scroll>
    <PaneHeader title="外观" detail="调整界面的信息密度和深浅色，只影响这台电脑。" />
    <SGroup>
      <SRow title="信息密度" detail="紧凑模式行距更短，一屏显示更多内容。">
        <AppearanceChoice ariaLabel="信息密度" value={density} onChange={setDensity} options={[
          ["comfortable", "舒适", <DensityPreview key="comfortable" density="comfortable" />],
          ["compact", "紧凑", <DensityPreview key="compact" density="compact" />],
        ]} />
      </SRow>
      <SRow title="深浅色" detail="跟随系统会随电脑的外观设置自动变化。">
        <AppearanceChoice ariaLabel="深浅色" value={theme} onChange={setTheme} options={[
          ["system", "跟随系统", <ThemePreview key="system" theme="system" />],
          ["light", "浅色", <ThemePreview key="light" theme="light" />],
          ["dark", "深色", <ThemePreview key="dark" theme="dark" />],
        ]} />
      </SRow>
    </SGroup>
  </Scroll>;
}

function AppearanceChoice<V extends string>({ ariaLabel, options, value, onChange }: {
  ariaLabel: string;
  options: [V, string, ReactNode][];
  value: V;
  onChange: (value: V) => void;
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (index: number) => {
    const option = options[index]?.[0];
    if (option === undefined) return;
    onChange(option);
    optionRefs.current[index]?.focus({ preventScroll: true });
  };
  return (
    <div className="appearance-choice" role="radiogroup" aria-label={ariaLabel} style={{ "--choice-count": options.length } as React.CSSProperties}>
      {options.map(([option, label, preview], index) => (
        <button key={option} ref={(node) => { optionRefs.current[index] = node; }} type="button" className={option === value ? "on" : ""}
          role="radio" aria-checked={option === value} tabIndex={option === value ? 0 : -1} onClick={() => onChange(option)} onKeyDown={(e) => {
            let next: number | undefined;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = options.length - 1;
            if (next === undefined) return;
            e.preventDefault();
            move(next);
          }}>
          {preview}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function DensityPreview({ density }: { density: "comfortable" | "compact" }) {
  const count = density === "comfortable" ? 3 : 4;
  return (
    <span className={`appearance-preview density-preview ${density}`} aria-hidden>
      {Array.from({ length: count }, (_, index) => <span key={index}><i /><b /></span>)}
    </span>
  );
}

function ThemePreview({ theme }: { theme: "system" | "light" | "dark" }) {
  return (
    <span className={`appearance-preview theme-preview ${theme}`} aria-hidden>
      <span className="preview-rail" />
      <span className="preview-card"><i /><b /></span>
    </span>
  );
}

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
  const [editingReminderDays, setEditingReminderDays] = useState(false);
  const [draftReminderDays, setDraftReminderDays] = useState<number[]>([]);
  const [reminderDayError, setReminderDayError] = useState("");
  const reminderDayInput = useRef<HTMLInputElement>(null);
  const reminderDayEditButton = useRef<HTMLButtonElement>(null);
  const wasEditingReminderDays = useRef(false);
  const [showReminderMore, setShowReminderMore] = useState(false);
  const calendarSync = useCalendarAutoSyncController();
  useEffect(() => { if (pane === "backup") void store.refreshSnapshots(); }, [pane]);
  const p = platform();
  const root = store.folder.root;
  const s = sync.state;
  const cloud = s.kind !== "local";
  const finder = p.os === "windows" ? "在资源管理器中显示" : "在访达中显示";
  const settings = store.data.settings;
  const reminderTime = `${String(settings.notificationHour).padStart(2, "0")}:${String(settings.notificationMinute ?? 0).padStart(2, "0")}`;
  const addDay = () => {
    const result = addReminderDayValue(draftReminderDays, newDay);
    if (!result.ok) { setReminderDayError(result.message); return false; }
    setDraftReminderDays(result.days);
    setNewDay(""); setReminderDayError("");
    return true;
  };
  const closeReminderDaysEditor = () => {
    setEditingReminderDays(false);
    setDraftReminderDays([]);
    setNewDay("");
    setReminderDayError("");
  };
  useEffect(() => {
    if (editingReminderDays) reminderDayInput.current?.focus({ preventScroll: true });
    else if (wasEditingReminderDays.current) reminderDayEditButton.current?.focus({ preventScroll: true });
    wasEditingReminderDays.current = editingReminderDays;
  }, [editingReminderDays]);
  const chooseFolder = async () => {
    setConfirmFolder(false);
    const dir = await p.pickFolder({ title: "选择数据文件夹" });
    if (dir) await store.changeDataRoot(dir);
  };
  const counts = (x: DataSnapshot) => [x.companies != null ? `${x.companies} 家公司` : null, x.documents != null ? `${x.documents} 份文件` : null].filter(Boolean) as string[];
  const icsPath = p.join(root, `${safeName(settings.calendarName || "Charter")}.ics`);
  return (
    <Scroll>
      <PaneHeader title={settingsPaneTitle[pane]} detail={paneDetail[pane]} />
      {pane === "reminders" && <>
        <div className="col reminder-settings-559">
          <SGroup scope="reminder-main">
          <CalendarAutoSync view="toggle" controller={calendarSync} />
          <SRow title="提前天数" detail="到期前按所选天数提醒。申报事项在截止当天也会提醒。">
            {editingReminderDays ? <span className="reminder-days-editor-559" onKeyDownCapture={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault(); e.stopPropagation(); closeReminderDaysEditor();
            }}>
              <span className="reminder-days-controls-559">
              {draftReminderDays.map((d) => (
                <span key={d} className="v4-chip num">{d} 天{draftReminderDays.length > 1 &&
                  <button className="reminder-day-remove-559" aria-label={`移除 ${d} 天`} onClick={() => { setDraftReminderDays((days) => days.filter((day) => day !== d)); setReminderDayError(""); }}><Icon name="xmark" size={8} /></button>}</span>
              ))}
              <input ref={reminderDayInput} className="field num" inputMode="numeric" value={newDay} onChange={(e) => { setNewDay(e.target.value); setReminderDayError(""); }} onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addDay(); }
              }} placeholder="天数" aria-label="添加提醒天数" aria-invalid={!!reminderDayError} aria-describedby={reminderDayError ? "reminder-day-error-559" : undefined} style={{ width: 64, height: 34 }} />
              <Button size="small" onClick={closeReminderDaysEditor}>取消</Button>
              <Button size="small" kind="primary" onClick={() => {
                let next = draftReminderDays;
                if (newDay) {
                  const result = addReminderDayValue(draftReminderDays, newDay);
                  if (!result.ok) { setReminderDayError(result.message); reminderDayInput.current?.focus({ preventScroll: true }); return; }
                  next = result.days;
                }
                store.saveSettings((x) => { x.reminderDays = next; });
                closeReminderDaysEditor();
              }}>保存</Button>
              </span>
              {reminderDayError && <span id="reminder-day-error-559" className="reminder-day-error-559" role="alert">{reminderDayError}</span>}
            </span> : <>
              {[...settings.reminderDays].sort((a, b) => b - a).map((d) => <span key={d} className="v4-chip num">{d} 天</span>)}
              <Button buttonRef={reminderDayEditButton} size="small" onClick={() => { setDraftReminderDays([...settings.reminderDays].sort((a, b) => b - a)); setReminderDayError(""); setEditingReminderDays(true); }}>编辑</Button>
            </>}
          </SRow>
          <SRow title="提醒时间" detail="本地时间">
            <ReminderTimeField value={reminderTime} onChange={(time) => store.saveSettings((x) => {
              const [hour, minute] = time.split(":").map(Number);
              x.notificationHour = hour;
              x.notificationMinute = minute;
            })} />
          </SRow>
          {store.shared && <SRow title="由这台电脑发通知" detail={store.isPrimaryDevice ? "多台电脑共用数据时，只让一台负责，避免重复。" : `现在由“${settings.primaryDeviceName ?? "另一台电脑"}”负责。`}>
            <Switch ariaLabel="由这台电脑发通知" checked={store.isPrimaryDevice} onChange={(v) => store.saveSettings((x) => { if (v) { x.primaryDeviceID = store.deviceID; x.primaryDeviceName = store.deviceName; } else { x.primaryDeviceID = "none"; x.primaryDeviceName = undefined; } })} />
          </SRow>}
          </SGroup>
          <NextReminder />
          <CalendarAutoSync view="status" controller={calendarSync} />
          <div className="reminder-more-559">
            <Button kind="quiet" size="small" ariaExpanded={showReminderMore} ariaControls="reminder-more-options-559" onClick={() => setShowReminderMore((shown) => !shown)}>{showReminderMore ? "收起" : "更多"}<Icon name={showReminderMore ? "chevron.up" : "chevron.down"} size={11} /></Button>
          </div>
          {showReminderMore && <div id="reminder-more-options-559"><SGroup footer="这是给其他设备和不支持直接同步的日历应用使用的兼容方式。已开启系统日历同步时，这台电脑无需再订阅。">
          <SRow title="日历订阅文件（.ics）" detail="生成一份可订阅的日历文件。打开文件夹后，用你的日历应用订阅它。">
            <Button size="small" onClick={async () => {
              try {
                const path = await writeCalendarFile(store);
                await p.reveal(path);
                store.showToast("日历订阅文件已生成并显示。");
              } catch (error) {
                store.setError(`生成日历订阅文件失败：${error instanceof Error ? error.message : String(error)}。`);
              }
            }}>生成并显示</Button>
          </SRow>
          <SRow title="保持订阅文件更新" detail="事项新增、改期、完成或删除时，自动重写这份文件。">
            <Switch ariaLabel="保持订阅文件更新" checked={settings.calendarEnabled} onChange={(v) => store.saveSettings((x) => { x.calendarEnabled = v; })} />
          </SRow>
          {settings.calendarEnabled && <SRow title="文件位置" detail={<span className="mono selectable calendar-path-559">{icsPath}</span>}>
            <Button size="small" onClick={() => void p.reveal(icsPath).catch(() => void p.openPath(root))}>{finder}</Button>
            <Button size="small" onClick={() => { void p.copyText(icsPath); store.showToast("路径已复制。"); }}>复制路径</Button>
          </SRow>}
          </SGroup></div>}
        </div>
      </>}
      {pane === "backup" && <>
        {store.unsaved.size > 0 && <Note tone="warn" action={<Button size="small" onClick={() => void store.retrySave()}>重试保存</Button>}>
          有修改还没保存到数据文件夹（{store.unsavedLabels.join("、")}）。先重试保存，成功后才能导出备份或更换数据文件夹。</Note>}
        <SGroup>
          <SRow title="导出备份" detail="把公司、集团、人员、中介、事项和归档的 PDF 打包成一个 ZIP，可在另一台电脑上恢复。">
            <Button size="small" kind="primary" disabled={store.isLoading || store.loadFailed || backupBusy} onClick={async () => {
              const t = await p.saveDialog({ defaultName: `Charter 备份 ${store.today}.zip`, extensions: ["zip"], title: "导出备份" });
              if (!t) return;
              setBackupBusy(true);
              try { const i = await exportBackup(store, t); store.showToast(`备份已导出：${i.companies} 家公司、${i.groups} 个集团、${i.files} 个归档文件。`, () => void p.reveal(t), finder); }
              catch (e) { store.setError(`导出备份失败：${e instanceof Error ? e.message : String(e)}。`); }
              finally { setBackupBusy(false); }
            }}>{backupBusy ? "正在导出…" : "导出备份…"}</Button>
          </SRow>
          <SRow title="从备份恢复" detail="用备份替换当前全部档案。恢复前会先给当前状态做快照。">
            <Button size="small" disabled={store.isLoading || store.isImporting || backupBusy} onClick={async () => {
              const f = (await p.pickFiles({ multiple: false, extensions: ["zip"], title: "选择备份" }))[0];
              if (!f) return;
              try { setPendingBackup({ opened: await readBackup(f), fileName: f.split(/[\\/]/).pop()! }); } catch (e) { store.setError((e instanceof Error ? e.message : String(e))); }
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
              try { setPendingConfig({ bundle: await readConfig(f), fileName: f.split(/[\\/]/).pop()! }); } catch (e) { store.setError((e instanceof Error ? e.message : String(e))); }
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
          <SRow title="载入示例数据" detail="一套虚构的远澜、明岸集团数据。会替换当前档案，建议先换一个空文件夹。"><Button size="small" disabled={store.isLoading || store.isImporting || store.loadFailed} onClick={() => setConfirmSample(true)}>载入…</Button></SRow>
          <SRow title="清空所有数据" danger detail="移除公司、集团、人员、中介、文件和事项，设置与模板库保留。清空前自动保存快照。">
            <Button kind="danger" size="small" disabled={store.isLoading || store.isImporting || store.loadFailed} onClick={() => setConfirmClear(true)}>清空…</Button>
          </SRow>
        </SGroup>
      </>}
      {confirmFolder && <ConfirmSheet title="更换数据文件夹？" message="Charter 会改用新文件夹里的档案；当前文件夹的内容原样保留，不会移动或删除。" confirmTitle="选择文件夹…" onClose={() => setConfirmFolder(false)} onConfirm={() => void chooseFolder()} />}
      {confirmSample && <ConfirmSheet title="载入示例数据？" message="示例数据会替换当前档案。载入前会自动保存快照，可以恢复。" confirmTitle="载入" destructive onClose={() => setConfirmSample(false)} onConfirm={() => { setConfirmSample(false); void installSampleData(store, { requireSnapshot: true }); }} />}
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
  return <div className="col settings-split-wrap" style={{ gap: 20 }}>
    <PaneHeader title="集团" detail="结构图顶部的分组。删除集团只删除分组，公司和持股不受影响。"><Button kind="primary" icon="plus" onClick={create}>新建集团</Button></PaneHeader>
    <div className="group-settings-layout">
      <div className="s4-card scroll group-settings-list">
        {groups.map((g) => <ListItem key={g.id} mid={g.id} on={g.id === sel?.id} onClick={() => router.set("settingsGroupID", g.id)}
          lead={<span className="v4-code" style={{ width: 28, height: 28, ...groupRing(store.brandColor(g)) }}>{[...g.name.trim()][0] ?? "集"}</span>} title={g.name} sub={`${store.companyIDsIn(g).size} 家公司${g.color && isStatusLike(g.color) ? " · 颜色与状态色冲突，建议更换" : ""}`} />)}
        {!groups.length && <span className="muted t-meta" style={{ padding: 12 }}>还没有集团。</span>}
        {loose > 0 && <><div className="hairline" style={{ margin: "6px 8px" }} /><span className="row gap8 t-meta muted" style={{ padding: "10px 12px" }}><span className="v4-dot" style={{ boxShadow: "inset 0 0 0 1.5px var(--muted)" }} />不属于任何集团 · {loose} 家</span></>}
      </div>
      {sel ? <GroupDetail key={sel.id} g={sel} /> : <div className="group-settings-empty"><EmptyStateView symbol="square.stack.3d.up" title="还没有集团" message="新建一个集团，选它最上层的公司，成员会按持股自动算出。" actionTitle="新建集团" action={create} /></div>}
    </div>
  </div>;
}

/** 12 个预设色 + 自定义（系统取色器，松手才保存一次）。红、橙、黄、绿留给状态：自定义时不接受，保留原色并说明。 */
function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => {
    const el = input.current; if (!el) return;
    const done = () => {
      setPreview(null);
      if (!isHexColor(el.value) || el.value.toLowerCase() === value.toLowerCase()) return;
      if (isStatusLike(el.value)) { setRejected(el.value.toUpperCase()); el.value = value; return; }
      setRejected(null); onPick(el.value.toUpperCase());
    };
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, [value, onPick]);
  const shown = preview ?? value;
  const custom = !brandPalette.some((c) => c.toLowerCase() === shown.toLowerCase());
  const dot = (c: string, on: boolean) => ({ width: 20, height: 20, borderRadius: "50%", background: c, flex: "none" as const,
    boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px var(--ink)" : undefined, transition: "box-shadow var(--fast) var(--ease)" });
  return (
    <span className="col gap8" style={{ alignItems: "flex-end" }}>
      <span style={{ display: "grid", gridTemplateColumns: "repeat(6, 20px)", gap: 8 }}>
        {brandPalette.map((c) => <button key={c} aria-label={`颜色 ${c}`} aria-pressed={c.toLowerCase() === shown.toLowerCase()} onClick={() => onPick(c)} style={dot(c, c.toLowerCase() === shown.toLowerCase())} />)}
      </span>
      <label className="row gap6 t-meta" style={{ cursor: "pointer", color: "var(--muted)" }}>
        <span style={{ ...dot(custom ? shown : "conic-gradient(#4F7CF7, #3AA0C9, #178F9F, #5C6B80, #8A6D4E, #8E4E8A, #B05CD6, #7A5AF0, #4F7CF7)", custom), position: "relative" }}>
          <input ref={input} type="color" value={shown} aria-label="自定义颜色" onInput={(e) => setPreview((e.target as HTMLInputElement).value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%", border: 0, padding: 0 }} />
        </span>
        {custom ? <span className="mono" style={{ color: "var(--ink)" }}>{shown.toUpperCase()}</span> : "自定义…"}
      </label>
      {preview && isStatusLike(preview) ? <span className="t-meta amber-text" role="status" style={{ maxWidth: 280, textAlign: "right" }}>红、橙、黄、绿用来表示过期、快到期和正常，不能用作集团色。松开后会保留原来的颜色。</span>
        : rejected ? <span className="t-meta muted" role="status" style={{ maxWidth: 280, textAlign: "right" }}>{rejected} 属于状态色，没有采用，仍是 {value.toUpperCase()}。请换蓝、紫、青、灰或棕色系。</span>
        : !preview && isStatusLike(value) ? <span className="t-meta amber-text" style={{ maxWidth: 280, textAlign: "right" }}>当前颜色 {value.toUpperCase()} 和状态色（过期、快到期、正常）相近，容易被误读成风险，建议换一个。</span> : null}
    </span>
  );
}

function GroupDetail({ g }: { g: CorporateGroup }) {
  const { store, router } = useApp();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<"top" | "member" | null>(null);
  const members = useChildMotion<HTMLDivElement>(g.id);
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
  return <div className="group-detail-contents">
    <div className="group-detail-main">
      <div className="s4-card group-detail-profile">
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>名称</span>}>
          <InlineText value={g.name} label="集团名称" onCommit={(v) => v.trim() && save((x) => { x.name = v.trim(); }, "重命名集团")} style={{ fontWeight: 700, textAlign: "right", width: 220 }} />
        </SRow>
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>颜色</span>}>
          <ColorPicker value={store.brandColor(g)} onPick={(c) => save((x) => { x.color = c; }, "更改集团颜色")} />
        </SRow>
        <SRow title={<span className="muted" style={{ fontWeight: 500, fontSize: 13 }} title="从这里沿持股往下，自动算出成员">顶层</span>}>
          <span className="row gap6 wrap" style={{ justifyContent: "flex-end", maxWidth: 380 }}>
            {g.tops.map((t) => (
              <span key={refKey(t)} className="v4-chip jchip" style={{ maxWidth: 320 }}>{t.kind === "company" ? <span className="v4-code" style={companyTint(store, t.id)} aria-hidden>{store.company(t.id)?.jurisdiction}</span> : <Avatar name={store.nameOf(t)} size={20} />}<span className="ellipsis">{store.nameOf(t)}</span>
                <button aria-label={`移除顶层 ${store.nameOf(t)}`} onClick={() => save((x) => { x.tops = x.tops.filter((y) => refKey(y) !== refKey(t)); }, "移除集团顶层")}><Icon name="xmark" size={8} /></button></span>
            ))}
            <button className="link t-meta" style={{ whiteSpace: "nowrap" }} onClick={() => { setPick(pick === "top" ? null : "top"); setQ(""); }}>+ 添加</button>
          </span>
        </SRow>
      </div>
      {pick && (
        <div className="s4-card group-detail-picker" style={{ padding: 8 }}>
          <input className="field" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={pick === "top" ? "选公司或人做顶层…" : "选要加入的公司…"} aria-label="搜索" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setPick(null); } }} />
          <div className="col" style={{ marginTop: 6 }}>
            {options.map((o) => <button key={refKey(o.r)} className="v4-opt" onClick={() => choose(o.r)}><span className="v4-code" style={o.r.kind === "person" ? { borderRadius: "50%" } : undefined}>{o.code}</span><span className="grow ellipsis">{o.name}</span></button>)}
            {!options.length && <span className="t-meta muted" style={{ padding: 10 }}>没有可选的。</span>}
          </div>
        </div>
      )}
      <div ref={members} className="s4-card group-detail-members" style={{ position: "relative" }}>
        <SRow title="成员" detail={`${rows.length} 家公司`}><button className="link t-meta" onClick={() => { setPick(pick === "member" ? null : "member"); setQ(""); }}>+ 手动加入公司</button></SRow>
        <div className="group-detail-member-rows scroll">
          {rows.map((r) => {
            const c = store.company(r.companyID);
            if (!c) return null;
            const m = store.membership(c.id, g);
            return (
              <div key={c.id} data-mid={c.id} className="s4-row" style={{ minHeight: 50 }}>
                <span className="v4-code" style={companyTint(store, c.id)}>{c.jurisdiction}</span>
                <span className="grow ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                <span className="t-meta muted">{sourceLabel(m)}</span>
                {m.kind !== "top" && <button className="link t-meta" onClick={() => { let msg = ""; const u = store.undoable("移出集团", () => { msg = store.moveOut(c.id, g.id); }); store.showToast(msg || `已把 ${c.name} 移出 ${g.name}。`, u ? () => store.undoID(u) : undefined); }}>移出</button>}
              </div>
            );
          })}
          {!rows.length && <div className="s4-row t-meta muted">先添加顶层，成员会按持股自动算出。</div>}
        </div>
      </div>
      {excluded.length > 0 && <div className="s4-card group-detail-excluded scroll">
        <SRow title="已移出" detail="按持股本属于这个集团，你把它们移出了。" />
        {excluded.map((c) => <div key={c!.id} className="s4-row" style={{ minHeight: 46 }}><span className="v4-code">{c!.jurisdiction}</span><span className="grow ellipsis">{c!.name}</span><button className="link t-meta" onClick={() => store.restoreToGroup(c!.id, g.id)}>恢复</button></div>)}
      </div>}
    </div>
      <div className="row group-detail-footer" style={{ padding: "0 4px", justifyContent: "space-between", gap: 16 }}>
        <span className="t-meta muted">成员从顶层沿持股自动算出。共用的上层控股公司画在集团上方，不算成员。</span>
        <button className="t-meta" style={{ color: "var(--danger)", fontWeight: 600, whiteSpace: "nowrap" }} onClick={remove}>删除集团</button>
      </div>
    </div>;
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

function SearchMultiSelect({ label, options, values, onChange, emptyLabel = "全部" }: {
  label: string; options: [string, string][]; values: string[]; onChange: (values: string[]) => void; emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const selected = new Set(values);
  const optionValues = new Set(options.map(([value]) => value));
  const allOptions: [string, string][] = [...options, ...values.filter((value) => !optionValues.has(value)).map((value) => [value, `${value}（旧值）`] as [string, string])];
  const q = query.trim().toLowerCase();
  const shown = q ? allOptions.filter(([value, name]) => `${value} ${name}`.toLowerCase().includes(q)) : allOptions;
  const toggle = (value: string) => {
    const next = new Set(values);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(allOptions.map(([v]) => v).filter((v) => next.has(v)));
  };
  return <span className="multi-select-557">
    <button ref={anchor} className={`select ${open ? "open" : ""}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className="multi-select-value grow">
        {!values.length ? <span className="muted">{emptyLabel}</span> : values.slice(0, 3).map((v) => <span key={v} className="v4-chip">{allOptions.find(([x]) => x === v)?.[1] ?? v}</span>)}
        {values.length > 3 && <span className="t-meta muted">另 {values.length - 3} 项</span>}
      </span>
      <Icon name="chevron.up.chevron.down" size={11} className="muted" />
    </button>
    <Popover anchor={anchor} open={open} onClose={() => { setOpen(false); setQuery(""); }} minWidth={320}>
      <div className="col gap6">
        {allOptions.length > 6 && <label className="search sel-search"><Icon name="magnifyingglass" size={13} /><input className="field" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`搜索${label}`} /></label>}
        <div className="col sel-list" role="listbox" aria-label={label}>
          {shown.map(([value, name]) => <div key={value} className={`sel-opt ${selected.has(value) ? "on" : ""}`} role="option" aria-selected={selected.has(value)}>
            <Checkbox checked={selected.has(value)} onChange={() => toggle(value)} ariaLabel={`${selected.has(value) ? "取消" : "选择"}${name}`}>
              <span className="col grow" style={{ minWidth: 0 }}><span>{name}</span>{name !== value && <span className="t-meta muted">{value}</span>}</span>
            </Checkbox>
          </div>)}
          {!shown.length && <span className="t-meta muted" style={{ padding: "10px 12px" }}>没有匹配“{query.trim()}”的选项</span>}
        </div>
      </div>
    </Popover>
  </span>;
}

function DocumentTypeForm({ type, onChange }: { type: DocumentType; onChange: (t: DocumentType) => void }) {
  const { store } = useApp();
  const set = (patch: Partial<DocumentType>) => onChange({ ...type, ...patch });
  const months = [...new Set([1, 3, 6, 12, 24, 36, type.validityMonths ?? 6])].sort((a, b) => a - b);
  const jurisdictionOptions = store.data.library.jurisdictions.map((j) => [j.code, `${j.name}（${j.code}）`] as [string, string]);
  const selectedJurisdictions = type.jurisdictions.length ? type.jurisdictions : store.data.library.jurisdictions.map((j) => j.code);
  const formOptions = [...new Set(store.data.library.jurisdictions.filter((j) => selectedJurisdictions.includes(j.code)).flatMap((j) => j.entityForms))].sort().map((f) => [f, f] as [string, string]);
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
      </FormGroup>
      <FormGroup title="适用范围" canvas>
        <FieldRow label="适用法域" hint="留空表示所有法域。"><SearchMultiSelect label="适用法域" options={jurisdictionOptions} values={type.jurisdictions} onChange={(jurisdictions) => set({ jurisdictions })} emptyLabel="所有法域" /></FieldRow>
        {type.owner === "company" && formOptions.length > 0 && <FieldRow label="适用公司类型" hint="留空表示所选法域里的所有公司类型。"><SearchMultiSelect label="适用公司类型" options={formOptions} values={type.entityForms ?? []} onChange={(entityForms) => set({ entityForms: entityForms.length ? entityForms : undefined })} emptyLabel="全部公司类型" /></FieldRow>}
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
      header={<PaneHeader title="档案清单" detail="每个法域的公司默认管理哪些文件。新建公司时自动套用，之后可以逐家调整。"><span className="settings-header-actions"><Button kind="primary" icon="plus" onClick={() => setAddingJ(true)}>新建法域</Button><Button kind="primary" icon="plus" onClick={() => setCreatingIn(code)}>新建条目</Button></span></PaneHeader>}
      list={<>
        {lib.jurisdictions.map((j) => {
          const n = store.data.companies.filter((c) => c.jurisdiction === j.code).length;
          return <ListItem key={j.code} mid={j.code} on={code === j.code} onClick={() => setCode(j.code)} lead={<span className="v4-code">{j.code}</span>} title={j.name}
            sub={`${store.templateItems(j.code).length} 个条目 · ${n ? `${n} 家公司` : "暂无公司"}${lib.archiveItems?.[j.code] ? " · 已调整" : ""}`} />;
        })}
        <ListItem on={person} onClick={() => setCode(personScope)} lead={<span className="v4-code" style={{ borderRadius: "50%" }}>人</span>} title="人员文件" sub={`${personTypes.length} 个条目`} />
      </>}
      detail={<>
        <SGroup scope={code} footer={person ? "护照、身份证等挂在人名下的文件。" : "内置条目是管理用的起始清单，不代表已核验的法定要求。"}>
          <SRow title={name} detail={person ? "挂在人名下的文件。" : `${name}公司默认管理这些文件。`}>
            {!person && lib.archiveItems?.[code] && <Button size="small" kind="quiet" onClick={() => store.saveLibrary((l) => { if (l.archiveItems) delete l.archiveItems[code]; })}>恢复内置</Button>}
          </SRow>
          {!ids.length && <SRow title={<span className="muted" style={{ fontWeight: 400 }}>还没有条目。</span>} />}
          {ids.map((id, i) => {
            const t = store.docType(id);
            return (
              <div key={id} data-mid={id} className="s4-row item-row" style={{ minHeight: 56, cursor: "default" }} onDoubleClick={() => setEditing(id)}>
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
  const [draft, setDraft] = useState<DocumentType | null>(() => t ? structuredClone(t) : null);
  if (!t) return null;
  if (!draft) return null;
  const save = () => {
    store.saveLibrary((l) => { const i = l.documentTypes.findIndex((x) => x.id === draft.id); if (i >= 0) l.documentTypes[i] = draft as any; });
    onClose();
  };
  const used = store.data.documents.filter((d) => d.typeID === t.id).length;
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={draft.name || "未命名条目"} subtitle={used ? `已有 ${used} 份文件使用这个类型` : "还没有文件使用这个类型"} width={680}
        leading={!t.builtIn && <Button kind="quiet" disabled={used > 0} title={used ? "仍有文件使用这个类型" : "从所有法域删除这个类型"} onClick={() => { onClose(); onDelete(t.id); }}>删除类型</Button>}
        trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" onClick={save}>保存</Button></>}>
        <div className="col" style={{ gap: 18 }}>
          <DocumentTypeForm type={draft} onChange={setDraft} />
          <FormGroup title="签署">
            <Switch checked={!!draft.requiresSignature} onChange={(v) => setDraft({ ...draft, requiresSignature: v || undefined })}>这类文件需要签署（决议、会议记录、转让文书等）</Switch>
            <span className="t-meta muted">打开后，这类文件会显示“已签署 / 待签署”，可在文件详情里填签署日期。</span>
          </FormGroup>
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
  const matchesSearch = (r: RuleTemplate) => !ql || (r.name + r.localName).toLowerCase().includes(ql);
  const knownCodes = new Set(lib.jurisdictions.map((j) => j.code));
  const legacyCodes = [...new Set(rules.flatMap((r) => r.jurisdictions).filter((code) => !knownCodes.has(code)))];
  const byJ = [
    ...lib.jurisdictions.map((j) => ({ j, list: rules.filter((r) => r.jurisdictions.includes(j.code) && matchesSearch(r)) })),
    ...legacyCodes.map((code) => ({ j: { code, name: `旧法域 ${code}` }, list: rules.filter((r) => r.jurisdictions.includes(code) && matchesSearch(r)) })),
    { j: { code: "__none", name: "未指定法域" }, list: rules.filter((r) => !r.jurisdictions.length && matchesSearch(r)) },
  ].filter((x) => x.list.length);
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
      scope={q}
      list={<>
        <input className="field rule-search-557" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索规则" aria-label="搜索规则" style={{ height: 34, marginBottom: 4 }} />
        {byJ.map(({ j, list }) => (
          <div key={j.code} className="col" style={{ gap: 1 }}>
            <span className="v4-label" style={{ padding: "10px 10px 4px" }}>{j.name}</span>
            {list.map((r) => <ListItem key={r.id} mid={r.id} on={r.id === selection} onClick={() => setSelection(r.id)} title={<span style={{ color: r.enabled || r.id === selection ? undefined : "var(--muted)" }}>{r.name || "未命名规则"}</span>}
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
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">(() => store.ruleSaveFailed(rule.id) ? "failed" : "saved");
  const [retry, setRetry] = useState(0);
  const latest = useRef(r);
  latest.current = r;
  // RuleForm is keyed by rule ID, so switching rules remounts it. Do not reset a
  // live draft merely because an unrelated store update produced a new object.
  useEffect(() => () => {
    if (store.ruleDraftChanged(latest.current)) void store.saveRuleAndWait(latest.current);
  }, [rule.id]);
  useEffect(() => {
    const same = !store.ruleDraftChanged(r);
    const failed = store.ruleSaveFailed(rule.id);
    if (same && !failed) { setSaveState("saved"); return; }
    if (same && failed && retry === 0) { setSaveState("failed"); return; }
    let live = true;
    setSaveState("saving");
    const timer = setTimeout(() => {
      void store.saveRuleAndWait(r, failed || retry > 0).then((saved) => { if (live) setSaveState(saved ? "saved" : "failed"); });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [r, retry]);
  const set = (patch: Partial<RuleTemplate>) => setR((x) => ({ ...x, ...patch }));
  const jurisdictionOptions = store.data.library.jurisdictions.map((j) => [j.code, `${j.name}（${j.code}）`] as [string, string]);
  const selectedJurisdictions = r.jurisdictions.length ? r.jurisdictions : store.data.library.jurisdictions.map((j) => j.code);
  const formOptions = [...new Set(store.data.library.jurisdictions.filter((j) => selectedJurisdictions.includes(j.code)).flatMap((j) => j.entityForms))].sort().map((f) => [f, f] as [string, string]);
  const n = store.data.companies.filter((c) => r.enabled && r.jurisdictions.includes(c.jurisdiction) && (!r.entityForms.length || r.entityForms.includes(c.entityForm)) && !c.disabledRuleIDs.includes(r.id)).length;
  const stateText = saveState === "saving" ? "正在保存…" : saveState === "failed" ? "保存失败" : "已自动保存";
  return (
    <div className="col rule-form-557" style={{ gap: 14 }}>
      <div className="s4-card">
        <SRow title={<InlineText value={r.name} label="规则名称" onCommit={(name) => set({ name })} style={{ fontSize: 19, fontWeight: 700 }} />} detail={`${store.scheduleText(r.schedule)} · 适用 ${n} 家公司`}>
          <span className={`t-meta rule-save-state ${saveState === "failed" ? "red-text" : "muted"}`} role="status">{stateText}</span>
          {saveState === "failed" && <Button size="small" onClick={() => setRetry((x) => x + 1)}>重试</Button>}
          <Switch checked={r.enabled} onChange={(enabled) => set({ enabled })}>启用</Switch>
        </SRow>
      </div>
      <FormGroup title="截止日计算" canvas>
        <ScheduleEditor schedule={r.schedule} onChange={(schedule) => set({ schedule })} />
        <FieldRow label="遇周末"><SelectField options={(Object.keys(dateAdjustLabel) as DateAdjust[]).map((k) => [k, dateAdjustLabel[k]] as [DateAdjust, string])} value={r.adjust} onChange={(adjust) => set({ adjust })} minWidth={220} /></FieldRow>
      </FormGroup>
      <FormGroup title="适用范围" canvas>
        <FieldRow label="法域" hint="选择这条规则适用的法域。"><SearchMultiSelect label="法域" options={jurisdictionOptions} values={r.jurisdictions} onChange={(jurisdictions) => set({ jurisdictions })} emptyLabel="请选择法域" /></FieldRow>
        <FieldRow label="公司类型" hint="留空则适用于所选法域里的全部公司类型。"><SearchMultiSelect label="公司类型" options={formOptions} values={r.entityForms} onChange={(entityForms) => set({ entityForms })} emptyLabel="全部公司类型" /></FieldRow>
        {n === 0 && <span className="t-meta muted" style={{ padding: "0 14px 12px" }}>当前条件没有匹配的公司。</span>}
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

// MARK: - 材料范围（5.3）

function ScopeSettings() {
  const { store, router } = useApp();
  const presets = store.data.settings.scopePresets ?? [];
  const companies = store.data.companies.filter((c) => c.status !== "dissolved" && c.status !== "redomiciled");
  const unconf = companies.filter((c) => !store.scopeConfigured(ref("company", c.id)));
  const unconfP = store.data.people.filter((p) => !store.scopeConfigured(ref("person", p.id)));
  return (
    <Scroll>
      <PaneHeader title="材料范围" detail="Charter 只按“由你保管”的材料算完整度。法域清单只是建议，出现在完整性审阅里。" />
      <SGroup footer="没设置过范围的公司和人员显示“未配置材料范围”，不显示百分比。">
        <SRow title="公司" detail={`${companies.length - unconf.length}/${companies.length} 家已配置`}>
          {unconf.length > 0 && <Button size="small" onClick={() => router.open({ kind: "scope", ownerKind: "company", owners: unconf.map((c) => c.id) })}>配置未配置的 {unconf.length} 家…</Button>}
          <Button size="small" onClick={() => router.open({ kind: "scope", ownerKind: "company" })}>批量设置…</Button>
        </SRow>
        <SRow title="人员" detail={`${store.data.people.length - unconfP.length}/${store.data.people.length} 人已配置`}>
          {unconfP.length > 0 && <Button size="small" onClick={() => router.open({ kind: "scope", ownerKind: "person", owners: unconfP.map((p) => p.id) })}>配置未配置的 {unconfP.length} 人…</Button>}
          <Button size="small" onClick={() => router.open({ kind: "scope", ownerKind: "person" })}>批量设置…</Button>
        </SRow>
      </SGroup>
      <SGroup footer="在“设置材料范围”面板里把一组设置存成方案，之后可以一键套用到新公司或新人员。">
        {!presets.length && <SRow title="还没有保存过方案" />}
        {presets.map((p) => (
          <SRow key={p.id} title={p.name} detail={`${p.kind === "company" ? "公司" : "人员"} · ${Object.keys(p.plan).length} 个条目`}>
            <Button size="small" kind="danger" onClick={() => store.saveSettings((s) => { s.scopePresets = (s.scopePresets ?? []).filter((x) => x.id !== p.id); })}>删除</Button>
          </SRow>
        ))}
      </SGroup>
    </Scroll>
  );
}

function PrivacySettings() {
  const rows: [string, string][] = [
    ["文字识别（OCR）", "在这台电脑上完成：Mac 用系统自带的文字识别，Windows 用系统自带的 OCR。不联网，不上传。"],
    ["分类建议与去重", "按本机的关键词规则和文件内容哈希（SHA-256）判断，不调用任何在线服务。"],
    ["识别结果存在哪里", "只存在你的数据文件夹里（data/inbox.json 保存前 600 个字的摘录）。归档后摘录随待整理条目一起清除。"],
    ["文件副本", "归档时 Charter 把文件复制进数据文件夹；移到废纸篓或清空，都只作用于这份副本，不碰你原来的文件。"],
    ["同步", "Charter 不运营服务器。数据文件夹放在 iCloud 云盘或 OneDrive 时，由它们负责同步。"],
    ["检查更新", "唯一会主动联网的功能：只读取最新版本号和发布说明，不上传任何档案数据。可在“关于与更新”里关闭自动检查。"],
  ];
  return (
    <Scroll>
      <PaneHeader title="隐私与本地处理" detail="人员材料里有护照、身份证件和 KYC。下面说明 Charter 怎么处理它们。" />
      <SGroup>{rows.map(([t, d]) => <SRow key={t} title={t} detail={d} />)}</SGroup>
      <span className="t-meta muted" style={{ padding: "0 4px" }}>加密存储、敏感文件标记、缩略图遮罩和导出脱敏在后续版本单独评估。</span>
    </Scroll>
  );
}

// MARK: - 5.5.9 到期提醒与系统日历

function NextReminder() {
  const { store, router } = useApp();
  const settings = store.data.settings;
  const now = new Date();
  const todayMinutes = store.today === D.today() ? now.getHours() * 60 + now.getMinutes() : -1;
  const reminderMinutes = settings.notificationHour * 60 + (settings.notificationMinute ?? 0);
  const next = store.openObligations
    .flatMap((obligation) => reminderDays(obligation, settings).map((day) => ({
      obligation,
      day,
      before: D.daysBetween(day, obligation.due),
    })))
    .filter((candidate) => candidate.day > store.today || (candidate.day === store.today && reminderMinutes >= todayMinutes))
    .sort((a, b) => a.day.localeCompare(b.day) || a.obligation.due.localeCompare(b.obligation.due))[0];
  const time = `${String(settings.notificationHour).padStart(2, "0")}:${String(settings.notificationMinute ?? 0).padStart(2, "0")}`;
  const enabled = remindersEnabled();
  return (
    <section className={`s4-card next-reminder-559 ${enabled && next ? "has-reminder" : "empty"}`} aria-label="下次申报提醒">
      <div className="next-reminder-copy-559">
        <span className="t-label">下次申报提醒</span>
        {!enabled ? <>
          <span className="next-reminder-time-559">开启后，这里会显示下一次通知时间。</span>
        </> : next ? <>
          <strong className="next-reminder-item-559">{next.obligation.rule.name} · {next.obligation.company.name}</strong>
          <dl className="next-reminder-dates">
            <div>
              <dt className="t-meta muted">通知时间{next.before ? `（提前 ${next.before} 天）` : "（截止当天）"}</dt>
              <dd><time dateTime={`${next.day}T${time}`}>{D.long(next.day)} {time}</time></dd>
            </div>
            <div>
              <dt className="t-meta muted">申报截止日</dt>
              <dd><time dateTime={next.obligation.due}>{D.long(next.obligation.due)}</time></dd>
            </div>
          </dl>
        </> : <>
          <span className="next-reminder-time-559">当前没有安排新的申报提醒。</span>
        </>}
      </div>
      {enabled && next && <Button size="small" onClick={() => router.openDue(next.obligation.key)}>查看事项</Button>}
    </section>
  );
}

function useCalendarAutoSyncController() {
  const { store } = useApp();
  const p = platform();
  const [permissionOpen, setPermissionOpen] = useState(false);
  const st = autoSyncStatus();
  const name = store.data.settings.calendarName || "Charter";
  const mac = p.os === "mac";
  const calendarTitle = mac ? "Apple 日历" : "经典 Outlook 日历";
  const supported = autoSyncSupported();
  const calendarOn = autoSyncOn();
  const on = remindersEnabled();
  const phase = store.calendarAction?.phase;
  const busy = !!phase;
  const connectionIssue = store.calendarConnectionIssue;
  const retryClear = calendarOn && st?.ok === false && st.clearing;
  const failed = !busy && (!!connectionIssue || (calendarOn && st?.ok === false));
  const progressText = phase === "authorizing" ? (mac ? "等待日历授权" : "正在连接 Outlook")
    : phase === "checking" ? "正在检查权限" : phase === "syncing" ? "正在同步日历" : phase === "clearing" ? "正在移除已同步事项" : "";
  const statusText = progressText || (!on ? "未开启" : failed ? "需要处理" : "已开启");
  const statusKind: "neutral" | "warn" | "valid" = busy || !on ? "neutral" : failed ? "warn" : "valid";

  // 设置页可在授权期间关闭。将当前操作挂在 store 上，重新进入仍可看到或取消同一次连接。
  const begin = (initial: NonNullable<typeof store.calendarAction>["phase"]) => {
    if (store.calendarAction || !store.isPrimaryDevice) return null;
    const action = { phase: initial };
    store.calendarAction = action;
    store.calendarConnectionIssue = null;
    store.emit();
    return action;
  };
  const finish = (action: NonNullable<typeof store.calendarAction>) => {
    if (store.calendarAction === action) { store.calendarAction = null; store.emit(); }
  };
  const cancelConnection = () => {
    if (store.calendarAction?.phase === "authorizing" || store.calendarAction?.phase === "checking") {
      store.calendarAction = null;
      store.emit();
    }
  };

  const removeAndDisable = async () => {
    const result = await disableCalendarSync(store);
    if (!remindersEnabled()) {
      store.showToast(result?.ok ? "已关闭到期提醒，并从 Charter 日历移除已同步事项。" : "已关闭到期提醒。");
    }
  };
  const disable = async () => {
    const action = begin("clearing");
    if (!action) return;
    try { await removeAndDisable(); } finally { finish(action); }
  };

  const enableLocalOnly = (message: string) => {
    setRemindersEnabled(true);
    store.emit();
    store.showToast(message);
  };

  const allowSystemCalendar = async (requestAccess = true) => {
    setPermissionOpen(false);
    const action = begin(requestAccess ? "authorizing" : "checking");
    if (!action) return;
    try {
      const checked = await runCalendarSync(store, { checkOnly: true, requestAccess });
      if (store.calendarAction !== action || !store.isPrimaryDevice) return;
      if (!checked?.ok) {
        if (checked?.error === "noOutlook") {
          enableLocalOnly("已开启 Charter 运行期间的提醒；未连接经典 Outlook，退出后不会提醒。");
        } else {
          store.calendarConnectionIssue = checked ?? { error: "unsupported" };
        }
        return;
      }
      if (retryClear) {
        action.phase = "clearing";
        store.emit();
        await removeAndDisable();
        return;
      }
      action.phase = "syncing";
      store.emit();
      const synced = await runCalendarSync(store, { manual: true });
      if (synced?.ok) {
        p.prefSet(autoSyncPref, "1");
        setRemindersEnabled(true);
        store.showToast(`已开启：事项会同步到“${name}”日历（新增 ${synced.added ?? 0} 件）。`);
      } else {
        store.calendarConnectionIssue = synced ?? { error: "unsupported" };
      }
    } finally { finish(action); }
  };

  const syncNow = async () => {
    const action = begin("syncing");
    if (!action) return;
    try {
      const result = await runCalendarSync(store, { manual: true });
      if (result?.ok) store.showToast(`已同步：新增 ${result.added ?? 0}、更新 ${result.updated ?? 0}、删除 ${result.removed ?? 0}。`);
    } finally { finish(action); }
  };

  const permissionPrompt = permissionOpen && <Modal onClose={() => setPermissionOpen(false)}>
    <SheetScaffold title={mac ? "日历完全访问" : "连接经典 Outlook"} width={560}
      subtitle="让 Charter 在专用日历中添加事项和提醒，改期时一起更新。"
      onCloseButton={() => setPermissionOpen(false)}
      trailing={<div className="permission-actions-559">
        <Button onClick={() => setPermissionOpen(false)}>暂不允许</Button>
        <Button kind="primary" autoFocus onClick={() => void allowSystemCalendar()}>{mac ? "允许完全访问" : "连接 Outlook"}</Button>
      </div>}>
      <div className="permission-explainer-559">
        <span className="permission-icon-559"><Icon name="calendar" size={20} /></span>
        <div className="col gap6">
          <strong>{mac ? "在 Apple 日历中建立“Charter”日历" : "在经典 Outlook 中建立“Charter”日历"}</strong>
          <span className="t-meta muted">Charter 只管理自己写入的事项。关闭到期提醒时，会先移除这些事项；你的其他日历和日程不受影响。</span>
        </div>
      </div>
    </SheetScaffold>
  </Modal>;

  const issueCode = connectionIssue?.error ?? (calendarOn && !st?.ok ? st?.error : undefined);
  const inspect = mac && (issueCode === "permissionPending" || issueCode === "denied" || issueCode === "restricted" || issueCode === "writeOnly");
  const askPermission = mac && (issueCode === "notDetermined" || issueCode === "permissionFailed");
  const title = progressText || (failed ? (retryClear ? "未能移除已同步事项" : calendarOn ? "日历同步需要处理" : `${calendarTitle} 未连接`)
    : !on ? "系统日历未连接" : !supported ? "仅在 Charter 运行时提醒" : calendarOn ? "日历同步已开启" : `${calendarTitle} 未连接`);
  const detail = phase === "authorizing" ? (mac ? "请在 macOS 的权限提示中选择是否允许日历完全访问。" : "正在检查这台电脑上的经典 Outlook。")
    : phase === "checking" ? "正在读取 macOS 当前的日历访问权限。"
    : phase === "syncing" ? `正在将申报事项和文件到期提醒写入“${name}”日历。`
    : phase === "clearing" ? `正在从“${name}”日历移除 Charter 写入的事项。`
    : connectionIssue ? describeError(connectionIssue) : failed ? st!.message
    : !on ? "开启到期提醒后，可以连接系统日历。" : !supported ? "当前环境不能连接系统日历；退出 Charter 后不会提醒。"
    : calendarOn && st ? `${new Date(st.at).toLocaleString()} · ${st.message}` : calendarOn ? `事项会同步到“${name}”日历。` : "连接后，退出 Charter 也会提醒。";
  const actionText = inspect ? "检查权限" : askPermission ? "允许完全访问" : failed ? "重试" : calendarOn ? "立即同步" : mac ? "允许完全访问" : "连接 Outlook";
  const statusAction = () => {
    if (inspect) void allowSystemCalendar(false);
    else if (askPermission || (!calendarOn && !failed)) setPermissionOpen(true);
    else if (retryClear) void disable();
    else if (calendarOn) void syncNow();
    else void allowSystemCalendar(false);
  };
  return { busy, on, supported, calendarOn, mac, failed, title, detail, statusText, statusKind, permissionPrompt,
    primary: store.isPrimaryDevice, primaryName: store.data.settings.primaryDeviceName, actionText, statusAction,
    canCancel: phase === "authorizing" || phase === "checking", cancelConnection,
    openPermission: () => setPermissionOpen(true), disable, enableLocalOnly };
}

type CalendarAutoSyncController = ReturnType<typeof useCalendarAutoSyncController>;

function CalendarAutoSync({ view, controller }: { view: "toggle" | "status"; controller: CalendarAutoSyncController }) {
  if (view === "toggle") return <SRow title={<span className="reminder-status-559"><span>开启到期提醒</span><Pill text={controller.statusText} kind={controller.statusKind} /></span>}
    detail={controller.busy ? controller.detail : !controller.primary ? `这台电脑不负责提醒；现在由“${controller.primaryName ?? "另一台电脑"}”负责。` : controller.calendarOn && controller.supported ? (controller.mac ? "退出 Charter 后，由 Apple 日历提醒。" : "退出 Charter 后，由经典 Outlook 日历提醒。") : "开启后，Charter 运行时会按设置提醒。"}>
    <Switch ariaLabel="开启到期提醒" checked={controller.on} disabled={controller.busy || !controller.primary} onChange={(enabled) => {
      if (!enabled) { void controller.disable(); return; }
      if (controller.supported) { controller.openPermission(); return; }
      controller.enableLocalOnly("已开启 Charter 运行期间的提醒；当前环境无法连接系统日历。");
    }} />
  </SRow>;

  return <>
    <section className={`s4-card calendar-status-559 ${controller.failed ? "warn" : ""}`} aria-label="系统日历状态">
      <span className="calendar-status-icon-559"><Icon name="calendar" size={17} /></span>
      <span className="calendar-status-copy-559" role="status"><strong>{controller.title}</strong><span className="t-meta muted">{controller.detail}</span></span>
      {controller.canCancel ? <Button size="small" onClick={controller.cancelConnection}>取消连接</Button>
        : !controller.busy && controller.primary && (controller.on || controller.failed) && controller.supported &&
          <Button size="small" onClick={controller.statusAction}>{controller.actionText}</Button>}
    </section>
    {controller.permissionPrompt}
  </>;
}
