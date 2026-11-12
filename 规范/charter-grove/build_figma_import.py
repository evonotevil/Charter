#!/usr/bin/env python3
"""Build a self-contained Figma import package from the local Cowork export."""

from __future__ import annotations

import html
import json
import re
import shutil
import urllib.request
import zipfile
from pathlib import Path


BASE = Path(__file__).resolve().parent
SRC = BASE / "cowork-export"
OUT = BASE / "figma-import"
ASSETS = OUT / "assets"
FONTS = ASSETS / "fonts"
TOKENS_DIR = OUT / "tokens"

GROUP_ORDER = ["基础", "操作", "状态", "导航", "布局", "数据", "输入", "反馈"]
GROUP_TITLES = {
    "基础": "基础元素",
    "操作": "操作",
    "状态": "状态",
    "导航": "导航",
    "布局": "布局",
    "数据": "数据展示",
    "输入": "输入与选择",
    "反馈": "反馈与引导",
}

FONT_FILES = {
    "inter-400.ttf": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf",
    "inter-500.ttf": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf",
    "inter-600.ttf": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf",
    "inter-700.ttf": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf",
    "inter-800.ttf": "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuDyYMZg.ttf",
    "nunito-800.ttf": "https://fonts.gstatic.com/s/nunito/v32/XRXI3I6Li01BKofiOc5wtlZ2di8HDDsmRTM.ttf",
    "nunito-900.ttf": "https://fonts.gstatic.com/s/nunito/v32/XRXI3I6Li01BKofiOc5wtlZ2di8HDBImRTM.ttf",
}

FONT_CSS = """\
@font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:swap;src:url("fonts/inter-400.ttf") format("truetype")}
@font-face{font-family:Inter;font-style:normal;font-weight:500;font-display:swap;src:url("fonts/inter-500.ttf") format("truetype")}
@font-face{font-family:Inter;font-style:normal;font-weight:600;font-display:swap;src:url("fonts/inter-600.ttf") format("truetype")}
@font-face{font-family:Inter;font-style:normal;font-weight:700;font-display:swap;src:url("fonts/inter-700.ttf") format("truetype")}
@font-face{font-family:Inter;font-style:normal;font-weight:800;font-display:swap;src:url("fonts/inter-800.ttf") format("truetype")}
@font-face{font-family:Nunito;font-style:normal;font-weight:800;font-display:swap;src:url("fonts/nunito-800.ttf") format("truetype")}
@font-face{font-family:Nunito;font-style:normal;font-weight:900;font-display:swap;src:url("fonts/nunito-900.ttf") format("truetype")}
"""

