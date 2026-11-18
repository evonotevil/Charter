// 5.5.6 多台电脑共用：开关按数据文件夹是否在 iCloud 云盘 / OneDrive 推算，不单独保存。
// 关闭 = 把同步盘里的档案复制到这台电脑并改用副本（原文件夹保留）；开启 = 复制到同步盘，或改用同步盘里已有的档案。
// 设计稿：Figma · 5.5.6 · 多台电脑共用（S1 / S3 / D1 / D1′ / D2 / D3 / E1，含 Windows 文案版）。

import { useEffect, useState } from "react";
import { useApp } from "../state/hooks";
import { localCalendarName } from "../state/store";
import { cloudName, platform, type CloudKind, type TreeInfo } from "../platform/platform";
import { Button, Card, Modal, Note, ProgressBar, RadioCard, SheetScaffold, Switch } from "../ui/kit";

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const finderName = () => (platform().os === "windows" ? "资源管理器" : "访达");

/** 设备与同步页里的开关卡片。 */
export function ShareCard() {
  const { store } = useApp();
  const [sheet, setSheet] = useState<"leave" | "join" | null>(null);
  const supported = !!platform().copyTree;
  const on = store.shared;
  const where = cloudName(store.cloud, platform().os);
  return (
    <Card title="多台电脑共用">
      <div className="pref">
        <span className="col grow" style={{ gap: 2 }}>
          <span className="t-row">多台电脑共用这套档案</span>
          <span className="t-meta muted">{on
            ? `档案在 ${where} 里，其他电脑选同一个文件夹即可共用。Charter 会检查同步状态，并自动载入其他电脑的修改。只影响这台电脑。`
            : "档案只在这台电脑上，到期提醒由这台电脑发出。开启后把档案放进 iCloud 云盘或 OneDrive，其他电脑就能共用。"}</span>
        </span>
        <Switch checked={on} disabled={!supported || store.isLoading} onChange={(v) => setSheet(v ? "join" : "leave")} />
      </div>
      {sheet === "leave" && <Modal onClose={() => setSheet(null)} dismissOnEscape={false}><LeaveSharedSheet onClose={() => setSheet(null)} /></Modal>}
      {sheet === "join" && <Modal onClose={() => setSheet(null)} dismissOnEscape={false}><JoinSharedSheet onClose={() => setSheet(null)} /></Modal>}
    </Card>
  );
}

type Phase = { kind: "edit" } | { kind: "copying"; done: number; total: number } | { kind: "failed"; message: string };

function useTreeInfo(root: string) {
  const [info, setInfo] = useState<TreeInfo | null>(null);
  useEffect(() => { let live = true; void platform().treeInfo?.(root).then((i) => { if (live) setInfo(i); }).catch(() => {}); return () => { live = false; }; }, [root]);
  return info;
}

function CopyProgress({ phase, direction }: { phase: Extract<Phase, { kind: "copying" }>; direction: string }) {
  return (
    <div className="col gap8">
      <ProgressBar value={phase.total ? phase.done / phase.total : 0} label="复制进度" />
      <span className="t-meta muted num">{phase.total ? `已复制 ${phase.done} / ${phase.total} 个文件。` : "正在准备（只在云端的文件会先下载）…"}{direction}</span>
    </div>
  );
}

