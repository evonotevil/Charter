import Foundation
import EventKit
import CoreGraphics

/// 把未完成事项写进一个独立的“Charter”日历。单向同步：只由主 Mac 写入。
/// 每个事件的 URL 记着事项编号，靠它来更新和删除，不会重复创建。
@MainActor
final class CalendarSync {
    static let shared = CalendarSync()
    private let eventStore = EKEventStore()
    private var granted: Bool?
    private(set) var lastError: String?

    func requestAccess() async -> Bool {
        if let granted { return granted }
        let ok = (try? await eventStore.requestFullAccessToEvents()) ?? false
        granted = ok
        return ok
    }

    private func calendar(named name: String) -> EKCalendar? {
        if let c = eventStore.calendars(for: .event).first(where: { $0.title == name }) { return c }
        let cal = EKCalendar(for: .event, eventStore: eventStore)
        cal.title = name
        cal.cgColor = CGColor(red: 0.659, green: 0.075, blue: 0.169, alpha: 1)
        let sources = eventStore.sources
        cal.source = sources.first(where: { $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud") })
            ?? eventStore.defaultCalendarForNewEvents?.source
            ?? sources.first(where: { $0.sourceType == .local })
        do {
            try eventStore.saveCalendar(cal, commit: true)
            return cal
        } catch {
            lastError = "无法创建日历：\(error.localizedDescription)"
            return nil
        }
    }

    func sync(store: AppStore) async {
        guard await requestAccess(), let cal = calendar(named: store.settings.calendarName) else { return }
        let start = store.today.adding(days: -60).date(hour: 0)
        let end = store.today.adding(days: 400).date(hour: 0)
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: [cal])
        let existing = eventStore.events(matching: predicate)
        var byKey: [String: EKEvent] = [:]
        for e in existing {
            if let u = e.url?.absoluteString, u.hasPrefix("charter://obligation/") {
                byKey[String(u.dropFirst("charter://obligation/".count))] = e
            }
        }

        var wanted = Set<String>()
        for o in store.openObligations where o.due <= store.today.adding(days: 400) {
            let key = o.key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? o.key
            wanted.insert(key)
            let title = "\(o.company.name)：\(o.rule.name)"
            let party = store.responsibleParty(for: o)?.name
            let notes = [o.rule.schedule.summary, party.map { "负责方：\($0)" }, o.status == .pending ? nil : "状态：\(o.status.label)"]
                .compactMap { $0 }.joined(separator: "\n")
            let e = byKey[key] ?? EKEvent(eventStore: eventStore)
            let day = o.due.date(hour: 0)
            if e.title != title || e.startDate != day || e.notes != notes || e.calendar != cal {
                e.calendar = cal
                e.title = title
                e.isAllDay = true
                e.startDate = day
                e.endDate = day
                e.notes = notes
                e.url = URL(string: "charter://obligation/\(key)")
                try? eventStore.save(e, span: .thisEvent, commit: false)
            }
        }
        for (key, e) in byKey where !wanted.contains(key) {
            try? eventStore.remove(e, span: .thisEvent, commit: false)
        }
        try? eventStore.commit()
    }
}