IMPORT_CSS = """\
html{background:#e8ede3}
body{
  margin:0!important;
  padding:0!important;
  background:#e8ede3!important;
  font-family:var(--font-sans)!important;
  color:var(--ink);
}
.board{
  width:1440px;
  margin:0 auto;
  padding:56px 40px 80px;
}
.board-head{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:32px;
  margin-bottom:40px;
  padding:32px 36px;
  border:2px solid var(--line);
  border-radius:24px;
  background:var(--surface);
}
.board-kicker{
  margin:0 0 8px;
  color:var(--green-text);
  font-size:12px;
  font-weight:800;
  letter-spacing:.08em;
}
.board-head h1{
  margin:0;
  font:900 42px/1.15 var(--font-display);
}
.board-head p{
  max-width:700px;
  margin:10px 0 0;
  color:var(--muted);
  font-size:14px;
}
.board-meta{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
.meta-pill{
  display:inline-flex;
  align-items:center;
  min-height:34px;
  padding:0 12px;
  border-radius:10px;
  background:var(--green-soft);
  color:var(--green-text);
  font-size:12px;
  font-weight:800;
  white-space:nowrap;
}
.group{margin-top:44px}
.group-head{
  display:flex;
  align-items:center;
  gap:14px;
  margin:0 0 18px;
}
.group-head h2{
  margin:0;
  font:900 25px/1.25 var(--font-display);
}
.group-head span{
  color:var(--muted);
  font-size:12px;
}
.component-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:24px 24px;
  align-items:start;
}
.preview-card{
  min-width:0;
  overflow:hidden;
  border:2px solid var(--line);
  border-radius:20px;
  background:var(--surface);
}
.preview-card.full{grid-column:1/-1}
.preview-label{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  min-height:44px;
  padding:0 18px;
  border-bottom:1px solid var(--line);
  background:var(--surface-sunken);
}
.preview-label strong{
  color:var(--ink);
  font-size:12px;
  font-weight:800;
}
.preview-label span{
  color:var(--muted);
  font-size:11px;
  font-weight:600;
}
.preview-stage{
  position:relative;
  display:flex;
  flex-direction:column;
  padding:24px;
  overflow:hidden;
}
.screen-board{width:1440px}
.screen-card{
  width:1440px;
  margin:0 0 52px;
  border:2px solid var(--line);
  border-radius:22px;
  overflow:hidden;
  background:var(--surface);
}
.screen-card .preview-stage{padding:24px;align-items:flex-start}
.screen-card .preview-root{width:1392px}
.screen-card .g-window{width:1392px}
.notes{
  margin-top:22px;
  padding:18px 20px;
  border-radius:14px;
  background:var(--blue-soft);
  color:var(--ink);
  font-size:13px;
}
.notes strong{color:var(--blue-text)}
"""


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def fmt_number(value: str) -> str:
    return value[:-2] if value.endswith("px") else value


