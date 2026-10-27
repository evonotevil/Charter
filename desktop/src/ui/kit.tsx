// 组件库：与 Swift 版 Kit / DesignSystem / Components 一一对应。

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as D from "../domain/day";
import type { Day } from "../domain/day";
import { SlideBg, TweenNumber, reducedMotion } from "./motion";
import { Icon } from "./Icon";
import { platform } from "../platform/platform";

/** 快捷键的显示：Mac 用 ⌘ / ⇧，Windows 用 Ctrl+ / Ctrl+Shift+。 */
export function shortcutLabel(key: string, shift = false) {
  return platform().os === "mac" ? `${shift ? "⇧" : ""}⌘${key}` : `${shift ? "Ctrl+Shift+" : "Ctrl+"}${key}`;
}

export type BtnKind = "primary" | "secondary" | "accent" | "quiet" | "danger";
export type BtnSize = "small" | "regular" | "large";

export function Button(p: {
  kind?: BtnKind; size?: BtnSize; icon?: string; children?: ReactNode; onClick?: (e: React.MouseEvent) => void; disabled?: boolean;
  title?: string; className?: string; style?: CSSProperties; type?: "button" | "submit"; autoFocus?: boolean; ariaLabel?: string;
  /** 看起来禁用、但仍可聚焦，悬停和读屏能读到原因（describedBy）。点击不执行 onClick。 */
  softDisabled?: boolean; describedBy?: string;
}) {
  const iconOnly = !p.children && !!p.icon;
  return (
    <button type={p.type ?? "button"} className={`btn ${p.kind ?? "secondary"} ${p.size === "regular" || !p.size ? "" : p.size} ${iconOnly ? "icon" : ""} ${p.className ?? ""}`}
      onClick={p.softDisabled ? undefined : p.onClick} disabled={p.disabled} aria-disabled={p.softDisabled || undefined} aria-describedby={p.describedBy} title={p.title} style={p.style} autoFocus={p.autoFocus} aria-label={p.ariaLabel ?? (iconOnly ? p.title : undefined)}>
      {p.icon && <Icon name={p.icon} size={p.size === "small" ? 13 : 15} />}
      {p.children}
    </button>
  );
}

export type PillKind = "neutral" | "valid" | "warn" | "bad" | "strong" | "lime" | "outline";
export const Pill = ({ text, kind = "neutral", title }: { text: string; kind?: PillKind; title?: string }) =>
  <span className={`pill ${kind}`} title={title}>{text}</span>;

export const CountBadge = ({ count, tone }: { count: number; inverted?: boolean; tone?: "bad" | "neutral" }) =>
  <span className={`badge ${tone ?? ""}`}>{count}</span>;

export function Avatar({ name, size = 30, dashed, highlighted }: { name: string; size?: number; dashed?: boolean; highlighted?: boolean }) {
  return (
    <span className={`avatar ${dashed ? "dashed" : ""}`} aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42, ...(highlighted ? { boxShadow: "0 0 0 2px var(--green)" } : {}) }}>
      {[...name][0] ?? ""}
    </span>
  );
}

export const JurisdictionBadge = ({ code, size = 36, highlighted, tint }: { code: string; size?: number; highlighted?: boolean; tint?: CSSProperties }) =>
  <span className={`jbadge ${highlighted ? "hl" : ""}`} style={{ width: size, height: size, borderRadius: size * 0.3, fontSize: size * 0.32, ...(highlighted ? null : tint) }}>{code}</span>;

export const ProgressCapsule = ({ value, style }: { value: number; style?: CSSProperties }) =>
  <div className="progress" style={style}><div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;

export function Spinner({ size = 14 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", border: "2.5px solid var(--line)", borderTopColor: "var(--green)", display: "inline-block", animation: "spin .8s linear infinite" }} />;
}

// MARK: - 浮层

/** 锚定在触发元素下方（或上方）的浮层；点外面或按 Esc 关闭。 */
export function Popover({ anchor, open, onClose, children, placement = "bottom", align = "start", minWidth, style }: {
  anchor: React.RefObject<HTMLElement>; open: boolean; onClose: () => void; children: ReactNode; placement?: "bottom" | "top" | "right";
  align?: "start" | "end" | "center"; minWidth?: number; style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const a = anchor.current!.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? 220, h = el?.offsetHeight ?? 200;
      let left = align === "end" ? a.right - w : align === "center" ? a.left + a.width / 2 - w / 2 : a.left;
      let top = placement === "top" ? a.top - h - 6 : placement === "right" ? a.top : a.bottom + 6;
      if (placement === "right") left = a.right + 6;
      if (placement === "bottom" && top + h > window.innerHeight - 12) top = Math.max(12, a.top - h - 6);
      if (placement === "top" && top < 12) top = a.bottom + 6;
      left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
      top = Math.max(12, Math.min(top, window.innerHeight - h - 12));
      setPos({ left, top });
    };
    place();
    const r = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(r); window.removeEventListener("resize", place); };
  }, [open, anchor, placement, align]);
  useEffect(() => {
    if (!open) return;
    // 5.4：弹层可以嵌套（例如面板里的下拉）。下拉列表挂在 body 上，不在本面板的 DOM 里，
    // 所以点在“其他弹层”里不算外部点击；Esc 只关最上面的一层。
    const isTop = () => { const all = document.querySelectorAll(".popover"); return all[all.length - 1] === ref.current; };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      const other = (t as Element).closest?.(".popover");
      if (other && other !== ref.current) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && isTop()) { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down, true); document.removeEventListener("keydown", key, true); };
  }, [open, onClose, anchor]);
  useExitGhost(ref, open);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth, ...style }} role="dialog">{children}</div>,
    document.body,
  );
}

