# Charter · Impeccable 六组精修与验证

日期：2026-10-10。目标：方便找到海外公司的材料、看清缺口、准备文件包，并理解公司链路和代持。保留系统字体与黑／柠檬绿／琥珀视觉方向。本轮为源码修改与隔离桌面复验；没有改写真实用户数据。

## 已完成

| 技能视角 | 修改结果 |
| --- | --- |
| Distill | 总览先展示待处理文件，再显示档案数字；删掉重复摘要和无调用的完整度仪表。 |
| Clarify | “完整度”改为“已归档比例”，避免把过期材料误解为有效；文件计数区分当前范围与当前显示；链路结论限定为已录入关系。 |
| Harden | 文件详情保存校验类型、归属、法域和重复现行版本；写入失败保留原数据与表单。持股入口统一检查日期、引用、比例与历史时段合计。 |
| Typeset / layout | 增加系统字体语义角色；保护长中日英公司名；公司标签横向可滚动；结构图短比例标签按内容估算宽度，长代持说明设上限并保留完整提示。 |
| Normalize / polish | 使用语义头像颜色，修正深色对比；公司详情直接进入“准备文件包”，全部导出保留在更多菜单；结构页统一使用侧栏集团范围，去掉重复选择器。 |

## 档案与文件包的可信度

内置法域清单明确称为“起始清单”，可以按公司自定义，也可以在设置修改通用条目。它不代表已经核实的法定要求。没有更改法域规则。

材料可标记外部保管、权限受限、未取得、待核对或不适用，保留备注。文件包缺口现在沿用这些具体原因；例如“由代理保管，需申请副本”。档案中的“不适用”不自动免除银行开户用途中的必需条目，用户需要核对接收方要求。

循环持股仍可记录，但简单穿透算法将循环相关份额归入未识别并提示单独核算，避免把循环中的公司误报为最终持有人。没有声称解决复杂交叉持股的数学计算。

## 验证结果

- Debug、Release 构建成功；只有无 AppIntents 依赖的元数据跳过提示。
- 回归覆盖档案版本、取消、复制／写入故障、回滚、同日董事变更、安全撤销、批量归档、导出历史、KYC 日期、未解析代持，以及新增的文件元数据、材料缺口原因、循环持股与持股历史校验。
- 200 文件隔离批量测试约 0.60 秒。结构快照 100 次 × 60 公司重建约 0.011 秒。这是引擎测试，不代表完整图形界面帧率。
- 桌面检查使用独立 Light / Dark 测试副本、1080pt 窗口和虚构材料；确认待处理队列、红／琥珀状态、文件包缺口、权限原因与底部操作可见。使用超长多语言公司名检查截断及完整提示。
- SwiftUI 不属于 Impeccable 网页检测器覆盖范围，其空数组没有被作为“零问题”证明。

## 尚需单独验证或改善

- 1500 份大 PDF、真实 iCloud 启动、完整导出压力和逐帧动画性能尚未测量。
- 完整 VoiceOver 与键盘路径尚未逐项验证。
- 常规公司／集团编辑的多集合保存仍需进一步处理跨集合磁盘故障的原子性。
- 已保存的手动图位置可能重叠；本次隔离数据点击“重新排列”后恢复清晰布局。跨范围的位置保存策略值得另测。
- 内置法域条目与文件包要求仍需业务人员依据实际公司和接收方要求核对。

## 修改文件

- `Charter/App/AppStore.swift`
- `Charter/App/ChangePlan.swift`
- `Charter/App/DocumentActions.swift`
- `Charter/App/GroupStore.swift`
- `Charter/App/Summary.swift`
- `Charter/Engine/Chains.swift`
- `Charter/Engine/HoldingValidation.swift`
- `Charter/Engine/Ownership.swift`
- `Charter/Model/Archive.swift`
- `Charter/Services/ArchiveExporter.swift`
- `Charter/Services/Packager.swift`
- `Charter/Views/ArchiveItemsSettings.swift`
- `Charter/Views/CompaniesView.swift`
- `Charter/Views/CompanyArchiveView.swift`
- `Charter/Views/Components.swift`
- `Charter/Views/DashboardView.swift`
- `Charter/Views/DesignSystem.swift`
- `Charter/Views/DocumentSheet.swift`
- `Charter/Views/Editors.swift`
- `Charter/Views/ExportSheet.swift`
- `Charter/Views/FilesView.swift`
- `Charter/Views/GroupViews.swift`
- `Charter/Views/PacketView.swift`
- `Charter/Views/QueryViews.swift`
- `Charter/Views/StructureView.swift`
- `tools/app_regression.swift`
- `tools/holding_validation_regression.swift`
- `tools/run-regressions.py`

## 可复核材料

项目内 `tools/six-pass-plan.md` 与三个分项计划记录本轮范围。输出目录 `/Users/lilithgames/outputs/charter-development/` 保存源码备份、`six-pass-source.diff`、`source-sha256.json`、构建与回归日志，以及两份独立测试应用。测试应用包含边界测试数据，不用于真实档案管理。