def figma_color(value: str) -> dict:
    """Convert a CSS hex color to Figma's DTCG color object."""
    match = re.fullmatch(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?", value)
    if not match:
        raise ValueError(f"Unsupported color value: {value}")
    rgb = match.group(1)
    alpha = int(match.group(2), 16) / 255 if match.group(2) else 1
    components = [int(rgb[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    return {
        "colorSpace": "srgb",
        "components": components,
        "alpha": alpha,
        "hex": f"#{rgb.upper()}",
    }


def normalize_figma_tokens(node, inherited_type: str | None = None):
    """Recursively convert color token values while preserving descriptions."""
    if isinstance(node, list):
        return [normalize_figma_tokens(item, inherited_type) for item in node]
    if not isinstance(node, dict):
        return node

    token_type = node.get("$type", inherited_type)
    normalized = {
        key: normalize_figma_tokens(value, token_type)
        for key, value in node.items()
    }
    if token_type == "color" and isinstance(normalized.get("$value"), str):
        normalized["$value"] = figma_color(normalized["$value"])
    return normalized


def write_figma_tokens(source: Path, target: Path) -> None:
    tokens = json.loads(source.read_text(encoding="utf-8"))
    normalized = normalize_figma_tokens(tokens)
    target.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_tokens_css(tokens: dict) -> str:
    color = {item["name"]: item["value"]["light"] for item in tokens["color"]["tokens"]}
    color_dark = {item["name"]: item["value"]["dark"] for item in tokens["color"]["tokens"]}
    spacing = {item["name"]: item["value"] for item in tokens["spacing"]["tokens"]}
    radius = {item["name"].removeprefix("radius-"): item["value"] for item in tokens["radius"]["tokens"]}
    size = {item["name"]: item["value"] for item in tokens["size"]["tokens"]}
    shadow = {item["name"]: item["value"]["light"] for item in tokens["shadow"]["tokens"]}
    shadow_dark = {item["name"]: item["value"]["dark"] for item in tokens["shadow"]["tokens"]}

    light_lines = ["/* Generated from cowork-export/tokens.json. */", ":root{"]
    light_lines += [f"  --{name}:{value};" for name, value in color.items()]
    light_lines += [f"  --{name}:{value};" for name, value in spacing.items()]
    light_lines += [f"  --radius-{name}:{value};" for name, value in radius.items()]
    light_lines += [f"  --{name}:{value};" for name, value in size.items()]
    light_lines += [
        f'  --font-{name}:{value};'
        for name, value in tokens["type"]["families"].items()
    ]
    for group in tokens["type"]["groups"]:
        for style in group["styles"]:
            name = style["name"]
            light_lines.append(f"  --font-size-{name}:{style['fontSize']};")
            light_lines.append(f"  --font-weight-{name}:{style['fontWeight']};")
            light_lines.append(f"  --line-height-{name}:{style['lineHeight']};")
    light_lines += [f"  --{name}:{value};" for name, value in shadow.items()]
    light_lines.append("}")

    dark_lines = ['[data-theme="dark"]{']
    dark_lines += [f"  --{name}:{value};" for name, value in color_dark.items()]
    dark_lines += [f"  --{name}:{value};" for name, value in shadow_dark.items()]
    dark_lines.append("}")
    return "\n".join(light_lines + dark_lines) + "\n"


def ensure_fonts() -> None:
    FONTS.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_FILES.items():
        target = FONTS / name
        if target.exists() and target.stat().st_size > 20_000:
            continue
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            target.write_bytes(response.read())


def extract_preview(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    group_match = re.search(r'group="([^"]+)"', text)
    height_match = re.search(r"\bheight=(\d+)", text)
    width_match = re.search(r"\bwidth=(\d+)", text)
    subtitle_match = re.search(r'subtitle="([^"]+)"', text)
    body = re.search(r"<body[^>]*>(.*?)</body>", text, re.S | re.I)
    if not body:
        raise ValueError(f"No body found in {path}")
    body_text = body.group(1)
    styles = re.findall(r"<style[^>]*>(.*?)</style>", text, re.S | re.I)
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", body_text, re.S | re.I)
    body_text = re.sub(r"<style[^>]*>.*?</style>", "", body_text, flags=re.S | re.I)
    body_text = re.sub(r"<script[^>]*>.*?</script>", "", body_text, flags=re.S | re.I)
    return {
        "name": path.parent.name,
        "group": group_match.group(1) if group_match else "",
        "height": int(height_match.group(1)) if height_match else 100,
        "width": int(width_match.group(1)) if width_match else 0,
        "subtitle": subtitle_match.group(1) if subtitle_match else "",
        "body": body_text.strip(),
        "styles": [item.strip() for item in styles],
        "scripts": [item.strip() for item in scripts],
    }


def scope_cover_css(css: str, root_id: str) -> str:
    selector = f"#{root_id}"
    css = re.sub(r"html,\s*body", selector, css)
    for class_name in ("cv", "g", "ge", "a", "ae", "bs", "ps", "gs", "ln", "sf", "nm", "tg"):
        css = re.sub(rf"\.{class_name}\b", f"{selector} .{class_name}", css)
    return css


def render_preview(preview: dict) -> str:
    name = preview["name"]
    root_id = f"preview-{name}"
    is_cover = name == "Cover"
    if is_cover:
        markup = f'<div id="{root_id}" class="cover-root">{preview["body"]}</div>'
        css = "\n".join(scope_cover_css(item, root_id) for item in preview["styles"])
    else:
        markup = f'<div id="{root_id}" class="preview-root" data-preview="{html.escape(name)}"></div>'
        css = ""
    scripts = []
    for script in preview["scripts"]:
        script = script.replace('document.getElementById("root")', f'document.getElementById("{root_id}")')
        scripts.append(f"<script>(function(){{{script}\n}})();</script>")
    return (
        f'<section class="preview-card{" full" if is_cover else ""}" '
        f'data-component="{html.escape(name)}">'
        '<div class="preview-label">'
        f"<strong>{html.escape(name)}</strong>"
        f"<span>{html.escape(preview['group'] or '封面')}</span>"
        "</div>"
        f'<div class="preview-stage" style="min-height:{max(preview["height"], 80)}px">'
        f"{f'<style>{css}</style>' if css else ''}{markup}{''.join(scripts)}"
        "</div></section>"
    )


def page_shell(title: str, body: str, extra_head: str = "") -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/charter.css">
<link rel="stylesheet" href="assets/import.css">
<script src="assets/react.production.min.js"></script>
<script src="assets/react-dom.production.min.js"></script>
<script src="assets/charter.js"></script>
{extra_head}
</head>
<body>{body}</body>
</html>
"""


def build_components_page(previews: list[dict]) -> str:
    by_group: dict[str, list[dict]] = {}
    cover = None
    for preview in previews:
        if preview["name"] == "Cover":
            cover = preview
        elif preview["name"].startswith("Screen"):
            continue
        else:
            by_group.setdefault(preview["group"], []).append(preview)

    sections = []
    if cover:
        sections.append(f'<section class="group">{render_preview(cover)}</section>')
    ordered_groups = GROUP_ORDER + sorted(set(by_group) - set(GROUP_ORDER))
    for group in ordered_groups:
        items = by_group.get(group, [])
        if not items:
            continue
        cards = "".join(render_preview(item) for item in sorted(items, key=lambda item: item["name"]))
        sections.append(
            '<section class="group">'
            '<div class="group-head">'
            f"<h2>{html.escape(GROUP_TITLES.get(group, group))}</h2>"
            f"<span>{len(items)} 个元素</span>"
            "</div>"
            f'<div class="component-grid">{cards}</div>'
            "</section>"
        )

    body = (
        '<main class="board">'
        '<header class="board-head">'
        "<div>"
        '<p class="board-kicker">CHARTER DESIGN SYSTEM</p>'
        "<h1>组件总览</h1>"
        "<p>从 Claude Cowork 的本地缓存重建。每个区块都是一个可编辑的 Figma 转换目标；"
        "文字、形状和布局会由网页导入插件生成图层。</p>"
        "</div>"
        '<div class="board-meta"><span class="meta-pill">37 个组件</span>'
        '<span class="meta-pill">1 个封面</span><span class="meta-pill">1440 px 画板</span></div>'
        "</header>"
        f"{''.join(sections)}"
        "</main>"
    )
    return page_shell("Charter · Figma 组件导入", body)


def build_screens_page(previews: list[dict]) -> str:
    screens = sorted(
        (item for item in previews if item["name"].startswith("Screen")),
        key=lambda item: item["name"],
    )
    cards = []
    for item in screens:
        cards.append(
            '<section class="screen-card" '
            f'data-component="{html.escape(item["name"])}">'
            '<div class="preview-label">'
            f"<strong>{html.escape(item['name'])}</strong>"
            f"<span>{html.escape(item['subtitle'] or '页面')}</span>"
            "</div>"
            f'<div class="preview-stage" style="min-height:{max(item["height"], 680)}px">'
            '<div class="preview-root">'
            f'<div id="preview-{item["name"]}"></div>'
            "</div>"
            + "".join(
                f"<script>(function(){{{script.replace('document.getElementById(\"root\")', f'document.getElementById(\"preview-{item['name']}\")')}\n}})();</script>"
                for script in item["scripts"]
            )
            + "</div></section>"
        )
    body = (
        '<main class="board screen-board">'
        '<header class="board-head">'
        "<div>"
        '<p class="board-kicker">CHARTER DESIGN SYSTEM</p>'
        "<h1>关键页面</h1>"
        "<p>五个 1440 px 桌面页面。建议单独导入，并在 Figma 中按 ScreenCalendar、"
        "ScreenEntity 等名称建立页面或主框架。</p>"
        "</div>"
        '<div class="board-meta"><span class="meta-pill">5 个页面</span>'
        '<span class="meta-pill">桌面端</span><span class="meta-pill">1440 px</span></div>'
        "</header>"
        f"{''.join(cards)}"
        '<div class="notes"><strong>导入提示：</strong>如果插件裁掉了右侧内容，'
        "把导入视口宽度设为 1504 px；页面内部设计宽度仍是 1440 px。</div>"
        "</main>"
    )
    return page_shell("Charter · Figma 页面导入", body)


def build_guidelines_page(tokens: dict, manifest: dict) -> str:
    colors = tokens["color"]["tokens"]
    swatches = []
    for item in colors:
        light = item["value"]["light"]
        dark = item["value"]["dark"]
        swatches.append(
            '<div class="swatch">'
            f'<div class="swatch-colors"><i style="background:{light}"></i><i style="background:{dark}"></i></div>'
            f"<strong>{html.escape(item['name'])}</strong>"
            f"<code>{light} / {dark}</code>"
            f"<p>{html.escape(item.get('usage', ''))}</p>"
            "</div>"
        )

    type_rows = []
    for group in tokens["type"]["groups"]:
        for style in group["styles"]:
            family = tokens["type"]["families"][group["family"]]
            type_rows.append(
                '<div class="type-row">'
                f'<div class="type-meta"><strong>{html.escape(style["name"])}</strong>'
                f'<span>{style["fontSize"]} / {style["lineHeight"]} / {style["fontWeight"]}</span></div>'
                f'<div class="type-sample" style="font-family:{html.escape(family)};'
                f'font-size:{style["fontSize"]};line-height:{style["lineHeight"]};'
                f'font-weight:{style["fontWeight"]}">{html.escape(style["sample"])}</div>'
                f'<p>{html.escape(style.get("usage", ""))}</p>'
                "</div>"
            )

    spacing_tiles = "".join(
        '<div class="scale-item">'
        f'<strong>{html.escape(item["name"])}</strong>'
        f'<div class="space-bar" style="width:{item["value"]};height:10px"></div>'
        f'<span>{item["value"]}</span></div>'
        for item in tokens["spacing"]["tokens"]
    )
    radius_tiles = "".join(
        '<div class="scale-item">'
        f'<strong>{html.escape(item["name"])}</strong>'
        f'<div class="radius-box" style="border-radius:{item["value"]}"></div>'
        f'<span>{item["value"]}</span></div>'
        for item in tokens["radius"]["tokens"]
    )
    component_notes = "".join(
        '<div class="catalogue-item">'
        f'<strong>{html.escape(item["name"])}</strong>'
        f'<span>{html.escape(item.get("group", ""))}</span>'
        f'<p>{html.escape(item.get("summary", ""))}</p>'
        "</div>"
        for item in manifest.get("components", [])
        if not item.get("page")
    )

    body = f"""<main class="board docs-board">
<header class="board-head">
  <div>
    <p class="board-kicker">CHARTER DESIGN SYSTEM</p>
    <h1>设计基础与规范</h1>
    <p>这是供设计、开发和 Figma 对照使用的基础页。颜色、字号、间距、圆角都直接来自同一份 token 源。</p>
  </div>
  <div class="board-meta"><span class="meta-pill">浅色 / 深色</span><span class="meta-pill">83 个变量</span></div>
</header>
<section class="docs-section">
  <h2>核心原则</h2>
  <div class="principle-grid">
    <article><strong>友好的外壳，严谨的内容</strong><p>标题可以亲切；字段、日期、状态和法律术语必须准确。</p></article>
    <article><strong>一眼知道情况</strong><p>先给状态横幅，再给数字，再给明细。</p></article>
    <article><strong>下一步永远清楚</strong><p>每条坏消息都跟一个明确可点的下一步。</p></article>
    <article><strong>立体感 = 可以按</strong><p>只有按钮和结构图节点使用 4px 立体底边，信息卡片保持平。</p></article>
    <article><strong>值得庆祝的才庆祝</strong><p>完成申报、补齐档案时给一点小奖励；日常浏览保持安静。</p></article>
    <article><strong>每个结论都有出处</strong><p>字段旁标注来源和核对人，识别信息能回到原文件。</p></article>
  </div>
</section>
<section class="docs-section">
  <h2>颜色</h2>
  <p class="section-note">左侧是浅色值，右侧是深色值。导入时可将两套值放在同一集合的 Light / Dark 模式中；若 Figma 生成两个集合，按同一路径合并模式即可。</p>
  <div class="swatch-grid">{''.join(swatches)}</div>
</section>
<section class="docs-section">
  <h2>字体</h2>
  <p class="section-note">标题用 Nunito 800/900，正文用 Inter。中文自动回落到系统苹方。</p>
  <div class="type-list">{''.join(type_rows)}</div>
</section>
<section class="docs-section two-up">
  <div><h2>间距</h2><div class="scale-list">{spacing_tiles}</div></div>
  <div><h2>圆角</h2><div class="scale-list">{radius_tiles}</div></div>
</section>
<section class="docs-section">
  <h2>组件目录</h2>
  <div class="catalogue">{component_notes}</div>
</section>
<section class="docs-section docs-text">
  <h2>实现说明</h2>
  <p><strong>描边：</strong>统一 2px。颜色 <code>line</code> 只做分隔，<code>line-strong</code> 用于输入框和交互控件边界。</p>
  <p><strong>立体边：</strong>按钮 4px，徽标 6px；按下时元素下沉、底边归零。普通卡片不用阴影。</p>
  <p><strong>布局：</strong>侧栏 224px，顶栏 72px，页面边距 32px；区块间距 24px，卡片间距 20px。</p>
  <p><strong>日期：</strong>绝对日期使用 YYYY-MM-DD；相对时间写“还有 28 天”“逾期 3 天”。</p>
</section>
</main>"""
    extra_head = """<style>
.docs-section{margin-top:52px}
.docs-section h2{margin:0 0 18px;font:900 27px/1.25 var(--font-display)}
.section-note{margin:-8px 0 20px;color:var(--muted);font-size:13px}
.principle-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.principle-grid article{padding:22px;border:2px solid var(--line);border-radius:18px;background:var(--surface)}
.principle-grid strong{font-size:15px}
.principle-grid p{margin:8px 0 0;color:var(--muted);font-size:13px}
.swatch-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.swatch{padding:16px;border:2px solid var(--line);border-radius:16px;background:var(--surface)}
.swatch-colors{display:grid;grid-template-columns:1fr 1fr;height:52px;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
.swatch-colors i{display:block}
.swatch strong{display:block;margin-top:12px;font-size:13px}
.swatch code{display:block;margin-top:3px;color:var(--muted);font-size:11px}
.swatch p{min-height:34px;margin:8px 0 0;color:var(--muted);font-size:11px;line-height:1.45}
.type-list{border:2px solid var(--line);border-radius:20px;overflow:hidden;background:var(--surface)}
.type-row{display:grid;grid-template-columns:150px minmax(0,1fr) 250px;gap:28px;align-items:center;padding:22px 26px;border-top:1px solid var(--line)}
.type-row:first-child{border-top:0}
.type-meta strong{display:block;font-size:13px}
.type-meta span{display:block;margin-top:4px;color:var(--muted);font-size:11px}
.type-sample{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.type-row p{margin:0;color:var(--muted);font-size:12px}
.two-up{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.scale-list{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.scale-item{display:grid;grid-template-columns:95px 1fr 55px;align-items:center;gap:12px;padding:14px;border:2px solid var(--line);border-radius:14px;background:var(--surface);font-size:11px}
.scale-item strong{font-size:12px}.scale-item span{color:var(--muted);text-align:right}
.space-bar{max-width:100%;border-radius:3px;background:var(--green)}
.radius-box{width:72px;height:52px;border:2px solid var(--green-soft-line);background:var(--green-soft)}
.catalogue{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.catalogue-item{padding:18px;border:2px solid var(--line);border-radius:14px;background:var(--surface)}
.catalogue-item strong{font-size:13px}.catalogue-item>span{margin-left:8px;color:var(--muted);font-size:10px}
.catalogue-item p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
.docs-text{padding:28px;border:2px solid var(--line);border-radius:20px;background:var(--surface)}
.docs-text p{margin:10px 0;color:var(--muted);font-size:13px;line-height:1.7}
.docs-text strong{color:var(--ink)}
.docs-text code{padding:2px 5px;border-radius:5px;background:var(--surface-sunken);color:var(--green-text)}
</style>"""
    return page_shell("Charter · 设计基础与规范", body, extra_head)


def build_index() -> str:
    body = """<main class="index-wrap">
<header>
  <p>CHARTER · FIGMA IMPORT KIT</p>
  <h1>不用再改 Claude 对话，直接导入。</h1>
  <div>这套文件是从本地 Cowork 缓存重建的。先导入变量，再导入组件和页面。</div>
</header>
<section class="steps">
  <article><b>01</b><h2>导入变量</h2><p>在 Figma 的 Variables 中新建集合，把浅色和深色 JSON 一起拖进去。若出现两个集合，再整理成 Light / Dark 模式。</p><a href="tokens/light.tokens.json">浅色 token</a><a href="tokens/dark.tokens.json">深色 token</a></article>
  <article><b>02</b><h2>导入组件</h2><p>用 html.to.design 打开下方组件页，一次生成全部组件图层。</p><a class="primary" href="charter-components.html">打开组件导入页</a></article>
  <article><b>03</b><h2>导入页面</h2><p>单独导入五个 1440 px 页面，不要和组件画板挤在同一个页面里。</p><a class="primary" href="charter-screens.html">打开页面导入页</a></article>
</section>
<section class="extra"><h2>补充</h2><p><a href="charter-guidelines.html">设计基础与规范</a> 可作为 Figma 参考页；Markdown 原文在 <code>source-docs/</code>。组件 README 用来查行为和状态，不需要逐个导入。</p></section>
</main>"""
    extra = """<style>
body{background:linear-gradient(145deg,#eff5e9,#dfe9d8)!important;min-height:100vh}
.index-wrap{width:1120px;margin:0 auto;padding:72px 0}
header{padding:46px;border:2px solid #cbd8c5;border-radius:28px;background:#fff}
header p{margin:0 0 10px;color:#2f7a00;font-size:12px;font-weight:800;letter-spacing:.12em}
header h1{max-width:820px;margin:0;font:900 56px/1.08 Nunito,sans-serif;color:#25352c}
header div{max-width:700px;margin-top:18px;color:#5f6d66;font-size:16px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:24px}
.steps article{position:relative;padding:28px;border:2px solid #cbd8c5;border-radius:22px;background:#fff}
.steps b{display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;border-radius:12px;background:#58cc02;color:#1b3608;font:900 14px Nunito,sans-serif;box-shadow:0 4px 0 #368a00}
.steps h2{margin:24px 0 8px;font:900 22px Nunito,sans-serif}
.steps p{min-height:62px;margin:0 0 18px;color:#5f6d66;font-size:13px}
.steps a{display:block;margin-top:7px;padding:10px 12px;border:2px solid #e0e7dd;border-radius:10px;color:#2f7a00;font-size:12px;font-weight:800;text-decoration:none}
.steps a.primary{background:#58cc02;border-color:#58cc02;color:#1b3608;box-shadow:0 4px 0 #368a00}
.extra{margin-top:24px;padding:28px;border-radius:20px;background:#edfae2;color:#25352c}
.extra h2{margin:0 0 8px;font:900 20px Nunito,sans-serif}.extra p{margin:0;color:#5f6d66}
.extra a{color:#2f7a00;font-weight:800}
</style>"""
    return page_shell("Charter · Figma 导入包", body, extra)


def build_readme() -> str:
    return """# Charter → Figma 导入包

这个包是从本机 Claude Cowork 缓存重建的，不需要 Claude 再处理对话，也不需要逐个下载 83 个文件。

## 最快流程

1. **变量**：Figma 打开任意设计文件 → `Variables` → 新建集合 `Charter`。把
   `tokens/light.tokens.json` 和 `tokens/dark.tokens.json` 一起拖进这个集合。
   若 Figma 生成同一集合的 Light / Dark 两个模式，就可以直接使用；若生成两个集合，
   再在 Variables 中将它们整理为同一集合的两个模式。
2. **组件**：安装 Figma 插件 `html.to.design`。双击 `打开导入页面.command`，
   浏览器打开后进入“组件总览”，在插件里选择 Import from URL，并粘贴该页面地址。
3. **页面**：用同样方法导入“关键页面”。建议单独建一个 Figma 页面，导入视口宽度 1504 px。
4. **说明文档**：`source-docs/` 中的 Markdown 是参考，不需要逐个导入。

## 文件说明

- `charter-components.html`：封面 + 37 个组件，一次导入。
- `charter-screens.html`：5 个 1440 px 页面，一次导入。
- `charter-guidelines.html`：颜色、字体、间距、圆角和组件目录。
- `tokens/light.tokens.json`、`tokens/dark.tokens.json`：DTCG 变量，各 83 项，可作为 Light / Dark 两套值。
- `source-docs/`：原始 README、布局、动效、组件说明和清单。

## 注意

- 不要导入 `components/` 里 43 个独立预览，也不要把每个组件 README 当成组件。
- html.to.design 会把网页转换为可编辑图层，但不会自动把每个 React 实例变成 Figma Component。
  导入后可按组件名称框选，再在 Figma 中执行 `Create component`。
- 字体已放进 `assets/fonts/`，导入页面不依赖 Google Fonts 或网络字体。
"""


def build_launcher() -> str:
    return """#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=8765
URL="http://127.0.0.1:${PORT}/index.html"
echo "Charter Figma Import Kit"
echo "打开：${URL}"
echo "导入完成后按 Control-C 停止本地服务器。"
(sleep 1; open "${URL}") &
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
"""


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    for folder in (OUT, ASSETS, FONTS, TOKENS_DIR, OUT / "source-docs"):
        folder.mkdir(parents=True, exist_ok=True)

    if not (SRC / "manifest.json").exists():
        shutil.copy2(BASE / "cowork-downloads" / "manifest.json", SRC / "manifest.json")
    shutil.copy2(SRC / "manifest.json", OUT / "source-docs" / "manifest.json")
    for name in ("README.md", "figma.md", "layout.md", "motion.md"):
        shutil.copy2(SRC / name, OUT / "source-docs" / name)
    component_docs = OUT / "source-docs" / "components"
    component_docs.mkdir()
    for path in sorted((SRC / "components").glob("*/README.md")):
        target = component_docs / path.parent.name
        target.mkdir()
        shutil.copy2(path, target / "README.md")

    tokens = json.loads((SRC / "tokens.json").read_text(encoding="utf-8"))
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    write(ASSETS / "tokens.css", build_tokens_css(tokens))

    charter_css = (SRC / "components/bundle.css").read_text(encoding="utf-8")
    charter_css = re.sub(r'^@import url\([^\n]+\);\s*', "", charter_css)
    write(ASSETS / "charter.css", FONT_CSS + "\n" + charter_css)
    write(ASSETS / "import.css", IMPORT_CSS)
    shutil.copy2(SRC / "components/bundle.js", ASSETS / "charter.js")
    shutil.copy2("/tmp/react.production.min.js", ASSETS / "react.production.min.js")
    shutil.copy2("/tmp/react-dom.production.min.js", ASSETS / "react-dom.production.min.js")
    ensure_fonts()

    for token_name in ("light.tokens.json", "dark.tokens.json"):
        write_figma_tokens(BASE / "figma" / token_name, TOKENS_DIR / token_name)

    previews = [
        extract_preview(path)
        for path in sorted((SRC / "components").glob("*/preview.html"))
    ]
    write(OUT / "charter-components.html", build_components_page(previews))
    write(OUT / "charter-screens.html", build_screens_page(previews))
    write(OUT / "charter-guidelines.html", build_guidelines_page(tokens, manifest))
    write(OUT / "index.html", build_index())
    write(OUT / "README.md", build_readme())
    launcher = OUT / "打开导入页面.command"
    write(launcher, build_launcher())
    launcher.chmod(0o755)

    with zipfile.ZipFile(BASE / "Charter-Figma-Import.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(OUT))

    print(f"Built {OUT}")
    print(f"Components: {sum(1 for item in previews if not item['name'].startswith('Screen') and item['name'] != 'Cover')}")
    print(f"Screens: {sum(1 for item in previews if item['name'].startswith('Screen'))}")


if __name__ == "__main__":
    main()
