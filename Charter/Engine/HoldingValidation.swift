import Foundation

enum HoldingValidationError: LocalizedError, Equatable {
    case unknownCompany(String)
    case unknownHolder(NodeRef)
    case unknownBeneficialOwner(NodeRef)
    case invalidPercent
    case invalidPeriod
    case exceedsOneHundred(companyID: String, on: Day?)

    var errorDescription: String? {
        switch self {
        case .unknownCompany:
            "被持股公司已经不存在，请重新选择。"
        case .unknownHolder:
            "股东已经不存在，请重新选择。"
        case .unknownBeneficialOwner:
            "实际受益人已经不存在，请重新选择。"
        case .invalidPercent:
            "持股比例必须大于 0% 且不超过 100%。"
        case .invalidPeriod:
            "持股结束日期不能早于生效日期。"
        case .exceedsOneHundred(_, let day):
            if let day { "\(day.long) 的持股合计超过 100%，请检查重叠的持股记录。" }
            else { "最早一条记录之前的持股合计超过 100%，请检查没有生效日期的持股。" }
        }
    }
}

enum HoldingValidation {
    /// 校验候选快照中被修改公司的全部持股。时间区间按 [from, to) 计算；
    /// 只检查 changedCompanyIDs，避免其他公司的旧数据阻塞当前编辑。
    static func validate(
        _ holdings: [Holding],
        companyIDs: Set<String>,
        personIDs: Set<String>,
        changedCompanyIDs: Set<String>
    ) throws {
        for companyID in changedCompanyIDs {
            guard companyIDs.contains(companyID) else {
                throw HoldingValidationError.unknownCompany(companyID)
            }
            let relevant = holdings.filter { $0.companyID == companyID }
            for holding in relevant {
                guard holding.percent.isFinite, holding.percent > 0, holding.percent <= 100 else {
                    throw HoldingValidationError.invalidPercent
                }
                if let from = holding.from, let to = holding.to, to < from {
                    throw HoldingValidationError.invalidPeriod
                }
                guard exists(holding.holder, companyIDs: companyIDs, personIDs: personIDs) else {
                    throw HoldingValidationError.unknownHolder(holding.holder)
                }
                if let owner = holding.beneficialOwner,
                   !exists(owner, companyIDs: companyIDs, personIDs: personIDs) {
                    throw HoldingValidationError.unknownBeneficialOwner(owner)
                }
            }

            // nil 起点的记录在第一条显式边界之前已经生效；单独检查这个区间。
            let beforeFirstBoundary = relevant.filter { $0.from == nil }.reduce(0) { $0 + $1.percent }
            if beforeFirstBoundary > 100.005 {
                throw HoldingValidationError.exceedsOneHundred(companyID: companyID, on: nil)
            }
            let boundaries = Set(relevant.flatMap { [$0.from, $0.to].compactMap { $0 } }).sorted()
            for day in boundaries {
                let total = relevant.filter { $0.isActive(on: day) }.reduce(0) { $0 + $1.percent }
                if total > 100.005 {
                    throw HoldingValidationError.exceedsOneHundred(companyID: companyID, on: day)
                }
            }
        }
    }

    private static func exists(_ ref: NodeRef, companyIDs: Set<String>, personIDs: Set<String>) -> Bool {
        switch ref.kind {
        case .company: companyIDs.contains(ref.id)
        case .person: personIDs.contains(ref.id)
        }
    }
}
