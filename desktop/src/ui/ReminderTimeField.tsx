import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import "./reminderTimeField.css";

const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  return `${String(hour).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
});

export type ReminderTimeValidation = { time: string | null; message: string | null };

export function validateReminderTime(text: string): ReminderTimeValidation {
  const source = text.trim();
  if (!/^(?:\d{4}|\d{2}:\d{2})$/.test(source)) {
    return { time: null, message: "请输入 4 位时间，例如 08:25。" };
  }
  const compact = source.replace(":", "");
  const hour = Number(compact.slice(0, 2));
  const minute = Number(compact.slice(2));
  if (hour > 23) return { time: null, message: "小时须为 00–23。" };
  if (minute > 59) return { time: null, message: "分钟须为 00–59。" };
  if (minute % 5 !== 0) return { time: null, message: "分钟须为 5 的倍数。" };
  return { time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, message: null };
}

function normalizeTime(text: string) {
  return validateReminderTime(text).time;
}

function minutesOf(text: string) {
  const normalized = normalizeTime(text);
  if (!normalized) return null;
  return Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(3));
}

function nearbyIndex(text: string) {
  const minutes = minutesOf(text);
  return minutes == null ? 0 : Math.max(0, Math.min(47, Math.round(minutes / 30)));
}

function exactOptionIndex(text: string) {
  return HALF_HOUR_TIMES.indexOf(normalizeTime(text) ?? "");
}

function nextIndex(text: string, direction: -1 | 1) {
  const minutes = minutesOf(text);
  if (minutes == null) return direction > 0 ? 0 : 47;
  const exact = minutes % 30 === 0;
  const index = direction > 0
    ? (exact ? minutes / 30 + 1 : Math.ceil(minutes / 30))
    : (exact ? minutes / 30 - 1 : Math.floor(minutes / 30));
  return Math.max(0, Math.min(47, index));
}

export function ReminderTimeField({ value, onChange, disabled, ariaLabel = "提醒时间" }: {
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const listID = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectOnClick = useRef(false);
  const settling = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [active, setActive] = useState<number | null>(() => {
    const index = exactOptionIndex(value);
    return index < 0 ? null : index;
  });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; side: "top" | "bottom" } | null>(null);

  const exactIndex = useMemo(() => HALF_HOUR_TIMES.indexOf(normalizeTime(draft) ?? ""), [draft]);

  const close = useCallback(() => {
    settling.current = true;
    setOpen(false);
    setDraft(value);
    setInvalid(null);
  }, [value]);

  const begin = useCallback(() => {
    if (disabled) return;
    settling.current = false;
    setDraft(value);
    const index = exactOptionIndex(value);
    setActive(index < 0 ? null : index);
    setInvalid(null);
    setOpen(true);
  }, [disabled, value]);

  const commit = useCallback((text: string) => {
    if (settling.current) return true;
    const result = validateReminderTime(text);
    if (!result.time) {
      setInvalid(result.message);
      return false;
    }
    settling.current = true;
    onChange(result.time);
    setDraft(result.time);
    setInvalid(null);
    setOpen(false);
    return true;
  }, [onChange]);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open || !selectOnClick.current) return;
    inputRef.current?.select();
    selectOnClick.current = false;
  }, [open]);

  useEffect(() => {
    if (disabled && open) close();
  }, [close, disabled, open]);

  useLayoutEffect(() => {
    if (!open) return;
    let mounted = true;
    const place = () => {
      if (!mounted) return;
      const anchor = inputRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(152, box.width), window.innerWidth - 24);
      const height = menu?.offsetHeight ?? 218;
      const below = box.bottom + 4;
      const side = below + height <= window.innerHeight - 12 ? "bottom" : "top";
      const top = side === "bottom" ? below : Math.max(12, box.top - height - 4);
      const left = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
      setPosition((current) => current?.left === left && current.top === top && current.width === width && current.side === side
        ? current : { left, top, width, side });
    };
    const layoutChanged = (event: Event) => {
      if (event.target instanceof Element && event.target.contains(inputRef.current)) place();
    };
    const scroll = (event: Event) => {
      if (event.target !== menuRef.current) place();
    };
    place();
    const frame = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    if (inputRef.current) observer.observe(inputRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("animationend", layoutChanged, true);
    document.addEventListener("transitionend", layoutChanged, true);
    void document.fonts.ready.then(place);
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("animationend", layoutChanged, true);
      document.removeEventListener("transitionend", layoutChanged, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const option = optionRefs.current[active ?? nearbyIndex(draft)];
    const menu = menuRef.current;
    if (option && menu) menu.scrollTop = option.offsetTop - (menu.clientHeight - option.offsetHeight) / 2;
  }, [active, draft, open]);

  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if (!commit(draft)) {
        event.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", pointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
    };
  }, [commit, draft, open]);

  const move = (direction: -1 | 1) => {
    // Enter / Escape 会结束上一轮编辑，但输入框仍可能保持焦点。
    // 用户不重新点击、直接继续用方向键时，应开始一轮新的提交。
    settling.current = false;
    const index = nextIndex(draft, direction);
    setActive(index);
    setDraft(HALF_HOUR_TIMES[index]);
    setInvalid(null);
    if (!open) setOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActive(0);
      setDraft(HALF_HOUR_TIMES[0]);
      setInvalid(null);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActive(47);
      setDraft(HALF_HOUR_TIMES[47]);
      setInvalid(null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      inputRef.current?.select();
    }
  };

  return (
    <>
      <span className="reminder-time-field">
        <input
          ref={inputRef}
          className="field reminder-time-input"
          value={open ? draft : value}
          disabled={disabled}
          inputMode="numeric"
          maxLength={5}
          autoComplete="off"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listID : undefined}
          aria-activedescendant={open && active != null ? `${listID}-${active}` : undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${listID}-error` : undefined}
          onPointerDown={(event) => {
            if (open) return;
            event.preventDefault();
            selectOnClick.current = true;
            begin();
            event.currentTarget.focus({ preventScroll: true });
          }}
          onFocus={() => {
            if (!open) {
              selectOnClick.current = true;
              begin();
            }
          }}
          onClick={() => {
            if (!open) {
              selectOnClick.current = true;
              begin();
            }
          }}
          onChange={(event) => {
            // 同上：提交后继续直接键入，不依赖一次额外的失焦/点击来 re-arm。
            settling.current = false;
            const next = event.target.value;
            setDraft(next);
            const index = exactOptionIndex(next);
            setActive(index < 0 ? null : index);
            setInvalid(null);
            if (!open) setOpen(true);
          }}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && menuRef.current?.contains(event.relatedTarget)) return;
            if (!settling.current) commit(draft);
          }}
          onKeyDown={onKeyDown}
        />
        <span className={`reminder-time-chevron ${open ? "open" : ""}`}><Icon name="chevron.down" size={11} /></span>
        {invalid && <span id={`${listID}-error`} className="reminder-time-error" role="alert">{invalid}</span>}
      </span>
      {open && createPortal(
        <div
          ref={menuRef}
          id={listID}
          className="reminder-time-menu"
          data-side={position?.side ?? "bottom"}
          role="listbox"
          aria-label="常用提醒时间"
          style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, width: position?.width }}
        >
          {HALF_HOUR_TIMES.map((time, index) => (
            <button
              key={time}
              ref={(node) => { optionRefs.current[index] = node; }}
              id={`${listID}-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={exactIndex === index}
              className={`reminder-time-option ${active === index ? "active" : ""}`}
              onClick={() => commit(time)}
            >{time}</button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

