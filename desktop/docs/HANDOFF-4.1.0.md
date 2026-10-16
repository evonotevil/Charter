# Charter 交接文档（截至 4.1.0，2026-10-16）

放进 Project 资料后，新对话从这里接着做即可。

## 1. Charter 是什么

为一位独立工作的公司法务（in-house counsel）做的公司档案管理桌面应用。用户一个人管十几家公司：
- 三个集团：远澜、明岸、Harbor Crest（示例数据里的名字）。上面还有共用的控股公司（如开曼的 Northstar）。
- 法域：香港、新加坡、日本、韩国、台湾，加上 BVI、开曼的控股公司。

日常场景：
- 老板或财务随口一问，要马上答出：谁在上面、谁是董事、某证书什么时候到期。
- 每年各地的年审、申报不能漏，要知道每件事找哪家中介、哪位对接人。
- 文件放进数据文件夹里存档，同时也是信息来源。

## 2. Charter 4 的设计原则（后续一切改动以此为准）

1. **结构即首页**：上下级、平行公司一眼看清。
2. **随问随答**：⌘K、信息卡、复制摘要，几秒内答出。
3. **到期不漏**：日期按规则自动算 → 你确认或修改 → 到期前 30 / 7 / 1 天提醒 → 完成后自动排下一年。
4. **知道找谁**：每件事有中介和对接人，一键复制邮件。
5. **一气呵成**：
   - 就地新建、就地改，撤销代替确认弹窗。
   - 只有清空数据、从备份恢复、更换数据文件夹这三件还要确认。
6. **只记你需要的**：不维护流程状态。事项只有「未完成 / 已完成」。
   - 不做：请补发、等回件、交办状态、规则核对来源。

参考产品气质：Notion、Wise、Linear。用户不迁移旧数据，会重新录入。

## 3. 视觉规范（DESIGN.md 要点）

- **配色**：
  - 黑白为底，唯一强调色 lime `#D9F46B`，只用于选中和高亮链路。
  - 琥珀色表示「需要注意」，红色只用于已逾期或已过期。
- **集团色**：6 色色点（`#4F7CF7` `#2BA889` `#E07A2E` `#B05CD6` `#D64F6E` `#3AA0C9`），不含 lime。
- **日期写法**：「2026年10月13日」，不加空格。
- **按钮**：每屏最多一个黑色主按钮；危险操作用红字，放在底部。
- **中英混排**：中文句子里夹拉丁文名称时，两侧补空格（`latinPad` / `latinPadStart` / `latinPadEnd`）。
- **列表 + 详情页面**：两栏等高、底边对齐，内容在卡片内滚动。
- **设置**：
  - 居中浮层，左侧四组导航。
  - 行 = 左边名称加灰色说明，右边控件；不用行首图标方块。

## 4. 技术栈与代码

- **框架**：Tauri 2 + React 18 + TypeScript + Vite；测试用 vitest（46 个）；截图自查用 Playwright。
- **数据**：
  - 数据文件夹里每类数据一个 JSON 文件，`snapshots/` 存快照，`charter.json` 是标记文件。
  - 字段与 Swift 旧版兼容。
- **平台层**：`TauriPlatform`（桌面）和 `MemoryPlatform`（浏览器调试）。浏览器打开 `?sample` 会自动载入示例数据。
- **Store**：`src/state/store.ts`，用 immer 做 commit，持久化写入队列，带撤销栈。

主要文件：

