# Charter 双端迁移：工程说明

## 已定方案（用户已确认）
- 技术栈：Tauri 2（Rust）+ React 18 + TypeScript + Vite。Mac 与 Windows 共用一套代码，最终替换 Swift 版。
- 同步方式：用户自选一个云盘文件夹（iCloud Drive、OneDrive 等），Charter 只读写这个文件夹。
- 范围：功能与 Swift 版完全对齐，包括 OCR、日历、通知。
- 新项目位于 `Charter/desktop/`。Swift 版（`Charter/Charter/`）保持不动，作为行为和界面的参照。

## 数据兼容（硬性要求）
Swift 版与桌面版必须能读写同一个数据文件夹。

### 文件夹结构
| 路径 | 内容 |
|---|---|
| `数据/*.json` | companies、people、holdings、appointments、parties、documents、obligations、changes、groups、requests、settings |
| `模板/templates.json` | 模板 |
| `文件/` | 归档文件 |
| `文件包/` | 文件包 |
| `.snapshots/` | 快照 |
| `.charter-undo/` | 撤销 |
| `集团图标/<集团ID>.png` | 集团图标 |

### JSON 格式（与 Swift `JSONEncoder` 一致）
- 键名与 Swift Codable 相同。
- 非可选字段必须写出；可选字段为空时省略。
- `Day` 写成 `"yyyy-MM-dd"`，`MonthDay` 写成 `"MM-dd"`。
- `Date` 写成自 2001-01-01 起的秒数。
- 格式化：`" : "` 分隔，键名排序，空数组写成 `"[\n\n]"`。实现见 `desktop/src/domain/json.ts` 的 `swiftJSON`。
- 文件相对路径一律用 `/` 分隔。
- 写入是原子操作：先写临时文件，再替换原文件。

### 互不干扰
- 未完成的导入草稿只存在本机，文件名为 `.pending-import-desktop.json`，不与 Swift 版混用。

## 现状（desktop/）

### 已完成，通过类型检查，部分有测试
| 模块 | 内容 |
|---|---|
| domain | 日期、模型、规则引擎、股权、结构图布局与连线、识别、文件夹读写、快照 |
| state | Store（撤销、事务保存）、Router、同步状态、ChangePlan、配置、暂存 |
| services | PDF 提取与 OCR 回退、PDF/ZIP/XLSX 生成、文件包、导出、邮件、提醒、`.ics` |
| src-tauri | 文件读写、目录监听、同步状态、OCR、CJK 字体、对话框插件 |

src-tauri 各平台说明：
- Mac：用 JXA 读 iCloud 状态，用 Vision 做 OCR。
- Windows：用 `windows` crate 调 Media.Ocr 和 CfGetPlaceholderInfo。这部分尚未在真机编译。

### 界面（screens/）
以下页面都已写完初版：Dashboard、Companies、Matrix、Structure、Files、Import、People、Parties、Calendar、Editors、Groups、Query、Packet、ChangeWizard、Settings、SheetHost、common。

截至交接：
- 全部页面通过 `tsc`。
- 浏览器预览（`?sample`）中，总览、公司列表、矩阵、结构四个页面已截图核对。
- 其余页面还没有逐一做视觉验证。

## 待办（按优先级）
1. 在浏览器里用 `npm run dev` 加 `?sample` 逐页截图，逐项对照 Swift 版和 DESIGN.md：文件、人员、负责方、日历、设置，以及全部弹窗。
2. 修正 `src/ui/Icon.tsx` 中缺失的图标映射。缺失的图标会显示成空心圆。
3. 跑通 Tauri 构建：
   - Linux：`npm run tauri build` 已具备条件。
   - Mac 与 Windows：在 GitHub Actions 上构建，或在用户自己的机器上构建。本环境无法交叉编译 Windows 目标。
4. 用真实数据文件夹做往返测试：Swift 写、桌面读；桌面写、Swift 读。逐字节比较 JSON。
5. Windows 真机验证：OCR、同步状态、CJK 字体、拖放坐标（`devicePixelRatio`）。
6. 打包：生成 dmg 和 msi/nsis，配置签名。

## 参考文件
| 文件 | 内容 |
|---|---|
| `DESIGN.md` | 设计规范，是本次交接的核心 |
| `tokens.json`、`charter.css` | 设计 token 与基础样式 |
| `charter-templates.json` | 内置模板库：8 个法域、55 种文件类型、32 条规则、3 个用途 |
| `icons/` | 应用图标 |
| `Charter/Charter/Views/*.swift` | 行为与界面的权威参照 |
