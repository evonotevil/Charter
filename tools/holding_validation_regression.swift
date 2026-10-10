import Foundation

@main
enum HoldingValidationRegression {
    static func main() throws {
        let companies: Set<String> = ["target", "other"]
        let people: Set<String> = ["a", "b", "bo"]
        let a = NodeRef(kind: .person, id: "a")
        let b = NodeRef(kind: .person, id: "b")
        let d1 = Day(2025, 1, 1)
        let d2 = Day(2026, 1, 1)

        try HoldingValidation.validate([
            Holding(holder: a, companyID: "target", percent: 70, from: nil, to: d1),
            Holding(holder: b, companyID: "target", percent: 60, from: d1),
        ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])

        // A holding created and replaced on the same day is an empty [day, day) history row.
        try HoldingValidation.validate([
            Holding(holder: a, companyID: "target", percent: 100, from: d1, to: d1),
            Holding(holder: b, companyID: "target", percent: 100, from: d1),
        ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])

        expectFailure(.exceedsOneHundred(companyID: "target", on: d1)) {
            try HoldingValidation.validate([
                Holding(holder: a, companyID: "target", percent: 70, from: d1),
                Holding(holder: b, companyID: "target", percent: 40, from: d1),
            ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        }
        expectFailure(.exceedsOneHundred(companyID: "target", on: nil)) {
            try HoldingValidation.validate([
                Holding(holder: a, companyID: "target", percent: 60, to: d1),
                Holding(holder: b, companyID: "target", percent: 60, to: d2),
            ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        }
        expectFailure(.invalidPeriod) {
            try HoldingValidation.validate([
                Holding(holder: a, companyID: "target", percent: 50, from: d2, to: d1),
            ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        }
        expectFailure(.invalidPercent) {
            try HoldingValidation.validate([
                Holding(holder: a, companyID: "target", percent: .nan),
            ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        }
        expectFailure(.unknownBeneficialOwner(NodeRef(kind: .person, id: "missing"))) {
            try HoldingValidation.validate([
                Holding(holder: a, companyID: "target", percent: 50, isNominee: true,
                        beneficialOwner: NodeRef(kind: .person, id: "missing")),
            ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        }

        // Invalid legacy data on an unrelated company does not block editing target.
        try HoldingValidation.validate([
            Holding(holder: a, companyID: "target", percent: 100),
            Holding(holder: a, companyID: "other", percent: 80),
            Holding(holder: b, companyID: "other", percent: 80),
        ], companyIDs: companies, personIDs: people, changedCompanyIDs: ["target"])
        print("Holding validation regression passed.")
    }

    private static func expectFailure(_ expected: HoldingValidationError, _ operation: () throws -> Void) {
        do {
            try operation()
            preconditionFailure("Expected \(expected)")
        } catch let error as HoldingValidationError {
            precondition(error == expected, "Expected \(expected), got \(error)")
        } catch {
            preconditionFailure("Unexpected error: \(error)")
        }
    }
}
