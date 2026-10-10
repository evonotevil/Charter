import Foundation

enum DocumentVersions {
    /// An older upload is retained as history rather than creating two current
    /// versions. Unknown dates use the explicit archive confirmation order.
    static func inserting(_ document: Document, into documents: [Document]) -> [Document] {
        var result = documents
        var new = document
        let current = result.filter {
            $0.owner == new.owner && $0.typeID == new.typeID && $0.supersededBy == nil
        }
        if let issued = new.issueDate,
           let newer = current.filter({ $0.issueDate.map { $0 > issued } ?? false })
            .max(by: { ($0.issueDate ?? $0.addedOn) < ($1.issueDate ?? $1.addedOn) }) {
            new.supersededBy = newer.id
        } else {
            for i in result.indices where result[i].owner == new.owner && result[i].typeID == new.typeID && result[i].supersededBy == nil {
                result[i].supersededBy = new.id
            }
        }
        result.append(new)
        return result
    }
}
