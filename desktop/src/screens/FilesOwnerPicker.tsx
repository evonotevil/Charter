import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FilesScope } from "../state/filesBrowse";
import { Avatar, JurisdictionBadge, Popover } from "../ui/kit";
import { Icon } from "../ui/Icon";

export type { FilesScope } from "../state/filesBrowse";

export interface FilesOwnerOption {
  id: string;
  kind: "company" | "person";
  name: string;
  count: number;
  code?: string;
  tint?: CSSProperties;
}

export interface FilesOwnerPickerProps {
  value: FilesScope;
  onChange: (value: FilesScope) => void;
  /** 清除具体归属时回到调用方记住的上一个大范围；未提供时回到全部归属。 */
  onClear?: () => void;
  owners: ReadonlyArray<FilesOwnerOption>;
}

interface ScopeOption {
  value: FilesScope;
  label: string;
  count: number;
  owner?: FilesOwnerOption;
}

const labelForScope = (value: FilesScope, owners: ReadonlyArray<FilesOwnerOption>) => {
  if (value === "all") return "全部归属";
  if (value === "company") return "所有公司";
  if (value === "person") return "所有人员";
  const [kind, id] = value.split(":");
  return owners.find((owner) => owner.kind === kind && owner.id === id)?.name ?? "全部归属";
};

const OwnerLead = ({ owner }: { owner: FilesOwnerOption }) => owner.kind === "company"
  ? <JurisdictionBadge code={owner.code ?? [...owner.name].slice(0, 2).join("")} size={25} tint={owner.tint} />
  : <Avatar name={owner.name} size={25} />;

export function FilesOwnerPicker({ value, onChange, onClear, owners }: FilesOwnerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listID = useId();

  const companyCount = useMemo(() => owners.filter((owner) => owner.kind === "company").reduce((sum, owner) => sum + owner.count, 0), [owners]);
  const personCount = useMemo(() => owners.filter((owner) => owner.kind === "person").reduce((sum, owner) => sum + owner.count, 0), [owners]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const basics: ScopeOption[] = [
    { value: "all", label: "全部归属", count: companyCount + personCount },
    { value: "company", label: "所有公司", count: companyCount },
    { value: "person", label: "所有人员", count: personCount },
  ];
  const matches = (label: string, code?: string) => !normalizedQuery
    || label.toLocaleLowerCase().includes(normalizedQuery)
    || code?.toLocaleLowerCase().includes(normalizedQuery);
  const basicOptions = basics.filter((option) => matches(option.label));
  const companyOptions = owners.filter((owner) => owner.kind === "company" && matches(owner.name, owner.code))
    .map((owner): ScopeOption => ({ value: `company:${owner.id}`, label: owner.name, count: owner.count, owner }));
  const personOptions = owners.filter((owner) => owner.kind === "person" && matches(owner.name))
    .map((owner): ScopeOption => ({ value: `person:${owner.id}`, label: owner.name, count: owner.count, owner }));
  const flat = [...basicOptions, ...companyOptions, ...personOptions];
  const concrete = value.includes(":");

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }, []);
  const closeFromPopover = useCallback(() => {
    const activePopupControl = search.current;
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => {
      // Esc 后焦点仍在即将卸载的输入框（或 body），需要回到触发器；
      // 外部点击会先把焦点交给目标控件，不应再抢回来。
      if (document.activeElement === activePopupControl || document.activeElement === document.body) {
        trigger.current?.focus({ preventScroll: true });
      }
    });
  }, []);
  const pick = (next: FilesScope) => {
    onChange(next);
    close(true);
  };
  const clear = () => {
    if (onClear) onClear(); else onChange("all");
    close(true);
  };
  const show = () => {
    setOpen(true);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const current = flat.findIndex((option) => option.value === value);
    setHighlighted(Math.max(0, current));
    requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
  }, [open, value]);
  useEffect(() => { setHighlighted(0); }, [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-files-owner-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => Math.min(Math.max(0, flat.length - 1), current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && flat[highlighted]) {
      event.preventDefault();
      pick(flat[highlighted].value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  let optionIndex = -1;
  const renderOption = (option: ScopeOption) => {
    optionIndex += 1;
    const index = optionIndex;
    const selected = option.value === value;
    return (
      <button key={option.value} type="button" role="option" aria-selected={selected} tabIndex={-1}
        id={`${listID}-${index}`} data-files-owner-index={index} className={`files-owner-option ${index === highlighted ? "is-highlighted" : ""} ${selected ? "is-selected" : ""}`}
        onMouseMove={() => setHighlighted(index)} onClick={() => pick(option.value)}>
        {option.owner && <OwnerLead owner={option.owner} />}
        <span className="files-owner-option-name">{option.label}</span>
        <span className="files-owner-option-count num">{option.count} 份</span>
        {selected && <Icon name="checkmark" size={13} />}
      </button>
    );
  };

  return (
    <span className="files-owner-picker">
      <span className={`files-owner-trigger-shell ${open ? "is-open" : ""}`}>
        <button ref={trigger} type="button" className="files-owner-trigger" aria-haspopup="listbox" aria-expanded={open}
          aria-label={`归属：${labelForScope(value, owners)}`} onClick={() => open ? close() : show()}
          onKeyDown={(event) => {
            if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(); }
            else if (!open && concrete && (event.key === "Backspace" || event.key === "Delete")) { event.preventDefault(); clear(); }
          }}>
          <span className="files-owner-trigger-label">归属</span>
          <span className="files-owner-trigger-value">{labelForScope(value, owners)}</span>
          <Icon name="chevron.down" size={11} className="muted" />
        </button>
        {concrete && <button type="button" className="files-owner-clear" aria-label="清除具体归属" title="查看之前的归属范围"
          onClick={clear}><Icon name="xmark" size={11} /></button>}
      </span>
      <Popover anchor={trigger} open={open} onClose={closeFromPopover} minWidth={340} style={{ maxWidth: "min(420px, calc(100vw - 24px))" }}>
        <div className="files-owner-popover" onKeyDown={onKeyDown}>
          <label className="search files-owner-search">
            <Icon name="magnifyingglass" size={13} />
            <input ref={search} className="field" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索公司或人员" aria-label="搜索归属" role="combobox" aria-expanded="true"
              aria-controls={listID} aria-activedescendant={flat[highlighted] ? `${listID}-${highlighted}` : undefined} />
          </label>
          <div ref={list} id={listID} className="files-owner-options" role="listbox" aria-label="文件归属">
            {basicOptions.map(renderOption)}
            {!!companyOptions.length && <><div className="files-owner-options-divider" /><div className="files-owner-options-heading">公司</div>{companyOptions.map(renderOption)}</>}
            {!!personOptions.length && <><div className="files-owner-options-divider" /><div className="files-owner-options-heading">人员</div>{personOptions.map(renderOption)}</>}
            {!flat.length && <span className="files-owner-empty">没有匹配“{query.trim()}”的归属</span>}
          </div>
        </div>
      </Popover>
    </span>
  );
}
