import Foundation

/// 中文句子里夹英文名称时，在两侧补空格：“由 Tortola Agents Ltd 办理”。
func latinPad(_ s: String) -> String {
    guard let first = s.unicodeScalars.first, let last = s.unicodeScalars.last else { return s }
    let isLatin: (Unicode.Scalar) -> Bool = { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == ".") }
    return (isLatin(first) ? " " : "") + s + (isLatin(last) ? " " : "")
}