| 文件 | 内容 |
|---|---|
| `screens/Shell.tsx` | 侧栏：结构 / 到期 / 中介，档案：公司 / 文件 / 人员，接下来 90 天 |
| `screens/Structure.tsx` | 结构图（Charter 3 画布：时间轴、代持虚线、核对股东、拖动）；集团切换 `BrandPills`；导出 PDF / PNG |
| `screens/InfoCard.tsx` | 结构图右侧信息卡 |
| `screens/CompanyPage.tsx` | 公司页：两栏、就地编辑、拖入归档 |
| `screens/Companies.tsx` | 公司列表（左栏）+ 旧的档案清单组件 |
| `screens/Due.tsx` | 到期：确认或改日期、单件指定中介、邮件草稿、完成 / 附回执、导出 |
| `screens/Agents.tsx` | 中介：多位对接人；`InlineText` 就地编辑组件 |
| `screens/NewCompany.tsx` | 一张表新建公司（股东可当场新建、年审日期预览） |
| `screens/Settings.tsx` | 设置浮层：数据与同步、提醒、集团、档案清单、文件包用途、合规规则、备份与恢复 |
| `state/actions.ts` | 配置导入导出、`stage` / `commitStaged`、`quickArchive`（拖入直接归档） |
| `services/backup.ts` | 完整备份 ZIP 与恢复 |
| `domain/engine.ts` | 到期计算（规则 → 事项；事件型规则由变更记录触发） |
| `CHARTER4-PLAN.md` | 4.1 方案与对齐记录 |

Store 中 Charter 4 新增的接口：
- **集团**：`brandOf`、`brandColor`、`brandScope`。
- **新建与就地编辑**：
  - `createCompanyFull`：一张表新建公司。
  - `editCompanyField`、`addShareholderInline`、`endHolding`、`setHoldingPercent`、`addOfficer`、`endAppointment`、`setChangeDate`。这几个就地编辑接口都会自动写入变更历史。
- **到期**：`confirmDue`，写入 `record.dateConfirmed` / `overrideDue`。

## 5. 构建与发布（只做 Mac，暂不签名、不做自动更新）

- **代码**：
  - 开发容器：`/home/claude/Charter`。
  - 用户 Mac：`~/Downloads/Charter/desktop`，git tag 有 `v4.0.0`、`v4.0.1`、`v4.1.0`。
- **打包**：
  - 在访达里双击 `desktop/build-mac.command`，它依次跑 npm install → npm test → `tauri build --bundles app,dmg`，日志写到 `build-mac.log`。
  - 同步代码时用新的压缩包文件名，同名文件会被缓存。
  - 不要同时启动两次构建：会出现 “Blocking waiting for file lock”，而且装出来的 app 会显示 “asset not found: index.html”。
  - 打完后核对二进制里包含当前 `dist/assets/index-*.js`。
- **安装包**：`~/Downloads/Charter/Charter_4.1.0_aarch64.dmg`。未签名，首次打开要右键 → 打开。
- **待删除**：`~/Downloads/Charter/_to_delete/` 里是旧安装包和传输包，等用户手动删除；Mac 那边的连接没有删除权限。

## 6. 版本历程

- **3.0.1**：设计规范检查、完整备份、拖动窗口修复。
- **4.0.0**：Charter 4 首版（结构首页、到期、中介、⌘K、一张表新建公司）。
- **4.0.1**：两套结构图合并，保留 Charter 3 画布；时间轴收进「历史」；公司页只留列表。
- **4.1.0**：
  - 删掉旧页面：总览、负责方、合规日历、矩阵。
  - 去掉的功能：请补发、内部部门、合规开关、向上穿透。
  - 改叫法：「品牌」改为「集团」，「负责方」改为「中介」。
  - 设置改成浮层，新增「集团」页。
  - 公司页改为两栏、就地编辑。
  - 文件拖入公司即归档。
  - 到期事项可确认或改日期、附回执。
  - 结构图可导出 PDF。

## 7. 设计稿

设计画布「Charter 4 关键界面」（Artifact）：1 首页、2 ⌘K、3 新建公司、4 公司页、5 到期、6 中介、7 可点击原型、8 设置·提醒、9 设置·集团。

## 8. 已知未做 / 可能的下一步

- 文件页、人员页仍是 Charter 3 样式，可按公司页的思路再走一遍。
- 旧的导入核对向导（批量或认不出归属时使用）还是 Charter 3 的大向导，可以再简化。
- 「更多资料」（曾用名、别名、备注）仍用旧的公司编辑弹窗。
- 证书到期日：「按文件到期」类规则会随归档自动更新。年审类按成立日期算，不受证书影响。
- Windows 版暂缓。