export function PopoverRow({ title, icon, trailing, checked, destructive, disabled, onClick }: {
  title: string; icon?: string; trailing?: string; checked?: boolean; destructive?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button className={`prow ${destructive ? "destructive" : ""}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="ic"><Icon name={icon} size={14} /></span>}
      <span className="ellipsis grow">{title}</span>
      {trailing && <span className="t-meta muted">{trailing}</span>}
      {checked && <Icon name="checkmark" size={13} />}
    </button>
  );
}

export type MenuEntry =
  | { kind: "item"; title: string; icon?: string; shortcut?: string; destructive?: boolean; disabled?: boolean; action: () => void }
  | { kind: "divider" }
  | { kind: "header"; title: string };
export const item = (title: string, icon: string | undefined, action: () => void, opts: { shortcut?: string; destructive?: boolean; disabled?: boolean } = {}): MenuEntry =>
  ({ kind: "item", title, icon, action, ...opts });
export const divider: MenuEntry = { kind: "divider" };
export const header = (title: string): MenuEntry => ({ kind: "header", title });

export function MenuList({ entries, close }: { entries: MenuEntry[]; close: () => void }) {
  return (
    <div className="col" style={{ gap: 1 }}>
      {entries.map((e, i) => e.kind === "divider" ? <div key={i} className="pdivider" />
        : e.kind === "header" ? <div key={i} className="pheader">{e.title}</div>
          : <PopoverRow key={i} title={e.title} icon={e.icon} trailing={e.shortcut} destructive={e.destructive} disabled={e.disabled}
            onClick={() => { close(); e.action(); }} />)}
    </div>
  );
}

export function ActionMenu({ title, icon, kind = "secondary", size = "regular", entries, placement = "bottom", align = "start", showsChevron = true, ariaLabel }: {
  title?: string; icon?: string; kind?: BtnKind; size?: BtnSize; entries: MenuEntry[]; placement?: "bottom" | "top"; align?: "start" | "end"; showsChevron?: boolean; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} className={`btn ${kind} ${size === "regular" ? "" : size} ${title ? "" : "icon"}`} onClick={() => setOpen((o) => !o)} aria-label={ariaLabel ?? title ?? "更多操作"} title={ariaLabel}>
        {icon && <Icon name={icon} size={size === "small" ? 13 : 15} />}
        {title}
        {title && showsChevron && <Icon name={placement === "top" ? "chevron.up" : "chevron.down"} size={10} style={{ opacity: .6 }} />}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement={placement} align={align}>
        <MenuList entries={entries} close={() => setOpen(false)} />
      </Popover>
    </>
  );
}

/** 右键菜单。 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const open = (e: React.MouseEvent, entries: MenuEntry[]) => { e.preventDefault(); setState({ x: e.clientX, y: e.clientY, entries }); };
  const node = state ? (
    <>
      {createPortal(<div ref={anchor} style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1 }} />, document.body)}
      <Popover anchor={anchor} open onClose={() => setState(null)}><MenuList entries={state.entries} close={() => setState(null)} /></Popover>
    </>
  ) : null;
  return { open, node };
}

// MARK: - 下拉选择

/** 选项的展示信息：分组标题、前置图标（头像、法域徽章）和副标题。 */
export interface OptionInfo { group?: string; lead?: ReactNode; sub?: string }

/** 5.3.3：下拉选择。选项多时带搜索；可按 describe 分组并显示头像或法域徽章；方向键选择、回车确认。 */
export function SelectField<V>({ options, value, onChange, placeholder = "请选择", minWidth = 180, maxWidth, disabled, keyOf, ariaLabel, describe }: {
  options: [V, string][]; value: V; onChange: (v: V) => void; placeholder?: string; minWidth?: number; maxWidth?: number; disabled?: boolean; ariaLabel?: string;
  keyOf?: (v: V) => string; describe?: (v: V) => OptionInfo | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const k = keyOf ?? ((v: V) => JSON.stringify(v ?? null));
  const cur = options.find(([v]) => k(v) === k(value));
  const current = cur?.[1];
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
  const nq = norm(q.trim());
  const filtered = nq ? options.filter(([v, l]) => norm(l).includes(nq) || norm(describe?.(v)?.sub ?? "").includes(nq)) : options;
  // 按分组保持出现顺序
  const groups: { title?: string; items: [V, string][] }[] = [];
  for (const o of filtered) { const g = describe?.(o[0])?.group; const hit = groups.find((x) => x.title === g); if (hit) hit.items.push(o); else groups.push({ title: g, items: [o] }); }
  const flat = groups.flatMap((g) => g.items);
  const close = () => { setOpen(false); setQ(""); };
  const pick = (v: V) => { onChange(v); close(); };
  useEffect(() => { if (open) setHi(Math.max(0, flat.findIndex(([v]) => k(v) === k(value)))); }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi, open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" && flat[hi]) { e.preventDefault(); pick(flat[hi][0]); }
  };
  const mark = (l: string) => {
    if (!nq) return l;
    const i = l.toLowerCase().indexOf(q.trim().toLowerCase());
    return i < 0 ? l : <>{l.slice(0, i)}<mark className="hl">{l.slice(i, i + q.trim().length)}</mark>{l.slice(i + q.trim().length)}</>;
  };
  let idx = -1;
  const curInfo = cur ? describe?.(cur[0]) : undefined;
  return (
    <>
      <button ref={ref} className={`select ${open ? "open" : ""}`} disabled={disabled} aria-label={ariaLabel ? `${ariaLabel}：${current ?? placeholder}` : undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}
        style={{ minWidth, maxWidth, width: maxWidth ? "100%" : undefined, opacity: disabled ? .5 : 1 }}>
        {curInfo?.lead && <span className="sel-lead">{curInfo.lead}</span>}
        <span className={`ellipsis grow ${current ? "" : "muted"}`}>{current ?? placeholder}</span>
        <Icon name="chevron.up.chevron.down" size={11} className="muted" />
      </button>
      <Popover anchor={ref} open={open} onClose={close} minWidth={Math.max(minWidth, 260)}>
        <div className="col gap6" onKeyDown={onKey}>
          {options.length > 8 && <label className="search sel-search"><Icon name="magnifyingglass" size={13} /><input className="field" autoFocus placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索选项" /></label>}
          <div ref={listRef} className="col sel-list" role="listbox" tabIndex={options.length > 8 ? -1 : 0} autoFocus={options.length <= 8}>
            {groups.map((g, gi) => (
              <div key={gi} className="col" role={g.title ? "group" : undefined} aria-label={g.title}>
                {g.title && <span className="sel-group">{g.title}<span className="num"> {g.items.length}</span></span>}
                {g.items.map(([v, l]) => {
                  idx++; const i = idx; const info = describe?.(v); const on = k(v) === k(value);
                  return (
                    <button key={k(v)} data-i={i} role="option" aria-selected={on} className={`sel-opt ${i === hi ? "hi" : ""} ${on ? "on" : ""}`}
                      onMouseMove={() => setHi(i)} onClick={() => pick(v)}>
                      {info?.lead && <span className="sel-lead">{info.lead}</span>}
                      <span className="col grow" style={{ minWidth: 0 }}><span className="ellipsis">{mark(l)}</span>{info?.sub && <span className="t-meta muted ellipsis">{info.sub}</span>}</span>
                      {on && <Icon name="checkmark" size={13} />}
                    </button>
                  );
                })}
              </div>
            ))}
            {!flat.length && <span className="t-meta muted" style={{ padding: "10px 12px" }}>没有匹配“{q.trim()}”的选项</span>}
          </div>
        </div>
      </Popover>
    </>
  );
}

// MARK: - 日期

export function DateField({ value, onChange, placeholder = "选择日期", relativeTo, relativeLabel = "签发后", allowsClear = true, minWidth = 170 }: {
  value?: Day; onChange: (d?: Day) => void; placeholder?: string; relativeTo?: Day; relativeLabel?: string; allowsClear?: boolean; minWidth?: number;
}) {
  const [text, setText] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(value ?? ""); setInvalid(false); }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) { if (allowsClear) onChange(undefined); setInvalid(false); return; }
    const d = D.parseDay(t);
    if (d) { onChange(d); setInvalid(false); } else setInvalid(true);
  };
  return (
    <div ref={ref} className="row gap6" title={invalid ? "日期格式应为 2026-10-27" : undefined}
      style={{ minWidth, minHeight: 38, padding: "0 10px 0 8px", borderRadius: "var(--r-field)", background: "var(--field-fill)",
        boxShadow: `inset 0 0 0 ${focused || open || invalid ? 1.5 : 1}px ${invalid ? "var(--danger)" : focused || open ? "color-mix(in srgb, var(--ink) 70%, transparent)" : "var(--hairline)"}`, display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} title="打开日历" className="muted row" style={{ width: 22, height: 22, justifyContent: "center" }}><Icon name="calendar" size={14} /></button>
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }} onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className="num" style={{ border: 0, outline: "none", background: "transparent", font: "inherit", color: "var(--ink)", width: 0, minWidth: 0, flex: 1 }} />
      {allowsClear && value && <button title="清除日期" className="muted" onClick={() => { onChange(undefined); setText(""); }} style={{ opacity: .7 }}><Icon name="xmark.circle.fill" size={14} /></button>}
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        <CalendarPanel value={value} onPick={(d) => { onChange(d); setOpen(false); }} relativeTo={relativeTo} relativeLabel={relativeLabel} allowsClear={allowsClear} />
      </Popover>
    </div>
  );
}

export function CalendarPanel({ value, onPick, relativeTo, relativeLabel = "签发后", allowsClear = true }: {
  value?: Day; onPick: (d?: Day) => void; relativeTo?: Day; relativeLabel?: string; allowsClear?: boolean;
}) {
  const base = value ?? D.today();
  const [shown, setShown] = useState(D.makeDay(D.year(base), D.month(base), 1));
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [yearPage, setYearPage] = useState(D.year(base) - (D.year(base) % 12));
  const today = D.today();
  const page = (step: number) => {
    if (mode === "days") setShown(D.addMonths(shown, step));
    else if (mode === "months") setShown(D.makeDay(D.year(shown) + step, D.month(shown), 1));
    else setYearPage(yearPage + step * 12);
  };
  const title = mode === "days" ? `${D.year(shown)}年${D.month(shown)}月` : mode === "months" ? `${D.year(shown)}年` : `${yearPage} – ${yearPage + 11}`;
  const first = D.makeDay(D.year(shown), D.month(shown), 1);
  const lead = (D.weekday(first) + 5) % 7;
  const start = D.addDays(first, -lead);
  const count = Math.ceil((lead + D.daysIn(D.year(shown), D.month(shown))) / 7) * 7;
  const cells = Array.from({ length: count }, (_, i) => D.addDays(start, i));
  const pick = (label: string, on: boolean, current: boolean, action: () => void, key: string | number) => (
    <button key={key} onClick={action} className="num" style={{ height: 40, borderRadius: 10, fontSize: 13, fontWeight: on ? 600 : 500,
      background: on ? "var(--selection)" : "var(--band)", color: on ? "var(--on-selection)" : "var(--ink)", boxShadow: current && !on ? "inset 0 0 0 2px var(--lime)" : undefined }}>{label}</button>
  );
  return (
    <div className="col gap10" style={{ width: 288, padding: 8 }}>
      <div className="row gap4">
        <Button kind="quiet" size="small" onClick={() => {
          if (mode === "days") { setMode("years"); setYearPage(D.year(shown) - (D.year(shown) % 12)); } else if (mode === "months") setMode("years"); else setMode("days");
        }}>{title}<Icon name={mode === "days" ? "chevron.down" : "chevron.up"} size={10} className="muted" /></Button>
        <span className="spacer" />
        <Button kind="quiet" size="small" icon="chevron.left" onClick={() => page(-1)} title={mode === "years" ? "前 12 年" : mode === "months" ? "上一年" : "上个月"} />
        <Button kind="quiet" size="small" icon="chevron.right" onClick={() => page(1)} title={mode === "years" ? "后 12 年" : mode === "months" ? "下一年" : "下个月"} />
      </div>
      {mode === "days" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 38px)", gap: 2, justifyContent: "center" }}>
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => <div key={w} className="t-micro muted" style={{ textAlign: "center", height: 22, lineHeight: "22px" }}>{w}</div>)}
          {cells.map((d) => {
            const inMonth = D.month(d) === D.month(shown), selected = d === value, isToday = d === today;
            return (
              <button key={d} onClick={() => onPick(d)} aria-label={D.long(d)} className="num"
                style={{ width: 30, height: 30, margin: "0 auto", borderRadius: "50%", fontSize: 12.5, fontWeight: selected ? 600 : 400,
                  background: selected ? "var(--selection)" : "transparent", color: selected ? "var(--on-selection)" : inMonth ? "var(--ink)" : "color-mix(in srgb, var(--muted) 50%, transparent)",
                  boxShadow: isToday && !selected ? "inset 0 0 0 2px var(--lime)" : undefined }}>{D.dayOf(d)}</button>
            );
          })}
        </div>
      )}
      {mode === "months" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "4px 0" }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => pick(`${m} 月`, !!value && D.year(value) === D.year(shown) && D.month(value) === m,
            D.year(today) === D.year(shown) && D.month(today) === m, () => { setShown(D.makeDay(D.year(shown), m, 1)); setMode("days"); }, m))}
        </div>
      )}
      {mode === "years" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "4px 0" }}>
          {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => pick(String(y), !!value && D.year(value) === y, D.year(today) === y,
            () => { setShown(D.makeDay(y, D.month(shown), 1)); setMode("months"); }, y))}
        </div>
      )}
      <div className="hairline" />
      {relativeTo && (
        <div className="row gap6">
          <span className="t-meta muted">{relativeLabel}</span>
          {([[3, "3 个月"], [6, "6 个月"], [12, "1 年"]] as const).map(([m, l]) =>
            <Button key={m} size="small" onClick={() => onPick(D.addMonths(relativeTo, m))} title={`${relativeLabel} ${l}：${D.addMonths(relativeTo, m)}`}>{l}</Button>)}
        </div>
      )}
      <div className="row gap6">
        <Button size="small" onClick={() => onPick(D.today())}>今天</Button>
        <span className="spacer" />
        {allowsClear && value && <Button kind="quiet" size="small" onClick={() => onPick(undefined)}>清除</Button>}
      </div>
    </div>
  );
}

// MARK: - 复选、单选、开关、分段

/** 复选（Checkbox）是方角，单选（RadioGroup）是圆形：外观和行为一致。 */
export const ChoiceMark = ({ on, square }: { on: boolean; square?: boolean }) => <span className={`mark ${square ? "sq" : ""} ${on ? "on" : ""}`}>{on && <Icon name="checkmark" size={10} strokeWidth={3.5} />}</span>;

export function Checkbox({ checked, onChange, children, disabled, title, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; title?: string; ariaLabel?: string }) {
  return (
    <button className="row gap8" onClick={(e) => { e.stopPropagation(); onChange(!checked); }} disabled={disabled} role="checkbox" aria-checked={checked} aria-label={ariaLabel} title={title} style={{ opacity: disabled ? .5 : 1, textAlign: "left" }}>
      <ChoiceMark on={checked} square />{children && <span>{children}</span>}
    </button>
  );
}

export function Switch({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <button className="row gap10" onClick={() => onChange(!checked)} disabled={disabled} role="switch" aria-checked={checked} style={{ opacity: disabled ? .5 : 1 }}>
      {children && <span className="grow" style={{ textAlign: "left" }}>{children}</span>}
      <span className={`switch ${checked ? "on" : ""}`} />
    </button>
  );
}

export function RadioGroup<V>({ options, value, onChange, horizontal }: { options: [V, string][]; value: V; onChange: (v: V) => void; horizontal?: boolean }) {
  return (
    <div className={horizontal ? "row gap16 wrap" : "col gap10"} role="radiogroup">
      {options.map(([v, l], i) => (
        <button key={i} className="row gap8" onClick={() => onChange(v)} role="radio" aria-checked={v === value}>
          <ChoiceMark on={v === value} /><span>{l}</span>
        </button>
      ))}
    </div>
  );
}

export function Segmented<V extends string | number | boolean>({ options, value, onChange }: { options: [V, string][]; value: V; onChange: (v: V) => void }) {
  return (
    <div className="seg slide-host" role="tablist">
      <SlideBg />
      {options.map(([v, l]) => <button key={String(v)} className={v === value ? "on" : ""} onClick={() => onChange(v)} role="tab" aria-selected={v === value}>{l}</button>)}
    </div>
  );
}

// MARK: - 表单

export function FormGroup({ title, canvas, children }: { title?: string; canvas?: boolean; children: ReactNode }) {
  const rows = (Array.isArray(children) ? children.flat(3) : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <div>
      {title && <div className="fgroup-title">{title}</div>}
      <div className={`fgroup ${canvas ? "canvas" : ""}`}>
        {rows.map((c, i) => <div key={i} className="frow">{c}</div>)}
      </div>
    </div>
  );
}

export function FieldRow({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="row start gap12">
      <span className="flabel">{label}</span>
      <div className="col gap4 grow">
        {children}
        {error ? <span className="ferror"><Icon name="exclamationmark.circle.fill" size={13} />{error}</span>
          : hint ? <span className="t-meta muted">{hint}</span> : null}
      </div>
    </div>
  );
}

export function TextField({ value, onChange, placeholder, invalid, autoFocus, onEnter, style, multiline, rows, mono, width }: {
  value: string; onChange: (s: string) => void; placeholder?: string; invalid?: boolean; autoFocus?: boolean; onEnter?: () => void; style?: CSSProperties;
  multiline?: boolean; rows?: number; mono?: boolean; width?: number;
}) {
  if (multiline) return <textarea className={`field ${invalid ? "invalid" : ""}`} value={value} placeholder={placeholder} rows={rows ?? 3} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} style={{ width, ...style }} />;
  return <input className={`field ${invalid ? "invalid" : ""} ${mono ? "mono" : ""}`} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }} style={{ width, ...style }} />;
}

/** 逗号或换行分隔的列表输入。 */
export function ListField({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(values.join("，"));
  useEffect(() => setText(values.join("，")), [values.join("\u0000")]);
  return <input className="field" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
    onBlur={() => onChange(text.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean))} />;
}

// MARK: - 弹窗

/**
 * 离场淡出（#5 #6）：元素被卸载时，在 body 上留一个复制品 fixed 在原位淡出。
 * 经 router 关闭的弹窗已经由 html.closing-sheet 播过淡出，这里跳过。
 */
function useExitGhost(ref: React.RefObject<HTMLElement>, active: boolean) {
  // 只记住元素，不在每次渲染时读布局；离场时才量一次尺寸。
  const last = useRef<HTMLElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useLayoutEffect(() => { if (active && ref.current) last.current = ref.current; });
  const ghost = (el: HTMLElement | null) => {
    if (!el || !el.isConnected || reducedMotion() || document.documentElement.classList.contains("closing-sheet")) return;
    const rect = el.getBoundingClientRect();
    // 大弹窗（设置等）整体克隆代价高：只克隆外壳和第一层面板，内容留空，淡出 120ms
    const big = el.getElementsByTagName("*").length > 400;
    const g = el.cloneNode(!big) as HTMLElement;
    if (big) { const sheet = el.firstElementChild?.cloneNode(false) as HTMLElement | undefined; if (sheet) { const r = (el.firstElementChild as HTMLElement).getBoundingClientRect(); sheet.style.width = `${r.width}px`; sheet.style.height = `${r.height}px`; g.appendChild(sheet); } }
    g.setAttribute("aria-hidden", "true");
    g.classList.add("ghost-out");
    Object.assign(g.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: "none", margin: "0", animationDelay: "0s" });
    document.body.appendChild(g);
    setTimeout(() => g.remove(), 160);
  };
  useLayoutEffect(() => {
    if (active) return;
    const el = last.current; last.current = null; ghost(el);
  }, [active]);
  useLayoutEffect(() => () => { if (activeRef.current) ghost(last.current); }, []);
}

const SheetDepth = createContext(0);

/**
 * 弹窗和浮层的焦点：打开时把焦点移进去（没有 autoFocus 的元素就聚焦第一个可操作元素），
 * Tab 在里面循环；关闭后焦点回到打开它的按钮（DESIGN.md §7）。
 */
export function useFocusReturn(ref: React.RefObject<HTMLElement>) {
  // 在渲染时就记下入口：此时焦点还没被弹窗内容拿走
  const [opener] = useState(() => (typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null));
  useEffect(() => {
    const el = ref.current;
    const focusables = () => [...(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((x) => x.offsetParent !== null);
    const t = requestAnimationFrame(() => { if (el && !el.contains(document.activeElement)) focusables()[0]?.focus({ preventScroll: true }); });
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el?.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(t);
      el?.removeEventListener("keydown", trap);
      // 等离场完成、DOM 卸载后再还焦点；入口已不在页面上就不还
      setTimeout(() => {
        if (!opener || !opener.isConnected || opener === document.body) return;
        const a = document.activeElement as HTMLElement | null;
        // 用户已经在别处打字就不抢焦点；其他情况（body、应用根、已卸载的弹窗元素）都还给入口
        const typing = a && a !== document.body && a.isConnected && !el?.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
        if (!typing) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
}

export function Modal({ onClose, children, dismissOnEscape = true }: { onClose: () => void; children: ReactNode; dismissOnEscape?: boolean }) {
  const depth = useContext(SheetDepth);
  const overlay = useRef<HTMLDivElement>(null);
  useExitGhost(overlay, true);
  useFocusReturn(overlay);
  useEffect(() => {
    if (!dismissOnEscape) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".popover")) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, dismissOnEscape]);
  return createPortal(
    <SheetDepth.Provider value={depth + 1}>
      <div ref={overlay} className="overlay" role="dialog" aria-modal="true" style={{ zIndex: 900 + depth * 10 }}
        // 弹窗经 portal 渲染，React 事件仍会沿组件树冒泡到触发它的行；在这里截住点击类事件。键盘事件不截，Esc 等快捷键挂在 window 上。
        onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onMouseDown={(e) => { if (e.target === e.currentTarget) { /* 与 Mac 一致：点背景不关闭 */ } }}>{children}</div>
    </SheetDepth.Provider>,
    document.body,
  );
}

export function SheetScaffold({ title, subtitle, width = 560, height, children, leading, trailing, onSubmit }: {
  title: string; subtitle?: ReactNode; width?: number; height?: number; children: ReactNode; leading?: ReactNode; trailing?: ReactNode; onSubmit?: () => void;
}) {
  return (
    <div className="sheet" style={{ width, maxHeight: Math.min(height ?? 720, window.innerHeight - 48) }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); } }}>
      <div className="sheet-head">
        <div className="t-sheet" title={title}>{title}</div>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="sheet-body">{children}</div>
      <div className="sheet-foot">{leading}<span className="spacer" />{trailing}</div>
    </div>
  );
}

export function ConfirmSheet({ title, message, details = [], confirmTitle, destructive, onConfirm, onClose }: {
  title: string; message: string; details?: string[]; confirmTitle: string; destructive?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="sheet" style={{ width: 460, padding: 28, gap: 16 }}>
        <div className="row start gap12">
          <span className="row" style={{ width: 38, height: 38, borderRadius: "50%", justifyContent: "center", flex: "none",
            background: destructive ? "color-mix(in srgb, var(--danger) 12%, transparent)" : "var(--band)", color: destructive ? "var(--danger)" : "var(--ink)" }}>
            <Icon name={destructive ? "exclamationmark.triangle.fill" : "questionmark.circle"} size={17} />
          </span>
          <div className="col gap6">
            <div className="t-sheet">{title}</div>
            <div className="muted">{message}</div>
          </div>
        </div>
        {details.length > 0 && (
          <div className="col gap6" style={{ padding: 16, background: "var(--band)", borderRadius: "var(--r-field)" }}>
            {details.map((d, i) => <div key={i} className="row baseline gap8"><span style={{ width: 4, height: 4, borderRadius: 2, background: "var(--muted)", flex: "none", transform: "translateY(-2px)" }} /><span>{d}</span></div>)}
          </div>
        )}
        <div className="row gap10">
          <span className="spacer" />
          <Button onClick={onClose}>取消</Button>
          <Button kind={destructive ? "danger" : "primary"} autoFocus onClick={() => { onClose(); onConfirm(); }}>{confirmTitle}</Button>
        </div>
      </div>
    </Modal>
  );
}


export function CopyTextSheet({ title, subtitle, initial, onCopy, onClose }: { title: string; subtitle?: string; initial: string; onCopy?: () => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      <SheetScaffold title={title} subtitle={subtitle ?? "可先修改，再复制到微信、飞书或邮件中。"} width={520} height={460}
        leading={copied ? <span className="row gap6 lime-text"><Icon name="checkmark.circle.fill" size={15} />已复制</span> : null}
        trailing={<>
          <Button onClick={onClose}>取消</Button>
          <Button kind="primary" onClick={async () => { await platform().copyText(text); setCopied(true); onCopy?.(); setTimeout(onClose, 600); }}>复制文本</Button>
        </>}>
        <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 220, width: "100%" }} />
      </SheetScaffold>
    </Modal>
  );
}

// MARK: - 状态

export function EmptyStateView({ symbol, title, message, actionTitle, action, style }: { symbol: string; title: string; message: string; actionTitle?: string; action?: () => void; style?: CSSProperties }) {
  return (
    <div className="col appear" style={{ alignItems: "center", gap: 12, padding: 40, width: "100%", ...style }}>
      <span className="empty-ic"><Icon name={symbol} size={22} /></span>
      <div className="col gap4" style={{ alignItems: "center", maxWidth: 380, textAlign: "center" }}>
        <div className="t-section">{title}</div>
        <div className="muted">{message}</div>
      </div>
      {actionTitle && action && <Button kind="primary" size="small" onClick={action} style={{ marginTop: 4 }}>{actionTitle}</Button>}
    </div>
  );
}

export function ErrorStateView({ title, message, retryTitle = "重试", retry }: { title: string; message: string; retryTitle?: string; retry?: () => void }) {
  return (
    <div className="col appear" style={{ alignItems: "center", gap: 12, padding: 40, width: "100%" }}>
      <span className="empty-ic" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icon name="exclamationmark.triangle.fill" size={20} /></span>
      <div className="col gap4" style={{ alignItems: "center", maxWidth: 380, textAlign: "center" }}>
        <div className="t-section">{title}</div>
        <div className="muted">{message}</div>
      </div>
      {retry && <Button size="small" icon="arrow.clockwise" onClick={retry}>{retryTitle}</Button>}
    </div>
  );
}

export const Skeleton = ({ width, height = 12 }: { width?: number | string; height?: number }) =>
  <div className="skeleton" style={{ width: width ?? "100%", height, borderRadius: Math.min(height / 2, 10) }} />;




/** 页头：面包屑 → 大标题 + 右侧操作 → 一行说明 → 数字卡（可选）。所有页面共用。 */
export type PageStat = { label: string; value: number; unit?: string; tone?: "bad" | "warn" | "accent" | "ok"; icon?: string; onClick?: () => void };

export function PageHeader({ title, subtitle, children, stats, scope, crumb }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; stats?: PageStat[]; scope?: string; crumb?: ReactNode }) {
  return (
    <div className="page-head">
      {crumb && <div className="crumb">{crumb}</div>}
      <div className="page-head-row">
        <h1 className="t-page ellipsis grow">{title}</h1>
        {children}
      </div>
      {(subtitle || scope) && <div className="sub">{subtitle ?? `范围：${scope}`}</div>}
      {!!stats?.length && <div style={{ marginTop: 12 }}><Metrics stats={stats} /></div>}
    </div>
  );
}

/** 数字卡：一排等宽小卡，值用大号圆体字；可点的卡去到对应页面。 */
export function Metrics({ stats }: { stats: PageStat[] }) {
  return (
    <div className="metrics">
      {stats.map((st) => {
        const tone = st.tone === "bad" && st.value ? "bad" : st.tone === "warn" && st.value ? "warn" : "";
        const icon = st.icon ?? (tone === "bad" ? "exclamationmark.circle.fill" : tone === "warn" ? "clock" : "checkmark.circle.fill");
        const body = <>
          <span className="v"><Icon name={icon} size={20} /><TweenNumber value={st.value} />{st.unit && <span className="big-unit" style={{ alignSelf: "flex-end", paddingBottom: 6 }}>{st.unit}</span>}</span>
          <span className="t-label">{st.label}</span>
        </>;
        return st.onClick
          ? <button key={st.label} className={`metric ${tone}`} onClick={st.onClick} title={`查看${st.label}`}>{body}</button>
          : <div key={st.label} className={`metric ${tone}`}>{body}</div>;
      })}
    </div>
  );
}

/** 页签：绿色下划线。 */
export function Tabs<V extends string | number>({ tabs, value, onChange }: { tabs: [V, string, number?][]; value: V; onChange: (v: V) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([v, label, count]) => (
        <button key={String(v)} role="tab" aria-selected={v === value} onClick={() => onChange(v)}>
          {label}{count !== undefined && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** 状态横幅：左边立体徽章，右边一句结论和说明。 */
export function Banner({ tone = "ok", icon, title, children, actions }: { tone?: "ok" | "warn" | "bad"; icon?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const [wiggle, setWiggle] = useState(false);
  return (
    <div className={`banner ${tone === "ok" ? "" : tone}`}>
      <button className={`emblem ${tone === "ok" ? "" : tone} ${wiggle ? "wiggle" : ""}`} aria-hidden tabIndex={-1} onClick={() => { setWiggle(false); requestAnimationFrame(() => setWiggle(true)); }} onAnimationEnd={() => setWiggle(false)}>
        <Icon name={icon ?? (tone === "ok" ? "checkmark" : tone === "warn" ? "clock" : "exclamationmark")} size={30} strokeWidth={3} />
      </button>
      <div className="banner-body">
        <div className="t-headline">{title}</div>
        {children && <p>{children}</p>}
      </div>
      {actions}
    </div>
  );
}

/** 卡片：白底 2px 描边，圆角 20。 */
export function Card({ title, action, children, tone, flush, style, className }: { title?: ReactNode; action?: ReactNode; children?: ReactNode; tone?: "amber" | "red" | "blue" | "green-card"; flush?: boolean; style?: CSSProperties; className?: string }) {
  return (
    <section className={`card ${flush ? "flush" : ""} ${tone ?? ""} ${className ?? ""}`} style={style}>
      {(title || action) && <div className={`card-head ${flush ? "pad" : ""}`}>{typeof title === "string" ? <h2 className="t-card">{title}</h2> : title}{action}</div>}
      {children}
    </section>
  );
}

export function ProgressTrack({ value, width = 48 }: { value: number; width?: number }) {
  return <span aria-hidden style={{ display: "block", width, height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden", flex: "none" }}>
    <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: value >= 1 ? "var(--green)" : "var(--amber)", borderRadius: 4 }} />
  </span>;
}