/** D1 / D1′ / D2 / D3：关闭共用。 */
export function LeaveSharedSheet({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const p = platform();
  const win = p.os === "windows";
  const src = store.folder.root;
  const provider = cloudName(store.cloud, p.os);
  const info = useTreeInfo(src);
  const [dest, setDest] = useState<string | null>(null);
  const [destCloud, setDestCloud] = useState<CloudKind>(null);
  const [destError, setDestError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  useEffect(() => { void p.localRoot?.().then(setDest); }, []);
  useEffect(() => {
    if (!dest) return;
    let live = true;
    setDestError(null);
    void (async () => {
      const k = (await p.cloudKind?.(dest)) ?? null;
      const free = await p.freeSpace?.(dest).catch(() => null);
      if (!live) return;
      setDestCloud(k);
      if (k) setDestError(`这个位置在 ${cloudName(k, p.os)} 里${win ? "（“文档”文件夹可能已由 OneDrive 接管）" : "（可能开启了“桌面与文稿”同步）"}，复制过去仍会同步。请选择这台电脑上的其他位置。`);
      else if (info && free != null && free < info.bytes * 1.1) setDestError(`这个位置空间不够：需要 ${fmtBytes(info.bytes)}，剩 ${fmtBytes(free)}。请换一个位置。`);
    })();
    return () => { live = false; };
  }, [dest, info?.bytes]);
  const pick = async () => { const d = await p.pickFolder({ title: "选择复制到哪里", defaultPath: dest ?? undefined }); if (d) setDest(p.join(d, "Charter")); };
  const start = async () => {
    if (!dest) return;
    setPhase({ kind: "copying", done: 0, total: 0 });
    try {
      await store.leaveShared(dest, (done, total) => setPhase({ kind: "copying", done, total }));
      onClose();
      const ics = p.join(store.folder.root, `${localCalendarName}.ics`);
      store.showToast("已改用这台电脑上的档案。订阅了日历文件的，请按新路径重新订阅。", () => { void p.copyText(ics); store.showToast("日历文件路径已复制。"); }, "复制路径");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/已取消/.test(msg)) { setPhase({ kind: "edit" }); return; }
      setPhase({ kind: "failed", message: msg });
    }
  };
  const cancelCopy = () => { void p.cancelCopy?.(); };
  if (phase.kind === "copying") return (
    <SheetScaffold title="正在复制到这台电脑" width={600} trailing={<Button kind="primary" disabled>复制并改用</Button>} leading={<Button kind="quiet" onClick={cancelCopy}>取消复制</Button>}>
      <CopyProgress phase={phase} direction={` 可以取消：取消后仍使用 ${provider} 里的档案，共用保持开启。`} />
    </SheetScaffold>
  );
  if (phase.kind === "failed") return (
    <SheetScaffold title="没能复制到这台电脑" subtitle={`${phase.message} 档案没有改动，共用保持开启。`} width={600}
      leading={<Button kind="quiet" onClick={onClose}>取消</Button>} trailing={<Button kind="primary" onClick={() => void start()}>重试</Button>}>
      <Note tone="warn">已复制的部分已经删除；Charter 仍在使用 {provider} 里的档案。</Note>
    </SheetScaffold>
  );
  const wasPrimary = store.data.settings.primaryDeviceID === store.deviceID;
  return (
    <SheetScaffold title="改为只在这台电脑使用" width={600}
      subtitle={`关闭后，Charter 把数据文件夹复制到这台电脑并改用副本。${provider} 里的原文件夹原样保留，其他电脑照常使用；之后两边的修改各自独立，不再互相同步。`}
      leading={<Button kind="quiet" onClick={onClose}>取消（保持开启）</Button>}
      trailing={<Button kind="primary" disabled={!dest || !!destError || !!destCloud || !info} onClick={() => void start()}>复制并改用</Button>}>
      <div className="col gap12">
        <div className="card flush" style={{ background: "var(--surface-sunken)" }}>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">复制到</span><span className="t-meta muted mono selectable" style={{ overflowWrap: "anywhere" }}>{dest ?? "…"}</span></span>
            <Button size="small" onClick={() => void pick()}>选择位置…</Button></div>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">要复制的内容</span><span className="t-meta muted num">{info ? `${info.files} 个文件 · ${fmtBytes(info.bytes)}${info.cloudOnly ? `；其中 ${info.cloudOnly} 个只在云端，会先下载` : ""}` : "正在统计…"}</span></span></div>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">到期提醒</span><span className="t-meta muted">{wasPrimary ? "这台电脑原来负责发提醒。分开后由其他电脑接手同步盘那份的提醒，这台电脑只提醒自己的副本。" : "这台电脑只提醒自己的副本；同步盘那份的提醒照旧由其他电脑发出。"}</span></span></div>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">系统日历</span><span className="t-meta muted">{`这台电脑改用新日历“${localCalendarName}”${win ? "（桌面版 Outlook）" : ""}，不与其他电脑的“Charter”日历互相覆盖。`}</span></span></div>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">日历订阅</span><span className="t-meta muted">订阅了 Charter.ics 的日历会停止更新。完成后提示条里可以复制新文件的路径，重新订阅一次。</span></span></div>
        </div>
        {destError ? <Note tone="bad">{destError}</Note> : <Note tone="info">复制前会先保存所有修改。复制完成前不改动任何档案；完成后可以在{finderName()}中打开新位置。</Note>}
      </div>
    </SheetScaffold>
  );
}

/** E1：开启共用。 */
export function JoinSharedSheet({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const p = platform();
  const [mode, setMode] = useState<"copy" | "existing">("copy");
  const [suggest, setSuggest] = useState<{ kind: "icloud" | "onedrive"; path: string }[]>([]);
  const [dest, setDest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  useEffect(() => { void p.cloudSuggestions?.().then((s) => { setSuggest(s); if (s[0]) setDest(s[0].path); }); }, []);
  const where = suggest.length ? suggest.map((s) => cloudName(s.kind, p.os)).join(" 或 ") : "iCloud 云盘或 OneDrive";
  const pick = async () => {
    const d = await p.pickFolder({ title: mode === "copy" ? "选择同步盘里的位置" : "选择正在共用的 Charter 文件夹", defaultPath: dest ?? undefined });
    if (d) { setError(null); setDest(mode === "copy" && !(await p.stat(p.join(d, "charter.json"))).exists ? p.join(d, "Charter") : d); }
  };
  const start = async () => {
    if (!dest) return;
    setError(null);
    if (!((await p.cloudKind?.(dest)) ?? null)) { setError("这个位置不在 iCloud 云盘或 OneDrive 里，其他电脑用不到。请选择同步盘里的位置。"); return; }
    if (mode === "copy" && (await p.stat(p.join(dest, "charter.json"))).exists) { setError("这里已经有 Charter 档案。要用它，请选“改用同步盘里已有的档案”。"); return; }
    if (mode === "copy") setPhase({ kind: "copying", done: 0, total: 0 });
    try {
      await store.joinShared(mode, dest, (done, total) => setPhase({ kind: "copying", done, total }));
      onClose();
      store.showToast(mode === "copy" ? "已把档案放进同步盘。其他电脑选这个文件夹即可共用。" : "已改用同步盘里的档案。", () => { void p.copyText(dest); store.showToast("路径已复制。"); }, "复制路径");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/已取消/.test(msg)) { setPhase({ kind: "edit" }); return; }
      if (mode === "copy") setPhase({ kind: "failed", message: msg }); else { setPhase({ kind: "edit" }); setError(msg); }
    }
  };
  if (phase.kind === "copying") return (
    <SheetScaffold title="正在复制到同步盘" width={600} trailing={<Button kind="primary" disabled>继续</Button>} leading={<Button kind="quiet" onClick={() => void p.cancelCopy?.()}>取消复制</Button>}>
      <CopyProgress phase={phase} direction=" 可以取消：取消后仍只在这台电脑使用。" />
    </SheetScaffold>
  );
  if (phase.kind === "failed") return (
    <SheetScaffold title="没能复制到同步盘" subtitle={`${phase.message} 这台电脑上的档案没有改动，仍只在这台电脑使用。`} width={600}
      leading={<Button kind="quiet" onClick={onClose}>取消</Button>} trailing={<Button kind="primary" onClick={() => void start()}>重试</Button>}>
      <Note tone="warn">已复制的部分已经删除。</Note>
    </SheetScaffold>
  );
  return (
    <SheetScaffold title="在多台电脑之间共用" subtitle={`档案要放在 ${where} 里，其他电脑才能用到。选一种方式：`} width={600}
      leading={<Button kind="quiet" onClick={onClose}>取消</Button>} trailing={<Button kind="primary" disabled={!dest} onClick={() => void start()}>继续</Button>}>
      <div className="col gap12">
        <div role="radiogroup" className="col gap10">
          <RadioCard selected={mode === "copy"} onSelect={() => { setMode("copy"); setError(null); }} title="把这台电脑的档案复制到同步盘"
            detail={`复制到 ${where}，之后各台电脑都用这一份。这台电脑上的原文件夹保留，Charter 不再使用。`} />
          <RadioCard selected={mode === "existing"} onSelect={() => { setMode("existing"); setError(null); setDest(null); }} title="改用同步盘里已有的档案"
            detail="另一台电脑已经在共用时选这个。选择那个 Charter 文件夹；这台电脑的修改不会带过去，本机文件夹保留，可以随时换回。" />
        </div>
        <div className="card flush" style={{ background: "var(--surface-sunken)" }}>
          <div className="s4-row"><span className="col grow" style={{ gap: 3 }}><span className="t-row">{mode === "copy" ? "复制到" : "共用的文件夹"}</span>
            <span className="t-meta muted mono selectable" style={{ overflowWrap: "anywhere" }}>{dest ?? "还没有选择"}</span></span>
            <Button size="small" onClick={() => void pick()}>选择位置…</Button></div>
        </div>
        {error ? <Note tone="bad">{error}</Note> : <Note tone="info">复制完成前不改动任何档案；取消则保持“仅本机使用”。订阅了 Charter.ics 的日历需要按新路径重新订阅一次。</Note>}
      </div>
    </SheetScaffold>
  );
}
