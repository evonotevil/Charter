import Foundation

enum RegressionError: Error, CustomStringConvertible {
    case failed(String)
    var description: String {
        switch self { case .failed(let message): message }
    }
}

@discardableResult
func run(_ executable: String, _ arguments: [String], in directory: URL) throws -> Data {
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.currentDirectoryURL = directory
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    let stdout = output.fileHandleForReading.readDataToEndOfFile()
    let stderr = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw RegressionError.failed(String(data: stderr, encoding: .utf8) ?? "命令失败：\(executable)")
    }
    return stdout
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let packagerURL = root.appendingPathComponent("Charter/Services/Packager.swift")
let packager = try String(contentsOf: packagerURL, encoding: .utf8)
guard let writerStart = packager.range(of: "enum ZipWriter"),
      let writerEnd = packager.range(of: "/// 生成简单的 PDF", range: writerStart.lowerBound..<packager.endIndex) else {
    throw RegressionError.failed("找不到 ZipWriter 源码范围")
}
let implementation = String(packager[writerStart.lowerBound..<writerEnd.lowerBound])

let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("charter-export-regression-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }

let generated = temporary.appendingPathComponent("ZipRegressionMain.swift")
let executable = temporary.appendingPathComponent("zip-regression")
let generatedSource = #"""
import Foundation

struct ExportEntry: Sendable {
    enum Payload: Sendable { case file(URL); case data(Data) }
    var path: String
    var payload: Payload
}

"""# + implementation + #"""

@main
struct Main {
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let source = directory.appendingPathComponent("large-source.bin")
        let large = Data((0..<(2 * 1_048_576 + 137)).map { UInt8($0 % 251) })
        try large.write(to: source)
        let zip = directory.appendingPathComponent("回归测试.zip")
        try ZipWriter.write(entries: [
            ExportEntry(path: "材料包/中文目录/说明.txt", payload: .data(Data("Charter 导出".utf8))),
            ExportEntry(path: "payload/large.bin", payload: .file(source))
        ], to: zip) { done, total in
            precondition(done <= total)
        }
        print(zip.path)
    }
}
"""#
try generatedSource.write(to: generated, atomically: true, encoding: .utf8)

try run("/usr/bin/swiftc", ["-parse-as-library", generated.path, "-o", executable.path], in: root)
let zipPath = String(data: try run(executable.path, [temporary.path], in: root), encoding: .utf8)!.trimmingCharacters(in: .whitespacesAndNewlines)
try run("/usr/bin/unzip", ["-t", zipPath], in: root)
let archive = try Data(contentsOf: URL(fileURLWithPath: zipPath))
let utf8Name = Data("材料包/中文目录/说明.txt".utf8)
func le16(_ offset: Int) -> Int { Int(archive[offset]) | Int(archive[offset + 1]) << 8 }
var cursor = 0
var foundUTF8Name = false
while cursor + 46 <= archive.count {
    if archive[cursor] == 0x50, archive[cursor + 1] == 0x4b, archive[cursor + 2] == 0x01, archive[cursor + 3] == 0x02 {
        let flags = le16(cursor + 8)
        let nameLength = le16(cursor + 28)
        let extraLength = le16(cursor + 30)
        let commentLength = le16(cursor + 32)
        let nameStart = cursor + 46
        guard nameStart + nameLength <= archive.count else { break }
        if archive[nameStart..<(nameStart + nameLength)] == utf8Name, flags & 0x0800 != 0 { foundUTF8Name = true }
        cursor = nameStart + nameLength + extraLength + commentLength
    } else {
        cursor += 1
    }
}
guard foundUTF8Name else { throw RegressionError.failed("中央目录没有保留 UTF-8 文件名或 UTF-8 标志") }
let extractedLarge = try run("/usr/bin/unzip", ["-p", zipPath, "payload/large.bin"], in: root)
guard extractedLarge.count == 2 * 1_048_576 + 137 else { throw RegressionError.failed("流式文件长度不一致") }
print("ZIP regression passed: UTF-8 names, CRC and streamed file contents are valid.")
