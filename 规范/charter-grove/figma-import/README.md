# Charter → Figma 导入包

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
