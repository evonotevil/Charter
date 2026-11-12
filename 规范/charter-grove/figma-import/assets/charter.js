/* @ds-bundle: {"format":4,"namespace":"Charter","components":[{"name":"Icon"},{"name":"Button"},{"name":"Avatar"},{"name":"StatusPill"},{"name":"Sidebar"},{"name":"AppBar"},{"name":"PageHeading"},{"name":"HealthBanner"},{"name":"ProgressSegments"},{"name":"MetricTile"},{"name":"SearchField"},{"name":"Field"},{"name":"ViewToggle"},{"name":"Tabs"},{"name":"Card"},{"name":"EntityTable"},{"name":"EntitySnapshot"},{"name":"FactGrid"},{"name":"PeopleTable"},{"name":"DocumentList"},{"name":"NextUpCard"},{"name":"HorizonList"},{"name":"AuditNote"},{"name":"InfoNote"},{"name":"DeviceRow"},{"name":"Toggle"},{"name":"ChoiceCard"},{"name":"ActivityList"},{"name":"StructureChart"},{"name":"FilingTimeline"},{"name":"Celebration"},{"name":"DropZone"},{"name":"UploadRow"},{"name":"ProcessSteps"},{"name":"EmptyState"},{"name":"Toast"},{"name":"Dialog"}]} */
(function () {
  var R = window.React, h = R.createElement, F = R.Fragment;
  var useState = R.useState, useRef = R.useRef, useLayoutEffect = R.useLayoutEffect, useEffect = R.useEffect;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /* ---------- 图标：24 网格、2px 描边、圆角端点（与初稿的 Lucide 风格一致） ---------- */
  var P = {
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    "calendar-clock": "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.3V14M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
    folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    sync: "M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16M8 16H3v5",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    shield: "M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4",
    building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4",
    landmark: "M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z",
    badge: "M3.9 8.6a2 2 0 0 1 1.3-2.4l1-.4a2 2 0 0 0 1.2-1.2l.4-1a2 2 0 0 1 2.4-1.3l1 .3a2 2 0 0 0 1.6 0l1-.3a2 2 0 0 1 2.4 1.3l.4 1a2 2 0 0 0 1.2 1.2l1 .4a2 2 0 0 1 1.3 2.4l-.3 1a2 2 0 0 0 0 1.6l.3 1a2 2 0 0 1-1.3 2.4l-1 .4a2 2 0 0 0-1.2 1.2l-.4 1a2 2 0 0 1-2.4 1.3l-1-.3a2 2 0 0 0-1.6 0l-1 .3a2 2 0 0 1-2.4-1.3l-.4-1a2 2 0 0 0-1.2-1.2l-1-.4a2 2 0 0 1-1.3-2.4l.3-1a2 2 0 0 0 0-1.6zM9 12l2 2 4-4",
    cloud: "M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9zM9 14l2 2 4-4",
    "cloud-off": "M2 2l20 20M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2M21.5 15.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10.2 5.1",
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
    help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
    plus: "M12 5v14M5 12h14", "arrow-right": "M5 12h14M12 5l7 7-7 7", "arrow-left": "M19 12H5M12 19l-7-7 7-7",
    "chevron-right": "M9 18l6-6-6-6", "chevron-down": "M6 9l6 6 6-6", "chevrons-ud": "M7 15l5 5 5-5M7 9l5-5 5 5",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3", download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12", pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01", file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8",
    history: "M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8M3 3v5h5M12 7v5l4 2", laptop: "M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.3 2.6a1 1 0 0 1-.9 1.4H3.6a1 1 0 0 1-.9-1.4L4 16",
    monitor: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4", more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    "check-check": "M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16", check: "M20 6 9 17l-5-5", compare: "M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 19h5a2 2 0 0 0 2-2V7M13 5H8a2 2 0 0 0-2 2v10M14 22l-3-3 3-3M10 2l3 3-3 3",
    "wifi-off": "M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8a15 15 0 0 0-11.3-3.7M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.4-1.7M2 2l20 20",
    tree: "M9 3h6v4H9zM3 17h6v4H3zM15 17h6v4h-6zM12 7v5M6 17v-5h12v5", alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2", sparkle: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z", x: "M18 6 6 18M6 6l12 12",
    "zoom-in": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6", "zoom-out": "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6", fit: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
    replay: "M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8M3 3v5h5", trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"
  };
  function Icon(p) {
    var s = p.size || 18;
    return h("svg", { className: cx("g-icon", p.className), width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: p.strokeWidth || 2, strokeLinecap: "round", strokeLinejoin: "round", style: p.style,
      "aria-hidden": p.label ? undefined : true, role: p.label ? "img" : undefined, "aria-label": p.label }, h("path", { d: P[p.name] || P.more }));
  }

  /* ---------- 按钮：按下下沉 4px，松开回弹 ---------- */
  function Button(p) {
    var v = p.variant || "secondary", only = p.icon && !p.children;
    var st = useState(false);
    function up() { if (v === "quiet" || reduced()) return; st[1](false); requestAnimationFrame(function () { st[1](true); }); }
    return h("button", { type: p.type || "button", className: cx("g-btn", v, p.size === "sm" && "sm", only && "icon", st[0] && "release", p.className),
      disabled: p.disabled || p.loading, onClick: p.onClick, onPointerUp: up, onAnimationEnd: function () { st[1](false); },
      title: p.title || (only ? p.label : undefined), "aria-label": only ? p.label : undefined, "aria-busy": p.loading || undefined, style: p.style },
      p.loading ? h("span", { className: "g-spin", "aria-hidden": true }) : p.icon ? h(Icon, { name: p.icon, size: p.size === "sm" ? 16 : 17 }) : null, p.children);
  }

  /* ---------- 头像与徽章 ---------- */
  function Avatar(p) {
    var s = p.size || 36;
    return h("span", { className: cx("g-avatar", p.tone || "neutral", p.round && "round"), "aria-hidden": p.label ? undefined : true, title: p.label,
      style: { width: s, height: s, fontSize: Math.round(s * .36), borderRadius: p.round ? "50%" : undefined } }, p.text);
  }

  /* ---------- 状态胶囊 ---------- */
  var STATUS = {
    ok: ["ok", "dot", "正常"], active: ["ok", "dot", "存续"], done: ["ok", "check", "已完成"], held: ["ok", "check", "已归档"], verified: ["ok", "badge", "已核实"],
    soon: ["warn", "dot", "快到期"], progress: ["warn", "clock", "办理中"], review: ["warn", "dot", "待核实"], conflict: ["warn", "compare", "有冲突"],
    overdue: ["bad", "alert", "逾期"], expired: ["bad", "alert", "已过期"],
    todo: ["outline", "dot", "待办理"], missing: ["outline", "dot", "待取得"], na: ["neutral", "dot", "不适用"], offline: ["neutral", "dot", "离线"], device: ["info", "dot", "本机"]
  };
  function StatusPill(p) {
    var s = STATUS[p.status] || STATUS.ok;
    return h("span", { className: cx("g-pill", s[0]), title: p.title }, s[1] === "dot" ? h("span", { className: "dot", "aria-hidden": true }) : h(Icon, { name: s[1], size: 12, strokeWidth: 2.6 }), p.children || s[2]);
  }

  /* ---------- 侧栏 ---------- */
  function Sidebar(p) {
    var st = useState(p.active), act = st[0];
    function item(it) {
      return h("button", { key: it.key, type: "button", className: "g-nav-item", "aria-current": it.key === act ? "page" : undefined, onClick: function () { st[1](it.key); } },
        h(Icon, { name: it.icon, size: 19 }), it.label, it.badge ? h("span", { className: cx("badge", it.badgeTone === "bad" && "bad"), "aria-label": it.badge + " 件需要处理" }, it.badge) : null);
    }
    return h("nav", { className: "g-side", "aria-label": "主导航", style: p.style },
      h("div", { className: "g-brand" }, h("span", { className: "g-mark", "aria-hidden": true }, "C"), h("span", { className: "g-wordmark" }, "Charter")),
      h("button", { type: "button", className: "g-switcher" }, h(Avatar, { text: p.org ? p.org.slice(0, 1) : "远", tone: "purple", size: 32 }),
        h("span", { style: { flex: 1, minWidth: 0 } }, h("span", { className: "g-ellipsis", style: { display: "block", fontWeight: 800, fontSize: 12 } }, p.org || "远澜集团"), h("span", { className: "g-small", style: { fontSize: 11 } }, p.orgMeta || "本机档案")),
        h(Icon, { name: "chevrons-ud", size: 14, style: { color: "var(--muted)" } })),
      h("div", { className: "g-nav" }, (p.items || []).map(item)),
      p.more ? h("div", { className: "g-nav" }, h("div", { className: "g-label", style: { padding: "0 4px" } }, "工作区"), p.more.map(item)) : null,
      h("div", { style: { flex: 1 } }),
      h("div", { className: "g-trust" }, h(Icon, { name: "shield", size: 24 }), h("div", { className: "g-subtitle" }, "安心一点。"), h("p", null, "档案只保存在你的电脑和你的 iCloud 里。")),
      h("div", { className: "g-row", style: { gap: 10, flexWrap: "nowrap" } }, h(Avatar, { text: "林", tone: "amber", size: 36, round: true }),
        h("div", null, h("div", { style: { fontWeight: 700, fontSize: 12 } }, p.user || "林嘉禾"), h("div", { className: "g-small", style: { fontSize: 11 } }, "法务")))); }

  /* ---------- 顶栏 ---------- */
  function AppBar(p) {
    return h("header", { className: "g-appbar" },
      h("div", { className: "g-row g-small", style: { gap: 10 } }, h(Icon, { name: "building", size: 17 }), p.context || "远澜集团  /  法务档案"),
      h("div", { className: "g-row", style: { gap: 22 } },
        h("span", { className: cx("g-sync", p.offline && "off") }, h(Icon, { name: p.offline ? "cloud-off" : "cloud", size: 18 }), p.offline ? "离线 · 改动会在联网后同步" : "已同步到 iCloud"),
        h("span", { className: "g-small g-num" }, p.date || "2026-10-21"),
        h(Button, { variant: "quiet", size: "sm", icon: "bell", label: "提醒" }), h(Button, { variant: "quiet", size: "sm", icon: "help", label: "帮助" })));
  }

  /* ---------- 页面标题 ---------- */
  function PageHeading(p) {
    return h("div", { className: "g-pagehead" },
      p.crumb ? h("div", { className: "g-crumb" }, p.crumb) : null,
      h("div", { className: "top" }, h("h1", { className: "g-display" }, p.title), p.actions ? h("div", { className: "g-row", style: { gap: 10 } }, p.actions) : null),
      p.subtitle ? h("div", { style: { color: "var(--muted)", fontSize: 14 } }, p.subtitle) : null);
  }

  /* ---------- 进度段、状态横幅 ---------- */
  function ProgressSegments(p) {
    var st = useState(p.animate ? [] : p.segments);
    useEffect(function () { if (!p.animate) { st[1](p.segments); return; } st[1]([]); var i = 0; var t = setInterval(function () { i++; st[1](p.segments.slice(0, i)); if (i >= p.segments.length) clearInterval(t); }, reduced() ? 0 : 90); return function () { clearInterval(t); }; }, [JSON.stringify(p.segments), p.animate]);
    return h("div", { className: "g-segs", role: "img", "aria-label": p.label }, p.segments.map(function (s, i) {
      var shown = st[0][i];
      return h("span", { key: i, className: cx("g-seg", shown ? s : "empty " + s) }, h("i"));
    }));
  }
  function HealthBanner(p) {
    var tone = p.tone || "ok";
    return h("section", { className: cx("g-banner", tone !== "ok" && tone) },
      h("span", { className: cx("g-emblem", tone !== "ok" && tone, p.wiggle && "wiggle"), "aria-hidden": true }, h(Icon, { name: p.icon || (tone === "ok" ? "shield" : "alert"), size: 34 })),
      h("div", { className: "g-banner-body" }, h("h2", { className: "g-headline" }, p.title), h("p", null, p.body), p.segments ? h(ProgressSegments, { segments: p.segments, label: p.segmentsLabel, animate: p.animateSegments }) : null, p.foot ? h("div", { className: "g-small" }, p.foot) : null),
      p.action || null);
  }

  /* ---------- 数字卡 ---------- */
  function MetricTile(p) {
    var Tag = p.onClick || p.button ? "button" : "div";
    return h(Tag, { className: cx("g-metric", p.tone), type: Tag === "button" ? "button" : undefined, onClick: p.onClick },
      h("span", { className: "v" }, p.value, p.icon ? h(Icon, { name: p.icon, size: 20 }) : null),
      h("span", { style: { fontWeight: 700 } }, p.label), h("span", { className: "g-small" }, p.hint));
  }

  /* ---------- 输入 ---------- */
  function SearchField(p) {
    return h("label", { className: "g-search", style: p.style }, h(Icon, { name: "search", size: 16 }),
      h("input", { className: "g-input", type: "search", placeholder: p.placeholder, "aria-label": p.placeholder, defaultValue: p.value }));
  }
  var fid = 0;
  function Field(p) {
    var id = useRef("gf-" + (++fid)).current;
    return h("div", { className: "g-field" }, h("label", { className: "g-label", htmlFor: id }, p.label),
      p.options ? h("select", { id: id, className: "g-input", defaultValue: p.value }, p.options.map(function (o) { return h("option", { key: o }, o); }))
        : h("input", { id: id, className: cx("g-input", p.error && "invalid"), defaultValue: p.value, placeholder: p.placeholder, "aria-invalid": p.error ? true : undefined }),
      p.detected ? h("span", { className: "g-detected" }, h(Icon, { name: "sparkle", size: 13 }), p.detected) : null,
      p.error ? h("span", { className: "g-error" }, p.error) : p.hint ? h("span", { className: "g-small" }, p.hint) : null);
  }
  function ViewToggle(p) {
    var st = useState(p.value || "list");
    return h("div", { className: "g-viewtoggle", role: "group", "aria-label": "显示方式" },
      [["list", "list", "列表"], ["cards", "grid", "卡片"]].map(function (o) {
        return h("button", { key: o[0], type: "button", "aria-pressed": st[0] === o[0], "aria-label": o[2], title: o[2], onClick: function () { st[1](o[0]); } }, h(Icon, { name: o[1], size: 17 }));
      }));
  }

  /* ---------- 页签：下划线滑动 ---------- */
  function Tabs(p) {
    var st = useState(p.value || (p.items[0] && p.items[0].key)), ref = useRef(null), ink = useState({ x: 0, w: 0 });
    useLayoutEffect(function () { var b = ref.current && ref.current.querySelector('[aria-selected="true"]'); if (b) ink[1]({ x: b.offsetLeft, w: b.offsetWidth }); }, [st[0]]);
    return h("div", { className: "g-tabs", role: "tablist", ref: ref, "aria-label": p.label },
      p.items.map(function (t) { return h("button", { key: t.key, role: "tab", type: "button", "aria-selected": st[0] === t.key, onClick: function () { st[1](t.key); } }, t.label, t.count != null ? h("span", { className: "count" }, t.count) : null); }),
      h("span", { className: "g-tabs-ink", "aria-hidden": true, style: { width: ink[0].w, transform: "translateX(" + ink[0].x + "px)" } }));
  }

  /* ---------- 卡片 ---------- */
  function Card(p) {
    return h("section", { className: cx("g-card", p.tone, p.flush && "flush"), style: p.style },
      (p.title || p.link) ? h("div", { className: "g-card-head", style: p.flush ? { padding: "20px 22px" } : undefined },
        h("div", { className: "g-row", style: { gap: 10 } }, h("h2", { className: "g-title" }, p.title), p.badge || null),
        p.link ? h("button", { type: "button", className: "g-link" }, p.link) : p.action || null) : null,
      p.children);
  }

  /* ---------- 公司表 ---------- */
  function EntityTable(p) {
    return h("div", { style: { overflowX: "auto" } }, h("table", { className: "g-table", "aria-label": p.label || "公司" },
      h("thead", null, h("tr", null, ["公司", "法域", "合规", "下一件事", "负责中介", ""].map(function (t, i) { return h("th", { key: i, scope: "col" }, t); }))),
      h("tbody", null, (p.rows || []).map(function (r, i) {
        return h("tr", { key: i, tabIndex: 0, "aria-selected": r.selected || undefined },
          h("td", { style: { minWidth: 280 } }, h("div", { className: "g-row", style: { flexWrap: "nowrap", gap: 12 } }, h(Avatar, { text: r.code, tone: r.tone || "green", size: 38 }),
            h("div", { style: { minWidth: 0 } }, h("div", { className: "g-strong g-clamp2", title: r.name }, r.name), h("div", { className: "g-small" }, r.reg)))),
          h("td", null, h("div", null, r.place), h("div", { className: "g-small" }, r.registry)),
          h("td", null, h(StatusPill, { status: r.status }, r.statusText)),
          h("td", null, h("div", { className: "g-strong g-num", style: { color: r.status === "overdue" ? "var(--red-text)" : r.status === "soon" ? "var(--amber-text)" : undefined } }, r.next), h("div", { className: "g-small" }, r.nextWhat)),
          h("td", null, r.agent ? h(Avatar, { text: r.agent, size: 29, round: true, label: r.agentName }) : h("span", { className: "g-small" }, "未指定")),
          h("td", { style: { width: 40 } }, h(Icon, { name: "chevron-right", size: 18, className: "chev" })));
      }))));
  }

  /* ---------- 公司概况条 ---------- */
  function EntitySnapshot(p) {
    var w = useState(0);
    useEffect(function () { var t = requestAnimationFrame(function () { w[1](p.complete); }); return function () { cancelAnimationFrame(t); }; }, [p.complete]);
    return h("section", { className: "g-snapshot", "aria-label": "公司概况" },
      h("span", { className: "g-avatar green", style: { width: 62, height: 62, borderRadius: 18 }, "aria-hidden": true }, h(Icon, { name: "landmark", size: 30 })),
      h("div", { className: "cell" }, h("span", { className: "g-label" }, "登记状态"), h("span", null, h(StatusPill, { status: p.registry || "active" }))),
      h("div", { className: "cell" }, h("span", { className: "g-label" }, "合规"), h("span", null, h(StatusPill, { status: p.compliance || "soon" }, p.complianceText))),
      h("div", { className: "cell", style: { minWidth: 190 } }, h("span", { className: "g-row", style: { justifyContent: "space-between" } }, h("span", { className: "g-label" }, "档案完整"), h("span", { style: { fontWeight: 800, fontSize: 12, color: "var(--green-text)" } }, p.complete + "%")),
        h("div", { className: "g-bar", role: "img", "aria-label": "档案完整 " + p.complete + "%" }, h("i", { style: { width: w[0] + "%" } }))),
      h("div", { className: "cell", style: { flex: 1 } }, h("span", { className: "g-label" }, "默认中介"), h("span", { style: { fontWeight: 700 } }, p.agent)));
  }

  /* ---------- 字段网格 ---------- */
  function FactGrid(p) {
    return h(F, null,
      p.source ? h("span", { className: "g-source" }, h(Icon, { name: "badge", size: 15 }), p.source) : null,
      h("dl", { className: "g-facts", style: { margin: 0 } }, (p.items || []).map(function (f) {
        var miss = !f.value;
        return h("div", { key: f.label, className: "g-fact" }, h("dt", { className: "g-label" }, f.label), h("dd", { className: cx("v", miss && "missing"), style: { margin: 0 } }, miss ? "未填" : f.value), f.note ? h("dd", { className: "g-small", style: { margin: 0 } }, f.note) : null);
      })));
  }

  /* ---------- 人员 ---------- */
  function PeopleTable(p) {
    return h("div", { className: "g-people", role: "table", "aria-label": "人员与持股" },
      h("div", { className: "h", role: "columnheader" }, "人员"), h("div", { className: "h", role: "columnheader" }, "职务"), h("div", { className: "h", role: "columnheader" }, "持股"),
      (p.rows || []).map(function (r, i) {
        return h(F, { key: i },
          h("div", { className: "c g-row", style: { flexWrap: "nowrap", gap: 10 } }, h(Avatar, { text: r.initial, tone: r.tone || "amber", size: 34 }), h("span", { className: "g-strong g-clamp2", title: r.name }, r.name)),
          h("div", { className: "c" }, r.roles.map(function (x, j) { return h("div", { key: j }, h("span", { style: { fontWeight: 600 } }, x.title), h("span", { className: "g-small" }, "  " + x.since)); })),
          h("div", { className: "c pct" }, r.percent != null ? r.percent + "%" : h("span", { className: "g-small" }, "—")));
      }));
  }

  /* ---------- 文件列表 ---------- */
  function DocumentList(p) {
    return h("div", { className: "g-col", style: { gap: 2 } }, (p.items || []).map(function (d, i) {
      return h("div", { key: i, className: "g-doc" }, h(Icon, { name: "file", size: 19, className: "file" }),
        h("span", { className: "g-ellipsis", style: { flex: 1, fontWeight: 600 }, title: d.name }, d.name),
        d.status ? h(StatusPill, { status: d.status }, d.statusText) : null,
        h("span", { className: "g-small g-num", style: { whiteSpace: "nowrap" } }, d.meta),
        h(Button, { variant: "quiet", size: "sm", icon: "download", label: "下载 " + d.name }));
    }));
  }

  /* ---------- 下一件事 ---------- */
  function NextUpCard(p) {
    var bad = p.days < 0;
    return h("section", { className: cx("g-card amber g-nextup", bad && "bad") },
      h("span", { className: "cue" }, h(Icon, { name: "calendar-clock", size: 20 }), bad ? "下一件事 · 已逾期 " + (-p.days) + " 天" : "下一件事 · " + p.days + " 天后到期"),
      h("h2", { className: "g-headline" }, p.title),
      h("p", { className: "why" }, p.why),
      h("div", { className: "g-row", style: { justifyContent: "space-between" } }, h("span", { style: { fontWeight: 500 } }, "截止"), h("b", { className: "g-num" }, p.due)),
      h("div", { className: "meta" }, (p.meta || []).map(function (m, i) { return h("span", { key: i }, m); })),
      h("div", null, h(Button, { variant: "primary", icon: "arrow-right" }, p.action || "开始办理")));
  }

  /* ---------- 远期、说明、提示 ---------- */
  function HorizonList(p) {
    return h("div", { className: "g-col", style: { gap: 16 } }, (p.items || []).map(function (x, i) {
      return h("div", { key: i, className: "g-horizon" }, h("span", { className: "d" }, x.date), h("span", { style: { fontWeight: 700 } }, x.title), h("span", { className: "g-small" }, x.meta));
    }));
  }
  function AuditNote(p) {
    return h("div", { className: "g-note" }, h(Icon, { name: "history", size: 20, style: { color: "var(--green-text)" } }),
      h("div", null, h("p", { style: { fontWeight: 700 } }, p.title || "每次改动都有记录。"), h("p", { className: "g-small" }, p.body || "公司信息、文件版本和办理记录都保存在变更历史里，可以随时查看和撤销。")));
  }
  function InfoNote(p) {
    return h("aside", { className: "g-info" }, h(Icon, { name: p.icon || "wifi-off", size: 24 }), h("div", { className: "g-col", style: { gap: 4 } }, h("h3", { className: "g-subtitle" }, p.title), h("p", { style: { fontSize: 12 } }, p.children)));
  }

  /* ---------- 设备、开关、选择卡片、动态 ---------- */
  function DeviceRow(p) {
    return h("div", { className: "g-device" },
      h("span", { className: cx("ic", p.kind === "windows" && "blue"), "aria-hidden": true }, h(Icon, { name: p.kind === "windows" ? "monitor" : "laptop", size: 30 })),
      h("div", { className: "g-col", style: { gap: 4, flex: 1, minWidth: 0 } },
        h("div", { className: "g-row", style: { gap: 9 } }, h("span", { style: { fontWeight: 800, fontSize: 14 } }, p.name), h(StatusPill, { status: p.status })),
        h("span", { className: "g-small" }, p.system),
        h("span", { style: { fontSize: 12, fontWeight: 600, color: p.pending ? "var(--amber-text)" : "var(--green-text)" } }, p.syncText),
        p.note ? h("span", { className: "g-small" }, p.note) : null),
      h(Button, { variant: "quiet", size: "sm", icon: "more", label: "设备操作" }));
  }
  function Toggle(p) {
    var st = useState(!!p.checked), id = useRef("gt-" + (++fid)).current;
    return h("div", { className: "g-pref" },
      h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { id: id, style: { fontWeight: 700 } }, p.label), p.hint ? h("div", { className: "g-small" }, p.hint) : null),
      h("button", { type: "button", role: "switch", className: "g-toggle", "aria-checked": st[0], "aria-labelledby": id, onClick: function () { st[1](!st[0]); } }));
  }
  function ChoiceCard(p) {
    return h("button", { type: "button", role: "radio", className: "g-choice", "aria-checked": !!p.checked, onClick: p.onClick },
      h("span", { className: "g-radio", "aria-hidden": true }),
      h("span", { className: "g-col", style: { gap: 3, minWidth: 0 } }, h("span", { style: { fontSize: 11, fontWeight: 800, color: p.checked ? "var(--green-text)" : "var(--muted)" } }, p.source), h("span", { style: { fontWeight: 700 } }, p.value), p.note ? h("span", { className: "g-small" }, p.note) : null));
  }
  function ActivityList(p) {
    return h("div", { className: "g-col", style: { gap: 10 } }, (p.items || []).map(function (a, i) {
      return h("div", { key: i, className: "g-activity" }, h(Icon, { name: a.icon || "check-check", size: 17, style: { color: a.icon === "compare" ? "var(--amber-text)" : "var(--green-text)" } }),
        h("span", { style: { flex: 1 } }, a.text), h("span", { className: "g-small g-num" }, a.time));
    }));
  }

  /* ---------- 结构图 ---------- */
  function initial(n) { return (n || "?").replace(/^[（(]/, "").slice(0, 1).toUpperCase(); }
  function StructureChart(p) {
    var nodes = p.nodes || [], edges = p.edges || [], W = p.width || 680, NW = 220, NH = 60, GY = 96, top = 56;
    var byLv = {}; nodes.forEach(function (n) { (byLv[n.level] = byLv[n.level] || []).push(n); });
    var pos = {}; Object.keys(byLv).forEach(function (lv) { var row = byLv[lv], gap = 36, tw = row.length * NW + (row.length - 1) * gap, x0 = (W - tw) / 2; row.forEach(function (n, i) { pos[n.id] = { x: x0 + i * (NW + gap), y: top + lv * (NH + GY) }; }); });
    var H = top + Object.keys(byLv).length * (NH + GY) - GY + 84;
    var k = useState(0), sel = useState(p.selected);
    return h("div", { style: { position: "relative", width: "100%", maxWidth: W } },
      h("div", { key: k[0], className: cx("g-chart", p.animate !== false && "build"), style: { height: H } },
        h("div", { className: "g-legend" }, h("span", { className: "g-row", style: { gap: 6 } }, h("span", { className: "g-avatar green", style: { width: 12, height: 12, borderRadius: 4 } }), "公司"), h("span", { className: "g-row", style: { gap: 6 } }, h("span", { className: "g-avatar purple", style: { width: 12, height: 12, borderRadius: 6 } }), "个人")),
        h("svg", { className: "g-edges", width: W, height: H, style: { position: "absolute", left: 0, top: 0 }, "aria-hidden": true },
          edges.map(function (e, i) {
            var a = pos[e.from], b = pos[e.to]; if (!a || !b) return null;
            var lv = nodes.filter(function (n) { return n.id === e.to; })[0].level;
            var x1 = a.x + NW / 2, y1 = a.y + NH + 4, x2 = b.x + NW / 2, y2 = b.y - 2, my = y1 + (y2 - y1) / 2;
            return h("g", { key: i, style: { "--lv": lv } },
              h("path", { d: "M" + x1 + " " + y1 + " V" + my + " H" + x2 + " V" + y2, pathLength: 200 }),
              h("g", { className: "lt" }, h("rect", { className: "lbl", x: x1 - 24, y: y1 + 6, width: 48, height: 20, rx: 8 }), h("text", { x: x1, y: y1 + 20, textAnchor: "middle" }, e.label)));
          })),
        nodes.map(function (n) {
          var q = pos[n.id];
          return h("div", { key: n.id, role: "button", tabIndex: 0, className: cx("g-node", n.level === 0 && "root"), "aria-selected": sel[0] === n.id || undefined, onClick: function () { sel[1](n.id); }, style: { left: q.x, top: q.y, "--lv": n.level } },
            h(Avatar, { text: initial(n.name), tone: n.kind === "person" ? "purple" : (n.tone || "green"), size: 36, round: n.kind === "person" }),
            h("div", { style: { minWidth: 0 } }, h("div", { className: "g-strong g-ellipsis", title: n.name }, n.name), h("div", { className: "g-small g-ellipsis" }, n.meta)));
        })),
      h("div", { className: "g-chart-tools" }, h(Button, { size: "sm", icon: "zoom-in", label: "放大" }), h(Button, { size: "sm", icon: "zoom-out", label: "缩小" }), h(Button, { size: "sm", icon: "fit", label: "适合窗口" }),
        p.replay ? h(Button, { size: "sm", icon: "replay", onClick: function () { k[1](k[0] + 1); } }, "重播生长") : null));
  }

  /* ---------- 庆祝：彩点 ---------- */
  var BURST = ["var(--green)", "var(--amber)", "var(--blue-text)", "var(--purple-text)", "var(--green)", "var(--red)", "var(--amber)", "var(--green)", "var(--blue-text)", "var(--green)"];
  function Burst() {
    if (reduced()) return null;
    return h("span", { className: "g-burst", "aria-hidden": true }, BURST.map(function (c, i) {
      var a = (i / BURST.length) * Math.PI * 2, d = 26 + (i % 3) * 8;
      return h("i", { key: i, style: { background: c, "--x": Math.round(Math.cos(a) * d) + "px", "--y": Math.round(Math.sin(a) * d) + "px", animationDelay: (i % 2) * 30 + "ms" } });
    }));
  }

  /* ---------- 申报日历（可勾选完成） ---------- */
  function FilingTimeline(p) {
    var st = useState({}), burst = useState(null);
    function toggle(key) {
      var on = !st[0][key]; var next = Object.assign({}, st[0]); next[key] = on; st[1](next);
      if (on) { burst[1](key); setTimeout(function () { burst[1](null); }, 800); if (p.onDone) p.onDone(); }
    }
    return h("div", { className: "g-card flush" }, (p.groups || []).map(function (g) {
      return h("section", { key: g.label }, h("div", { className: "g-tl-month" }, g.label), g.items.map(function (r, i) {
        var key = g.label + i, done = r.status === "done" || st[0][key];
        return h("div", { key: key, className: cx("g-req", done && "done") },
          h("div", null, h("div", { className: "date", style: { color: r.days < 0 && !done ? "var(--red-text)" : r.days <= 30 && !done ? "var(--amber-text)" : undefined } }, r.date || "无固定日期"), r.days != null ? h("div", { className: "g-small" }, done ? "已办完" : r.days < 0 ? "逾期 " + (-r.days) + " 天" : "还有 " + r.days + " 天") : null),
          h("div", { style: { minWidth: 0 } }, h("div", { className: "g-strong g-ellipsis title" }, r.title), h("div", { className: "g-small g-ellipsis" }, r.company + " · " + r.authority)),
          h(StatusPill, { status: done ? "done" : r.status }),
          h("span", { style: { position: "relative" } },
            h("button", { type: "button", role: "checkbox", className: "g-check", "aria-checked": !!done, "aria-label": (done ? "取消完成：" : "标为完成：") + r.title, onClick: function () { if (r.status !== "done") toggle(key); } }, h(Icon, { name: "check", size: 16, strokeWidth: 3 })),
            burst[0] === key ? h(Burst) : null));
      }));
    }));
  }

  /* ---------- 庆祝时刻（全部办完 / 档案补齐） ---------- */
  function Celebration(p) {
    var k = useState(0);
    return h("div", { key: k[0], className: "g-card g-celebrate", role: "status" },
      h("span", { style: { position: "relative" } }, h("span", { className: "g-emblem", "aria-hidden": true }, h(Icon, { name: p.icon || "trophy", size: 36 })), h(Burst)),
      h("h2", { className: "g-headline" }, p.title), h("p", { className: "g-muted", style: { margin: 0, maxWidth: 360 } }, p.body),
      h("div", { className: "g-row", style: { justifyContent: "center" } }, p.action || null, p.replay ? h(Button, { size: "sm", icon: "replay", onClick: function () { k[1](k[0] + 1); } }, "再看一次") : null));
  }

  /* ---------- 上传、识别、处理 ---------- */
  function DropZone(p) {
    return h("div", { className: cx("g-drop", p.active && "active"), role: "button", tabIndex: 0, "aria-label": p.title || "上传文件" },
      h(Icon, { name: "upload", size: 26, style: { color: "var(--green-text)" } }), h("div", { style: { fontWeight: 800 } }, p.title || "把文件拖到这里，或点击选择"), h("div", { className: "g-small" }, p.hint || "PDF、Word、图片，每份不超过 50 MB"));
  }
  function UploadRow(p) {
    var pr = useState(p.simulate ? 0 : 100);
    useEffect(function () { if (!p.simulate) return; var v = 0; var t = setInterval(function () { v = Math.min(100, v + 8); pr[1](v); if (v >= 100) clearInterval(t); }, 90); return function () { clearInterval(t); }; }, [p.simulate]);
    var done = pr[0] >= 100;
    return h("div", { className: "g-upload" },
      h("div", { className: "g-row", style: { flexWrap: "nowrap", gap: 12 } }, h(Icon, { name: "file", size: 22, style: { color: "var(--green-text)" } }),
        h("div", { style: { flex: 1, minWidth: 0 } }, h("div", { className: "g-strong g-ellipsis" }, p.name), h("div", { className: "g-small", "aria-live": "polite" }, done ? (p.recognized ? "已识别：" + p.recognized.summary : "已上传") : "正在读取… " + pr[0] + "%")),
        done && p.recognized ? h(StatusPill, { status: "device" }, p.recognized.type) : null),
      done ? null : h("div", { className: "g-bar", role: "progressbar", "aria-valuenow": pr[0], "aria-valuemin": 0, "aria-valuemax": 100, style: { height: 6 } }, h("i", { style: { width: pr[0] + "%", transition: "width 90ms linear" } })));
  }
  function ProcessSteps(p) {
    var steps = p.steps || [], st = useState(p.simulate ? 0 : steps.length);
    useEffect(function () { if (!p.simulate) return; st[1](0); var i = 0; var t = setInterval(function () { i++; st[1](i); if (i >= steps.length) clearInterval(t); }, 750); return function () { clearInterval(t); }; }, [p.simulate]);
    return h("div", { className: "g-steps" }, h("ul", { "aria-live": "polite" }, steps.map(function (s, i) {
      var state = i < st[0] ? "done" : i === st[0] ? "active" : "pending";
      return h("li", { key: i, className: state },
        state === "done" ? h(Icon, { name: "check", size: 18, strokeWidth: 3 }) : state === "active" ? h("span", { className: "g-spin", style: { color: "var(--green-text)" }, "aria-hidden": true }) : h("span", { className: "g-radio", "aria-hidden": true }),
        h("span", { style: { flex: 1 } }, s.label), state === "done" && s.result ? h("span", { className: "g-small" }, s.result) : null);
    })));
  }

  /* ---------- 空状态、轻提示、弹窗 ---------- */
  function EmptyState(p) {
    return h("div", { className: "g-empty" }, h("span", { className: "ic", "aria-hidden": true }, h(Icon, { name: p.icon || "users", size: 30 })), h("h3", { className: "g-title" }, p.title), h("p", null, p.body), p.action || null);
  }
  function Toast(p) {
    return h("div", { className: "g-toast", role: "status" }, h("span", { className: "ok", "aria-hidden": true }, h(Icon, { name: p.icon || "check", size: 15, strokeWidth: 3 })), h("span", null, p.children), p.actionLabel ? h("button", { type: "button" }, p.actionLabel) : null);
  }
  function Dialog(p) {
    return h("div", { className: "g-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "g-dlg-t" },
      h("h2", { className: "g-headline", id: "g-dlg-t", style: { fontSize: 21 } }, p.title), h("p", null, p.children), h("div", { className: "acts" }, p.actions));
  }

  window.Charter = { Icon: Icon, Button: Button, Avatar: Avatar, StatusPill: StatusPill, Sidebar: Sidebar, AppBar: AppBar, PageHeading: PageHeading, HealthBanner: HealthBanner,
    ProgressSegments: ProgressSegments, MetricTile: MetricTile, SearchField: SearchField, Field: Field, ViewToggle: ViewToggle, Tabs: Tabs, Card: Card, EntityTable: EntityTable,
    EntitySnapshot: EntitySnapshot, FactGrid: FactGrid, PeopleTable: PeopleTable, DocumentList: DocumentList, NextUpCard: NextUpCard, HorizonList: HorizonList, AuditNote: AuditNote,
    InfoNote: InfoNote, DeviceRow: DeviceRow, Toggle: Toggle, ChoiceCard: ChoiceCard, ActivityList: ActivityList, StructureChart: StructureChart, FilingTimeline: FilingTimeline,
    Celebration: Celebration, DropZone: DropZone, UploadRow: UploadRow, ProcessSteps: ProcessSteps, EmptyState: EmptyState, Toast: Toast, Dialog: Dialog };
})();
