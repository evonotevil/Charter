import AppKit

enum SheetMetrics {
    /// Leave room for the title bar and sheet margins on a 13-inch display.
    static func height(_ preferred: CGFloat) -> CGFloat {
        max(360, min(preferred, (NSScreen.main?.visibleFrame.height ?? 900) - 180))
    }
}
