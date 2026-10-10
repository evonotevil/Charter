import Foundation

/// 不带时区的日历日期，例如 2026-10-08。
/// 截止日、签发日、成立日都用它表示，避免跨时区时日期漂移。
struct Day: Hashable, Comparable, Codable, CustomStringConvertible {
    var year: Int
    var month: Int
    var day: Int

    init(_ year: Int, _ month: Int, _ day: Int) {
        self.year = year
        self.month = month
        self.day = min(max(day, 1), Day.daysIn(year: year, month: month))
    }

    /// 某个时区里的“今天”。
    static func today(in timeZone: TimeZone = .current) -> Day {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: Date())
        return Day(c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    init(date: Date, timeZone: TimeZone = .current) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        self.init(c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    /// 解析 "2026-10-08"。
    init?(string: String) {
        let parts = string.trimmingCharacters(in: .whitespaces).split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), (1...31).contains(d) else { return nil }
        self.init(y, m, d)
    }

    var description: String { String(format: "%04d-%02d-%02d", year, month, day) }

    // MARK: Codable as "yyyy-MM-dd"
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        let s = try c.decode(String.self)
        guard let d = Day(string: s) else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "日期格式应为 yyyy-MM-dd：\(s)")
        }
        self = d
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(description)
    }

    static func < (a: Day, b: Day) -> Bool {
        (a.year, a.month, a.day) < (b.year, b.month, b.day)
    }

    // MARK: Arithmetic

    private static let utc: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    static func daysIn(year: Int, month: Int) -> Int {
        let comps = DateComponents(year: year, month: month, day: 1)
        guard let date = utc.date(from: comps), let range = utc.range(of: .day, in: .month, for: date) else { return 28 }
        return range.count
    }

    var isLastDayOfMonth: Bool { day == Day.daysIn(year: year, month: month) }

    /// UTC 零点，仅用于计算。
    var utcDate: Date {
        Day.utc.date(from: DateComponents(year: year, month: month, day: day)) ?? Date()
    }

    /// 本地时区某个钟点，用于通知与日历。
    func date(hour: Int = 9, timeZone: TimeZone = .current) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = timeZone
        return cal.date(from: DateComponents(year: year, month: month, day: day, hour: hour)) ?? Date()
    }

    func adding(days n: Int) -> Day {
        let d = Day.utc.date(byAdding: .day, value: n, to: utcDate) ?? utcDate
        return Day(date: d, timeZone: TimeZone(identifier: "UTC")!)
    }

    /// 加月份；如果原日期是月末，结果也取月末（3 月 31 日 + 2 个月 = 5 月 31 日）。
    func adding(months n: Int) -> Day {
        let total = (year * 12 + (month - 1)) + n
        let y = total / 12, m = total % 12 + 1
        if isLastDayOfMonth { return Day(y, m, Day.daysIn(year: y, month: m)) }
        return Day(y, m, day)
    }

    func days(until other: Day) -> Int {
        Day.utc.dateComponents([.day], from: utcDate, to: other.utcDate).day ?? 0
    }

    /// 1 = 星期日 … 7 = 星期六
    var weekday: Int { Day.utc.component(.weekday, from: utcDate) }
    var isWeekend: Bool { weekday == 1 || weekday == 7 }

    // MARK: Display

    var short: String { "\(month) 月 \(day) 日" }
    var long: String { "\(year) 年 \(month) 月 \(day) 日" }
    var weekdayName: String { ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][weekday - 1] }

    /// 今年内的日期省略年份。
    func display(relativeTo today: Day) -> String { year == today.year ? short : long }

    /// “今天”“昨天”“3 天前”。
    func ago(from today: Day) -> String {
        let n = days(until: today)
        switch n {
        case ..<0: return "\(-n) 天后"
        case 0: return "今天"
        case 1: return "昨天"
        default: return "\(n) 天前"
        }
    }
}

/// 每年的某月某日，例如财年结束日 12-31。
struct MonthDay: Hashable, Codable, CustomStringConvertible {
    var month: Int
    var day: Int

    init(_ month: Int, _ day: Int) { self.month = month; self.day = day }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        let s = try c.decode(String.self)
        let p = s.split(separator: "-")
        guard p.count == 2, let m = Int(p[0]), let d = Int(p[1]) else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "月日格式应为 MM-dd：\(s)")
        }
        month = m; day = d
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(description)
    }

    var description: String { String(format: "%02d-%02d", month, day) }
    var label: String { "\(month) 月 \(day) 日" }

    func inYear(_ y: Int) -> Day { Day(y, month, day) }
}
