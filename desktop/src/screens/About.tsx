// 5.5.5：设置 → 关于与更新。设计稿：Figma「5.5.5 · 流程修正」U1–U6。
import { useState, useSyncExternalStore } from "react";
import { platform } from "../platform/platform";
import { Button, Note, Pill, Switch } from "../ui/kit";
import { autoCheckOn, checkForUpdate, currentVersion, lastCheck, remindLater, setAutoCheck, skipVersion, subscribeUpdate, updateState } from "../services/update";
import { PaneHeader, Scroll, SGroup, SRow } from "./Settings";
import { LogoMark } from "../ui/Logo";
import * as D from "../domain/day";

const when = (t: number) => { const d = new Date(t); const day = D.makeDay(d.getFullYear(), d.getMonth() + 1, d.getDate()); return `${day === D.today() ? "今天" : D.long(day)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function AboutSettings() {
  const st = useSyncExternalStore(subscribeUpdate, updateState);
  const auto = useSyncExternalStore(subscribeUpdate, autoCheckOn);
  const [all, setAll] = useState(false);
  const v = currentVersion();
  const last = lastCheck();
  const status = st.kind === "checking" ? "正在检查更新…" : st.kind === "available" ? `Charter ${st.info.version} 可以更新${st.info.date ? ` · ${D.long(st.info.date)}发布` : ""}`
    : st.kind === "latest" ? "已是最新版本 · 刚刚检查" : st.kind === "error" ? "上次检查失败 · 刚刚" : st.kind === "noURL" ? "还没有设置更新地址"
    : last ? `上次检查：${when(last)}` : "还没有检查过更新";
  const tone = st.kind === "available" ? "green-text" : st.kind === "error" ? "amber-text" : "muted";
  const open = (url: string) => void platform().openURL(url);
  return <Scroll><PaneHeader title="关于与更新" detail="当前版本、更新检查和更新内容。" /><div className="col" style={{ gap: 20 }}>
    <div className="row gap16 panel" style={{ padding: 20 }}>
      <LogoMark size={44} />
      <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
        <div className="row gap8"><span className="t-title num">Charter {v}</span>{st.kind === "available" && <Pill text="有新版本" kind="valid" />}</div>
        <span className={`t-meta ${tone}`}>{status}</span>
      </div>
      {st.kind !== "available" && <Button disabled={st.kind === "checking" || st.kind === "noURL"} onClick={() => void checkForUpdate()}>{st.kind === "checking" ? "正在检查…" : st.kind === "error" ? "重试" : "检查更新"}</Button>}
    </div>
    {st.kind === "available" && <div className="col panel panel-accent rise-in" style={{ padding: 20, gap: 12 }}>
      <div className="row gap8"><span className="t-row grow">{st.info.version} 更新内容</span><span className="t-meta muted">来自发布说明</span></div>
      {st.info.notes.length ? <ul className="col gap6" style={{ margin: 0, paddingLeft: 18 }}>{st.info.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        : <span className="muted">这个版本没有写更新要点。</span>}
      {all && <div className="panel-soft release-notes t-meta selectable">{st.info.fullNotes}</div>}
      {st.info.fullNotes && <button className="link t-row" style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>{all ? "收起完整发布说明" : "查看完整发布说明"}</button>}
      <div className="row gap10">
        <Button kind="quiet" onClick={() => skipVersion(st.info.version)} title="不再提示这个版本；有更新的版本时会再提示">跳过这个版本</Button>
        <span className="grow" />
        <Button onClick={() => remindLater()} title="3 天内侧栏不再提示">稍后提醒</Button>
        <Button kind="primary" disabled={!st.info.url} onClick={() => open(st.info.url)}>前往下载</Button>
      </div>
    </div>}
    {st.kind === "available" && <span className="t-meta muted">下载页面会在浏览器中打开。安装新版前，档案数据保持在原来的数据文件夹里，不受影响。</span>}
    {st.kind === "latest" && <Note tone="ok">Charter {v} 是最新版本。</Note>}
    {st.kind === "error" && <Note tone="warn">{st.message} 档案和设置都不受影响，可以稍后重试。</Note>}
    {st.kind === "noURL" && <Note>这个版本没有配置更新来源，暂时无法检查更新。</Note>}
    <SGroup>
      <SRow title="自动检查更新" detail="打开 Charter 时检查，每天最多一次。只读取版本号和发布说明，不上传任何档案数据。">
        <Switch checked={auto} onChange={setAutoCheck} />
      </SRow>
    </SGroup>
  </div></Scroll>;
}
