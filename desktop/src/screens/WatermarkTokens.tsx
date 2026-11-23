import { useLayoutEffect, useRef, useState } from "react";
import { WM_TAGS, tagLabel, type WMPart } from "../services/watermark";
import { Icon } from "../ui/Icon";
import { Button, MenuList, Popover, PopoverRow, TextField } from "../ui/kit";
import { useWatermarkTokenDrag } from "./useWatermarkTokenDrag";
import "./watermarkTokens.css";

const icons = {
  date: "calendar", file: "doc.text", company: "building.2", packet: "shippingbox", recipient: "person.crop.circle",
};
const label = (part: WMPart) => part.kind === "tag" ? tagLabel(part.tag) : part.text;

export function WatermarkTokens({ parts, onChange }: { parts: WMPart[]; onChange: (parts: WMPart[]) => void }) {
  const drag = useWatermarkTokenDrag(parts, onChange);
  // 同一个字段或自定义文字允许重复；显示名称和排列位置都不能作为 React key。
  const keys = useRef(new WeakMap<WMPart, number>());
  const nextKey = useRef(0);
  const keyFor = (part: WMPart) => {
    let key = keys.current.get(part);
    if (key === undefined) { key = nextKey.current++; keys.current.set(part, key); }
    return key;
  };
  const [draft, setDraft] = useState("");
  const [newPart, setNewPart] = useState<WMPart | null>(null);
  const [inserting, setInserting] = useState(false);
  const insertAnchor = useRef<HTMLSpanElement>(null);
  const [menuPart, setMenuPart] = useState<WMPart | null>(null);
  const menuIndex = menuPart ? parts.indexOf(menuPart) : -1;
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const menuBody = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    restoreFocus.current?.focus({ preventScroll: true });
    restoreFocus.current = null;
  }, [parts]);
  useLayoutEffect(() => {
    if (drag.dragIndex !== null) setMenuPart(null);
  }, [drag.dragIndex]);
  useLayoutEffect(() => {
    if (menuIndex >= 0) menuBody.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus({ preventScroll: true });
  }, [menuPart, menuIndex]);

  const append = (part: WMPart) => { setNewPart(part); onChange([...parts, part]); };
  const addText = () => {
    if (draft.trim()) { append({ kind: "text", text: draft.trim() }); setDraft(""); }
  };
  const remove = (index: number) => {
    const next = index + 1 < parts.length ? index + 1 : index - 1;
    restoreFocus.current = drag.containerRef.current?.querySelector<HTMLButtonElement>(`[data-wm-index="${next}"] .wm-token-main`)
      ?? insertAnchor.current?.querySelector("button") ?? null;
    setMenuPart(null);
    onChange(parts.filter((_, i) => i !== index));
  };
  const move = (from: number, delta: number, trigger: HTMLButtonElement | null) => {
    const to = from + delta;
    if (from < 0 || to < 0 || to >= parts.length) return;
    restoreFocus.current = trigger;
    setMenuPart(null);
    drag.move(from, to);
  };
  const closeMenu = () => {
    if (menuBody.current?.contains(document.activeElement)) menuAnchor.current?.focus({ preventScroll: true });
    setMenuPart(null);
  };

  return <div className="col gap8">
    <div ref={drag.containerRef} className="wm-tokens" role="group" aria-label="水印文字组成" onClickCapture={drag.onClickCapture}>
      {drag.order.map((i) => {
        const part = parts[i], name = label(part);
        return <span key={keyFor(part)} data-wm-index={i}
          className={`wm-token-wrap wm-token ${part.kind}${drag.dragIndex === i ? " is-dragging" : ""}${newPart === part ? " fresh" : ""}`}
          onAnimationEnd={() => { if (newPart === part) setNewPart(null); }}>
          <button className="wm-token-main" type="button" aria-haspopup="dialog" aria-expanded={menuPart === part}
            aria-label={`${name}，第 ${i + 1} 个，点按移动`} title={name}
            onPointerDown={(e) => drag.onPointerDown(e, i)}
            onClick={(e) => { menuAnchor.current = e.currentTarget; setMenuPart(menuPart === part ? null : part); }}
            onKeyDown={(e) => {
              if (drag.dragIndex !== null) return;
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault(); move(i, e.key === "ArrowLeft" ? -1 : 1, e.currentTarget);
              } else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(i); }
            }}>
            {part.kind === "tag" && <Icon name={icons[part.tag]} size={14} />}
            <span className="ellipsis">{name}</span>
          </button>
          <button type="button" className="wm-token-remove" aria-label={`移除 ${name}`} data-tip="移除" onClick={() => remove(i)}>
            <Icon name="xmark" size={12} />
          </button>
        </span>;
      })}
      {!parts.length && <span className="t-meta muted">添加标签或文字</span>}
    </div>

    <Popover anchor={menuAnchor} open={menuIndex >= 0 && drag.dragIndex === null} onClose={closeMenu} minWidth={196}>
      <div className="wm-move-menu" ref={menuBody} aria-label="移动水印标签" onKeyDown={(e) => {
        if (e.key === "Tab") { closeMenu(); return; }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          move(menuIndex, e.key === "ArrowLeft" ? -1 : 1, menuAnchor.current);
          return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const options = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }}>
        <PopoverRow title="向前移一位" trailing="←" disabled={menuIndex <= 0} onClick={() => move(menuIndex, -1, menuAnchor.current)} />
        <PopoverRow title="向后移一位" trailing="→" disabled={menuIndex >= parts.length - 1} onClick={() => move(menuIndex, 1, menuAnchor.current)} />
      </div>
    </Popover>
    <div className="row gap8">
      <span ref={insertAnchor} style={{ display: "inline-flex" }}><Button size="small" icon="plus" onClick={() => setInserting(true)}>插入标签</Button></span>
      <TextField value={draft} onChange={setDraft} placeholder="自定义文字，回车添加" onEnter={addText} style={{ flex: 1, minWidth: 0 }} />
      <Button size="small" disabled={!draft.trim()} onClick={addText}>添加</Button>
    </div>
    <Popover anchor={insertAnchor} open={inserting} onClose={() => setInserting(false)} minWidth={180}>
      <MenuList close={() => setInserting(false)} entries={WM_TAGS.map(([tag, title]) => ({ kind: "item" as const, title, action: () => append({ kind: "tag", tag }) }))} />
    </Popover>
  </div>;
}
