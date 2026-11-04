// 5.4.2：全应用统一的悬停提示，替代系统原生 title（原生提示要等一两秒、样式不统一）。
// - 读 data-tip；元素上的 title 会在第一次悬停时自动转成 data-tip（并补 aria-label / aria-description，读屏不丢信息）。
// - 悬停约 400ms 出现；键盘聚焦（:focus-visible）也会出现；按下、滚动、Esc、离开即消失。
// - 默认在元素上方，放不下就放到下方，左右不超出窗口。
// 另外负责一件和弹层相关的事：有弹层或对话框打开时给 <html> 加 overlay-open，暂停窗口拖动区域，
// 否则 Electron 的拖动区会盖过弹层，点不到弹层里的按钮。

const DELAY = 400;
const GAP = 6;

let tip: HTMLDivElement | null = null;
let timer = 0;
let target: HTMLElement | null = null;

function adopt(el: HTMLElement) {
  const t = el.getAttribute("title");
  if (t === null) return;
  el.removeAttribute("title");
  if (!t.trim()) return;
  el.dataset.tip = t;
  // 原来 title 也是读屏的名字或说明：没有可读文字时补成名字，否则补成说明
  if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el.textContent ?? "").trim()) el.setAttribute("aria-label", t);
  else if (!el.getAttribute("aria-description") && el.getAttribute("aria-label") !== t) el.setAttribute("aria-description", t);
}

function find(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof Element ? (node as HTMLElement) : null;
  while (el && el !== document.body) {
    if (el.hasAttribute("title")) adopt(el);
    if (el.dataset?.tip) return el;
    el = el.parentElement;
  }
  return null;
}

function hide() {
  window.clearTimeout(timer);
  target = null;
  if (tip) tip.hidden = true;
}

function show(el: HTMLElement) {
  if (!el.isConnected || !el.dataset.tip) return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true"); // 读屏已通过 aria-label / aria-description 读到，不重复
    document.body.appendChild(tip);
  }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = "0px"; tip.style.top = "0px";
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = r.top - h - GAP, side = "top";
  if (top < 4) { top = r.bottom + GAP; side = "bottom"; }
  if (top + h > vh - 4) top = Math.max(4, vh - h - 4);
  const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), vw - w - 4);
  tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(top)}px`;
  tip.dataset.side = side;
}

function schedule(el: HTMLElement) {
  if (el === target) return;
  hide();
  target = el;
  timer = window.setTimeout(() => show(el), DELAY);
}

export function installTooltips() {
  document.addEventListener("pointerover", (e) => {
    const el = find(e.target);
    if (el) schedule(el); else if (target && !(e.target instanceof Node && target.contains(e.target))) hide();
  }, true);
  document.addEventListener("pointerout", (e) => {
    if (target && !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) hide();
  }, true);
  document.addEventListener("focusin", (e) => {
    const el = find(e.target);
    if (el && (e.target as HTMLElement).matches?.(":focus-visible")) schedule(el);
  }, true);
  document.addEventListener("focusout", hide, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tip && !tip.hidden) hide(); }, true);

  // 弹层或对话框打开时暂停窗口拖动区域
  const sync = () => document.documentElement.classList.toggle("overlay-open", !!document.querySelector(".popover:not(.ghost-out), .overlay:not(.ghost-out)"));
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  sync();
}
