import Foundation

/// 导出任务的不可变输入。业务数据在主线程冻结成这些条目后，文件 I/O 可安全地放到后台执行。
struct ExportEntry: Sendable {
    enum Payload: Sendable {
        case file(URL)
        case data(Data)
    }

    var path: String
    var payload: Payload
}

enum ExportIO {
    /// 在后台流式写 ZIP。进度以“完成条目数 / 总条目数”汇报。
    static func writeZIP(
        entries: [ExportEntry],
        to url: URL,
        progress: @escaping @Sendable (Int, Int) -> Void
    ) async throws {
        try await Task.detached(priority: .userInitiated) {
            try ZipWriter.write(entries: entries, to: url, progress: progress)
        }.value
    }
}
