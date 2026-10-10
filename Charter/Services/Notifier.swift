import Foundation
import UserNotifications

/// Mac 通知。只在“主 Mac”上排期，避免两台 Mac 各响一次。
@MainActor
final class Notifier {
    static let shared = Notifier()
    private let center = UNUserNotificationCenter.current()
    private let prefix = "charter."
    private var authorized: Bool?

    func requestAuthorization() async -> Bool {
        if let authorized { return authorized }
        let ok = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        authorized = ok
        return ok
    }

    func reschedule(store: AppStore) async {
        guard await requestAuthorization() else { return }
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })

        let now = Date()
        var requests: [UNNotificationRequest] = []

        // 合规模块关闭时只提醒文件到期
        for o in store.complianceOn ? store.openObligations : [] {
            for d in DeadlineEngine.reminderDays(for: o, settings: store.settings) {
                let fire = d.date(hour: store.settings.notificationHour)
                guard fire > now else { continue }
                let left = d.days(until: o.due)
                let content = UNMutableNotificationContent()
                let draft = store.trust(o).isConfirmed ? "" : "（规则待核对）"
                content.title = (left == 0 ? "今天截止：\(o.rule.name)" : "\(left) 天后截止：\(o.rule.name)") + draft
                var body = o.company.name
                if let p = store.responsibleParty(for: o) {
                    switch o.status.normalized {
                case .pending: body += "。尚未交给\(p.name)。"
                case .drafted: body += "。给\(p.name)的消息尚未确认发出。"
                default: body += "。\(p.name)正在办理。"
                }
                }
                content.body = body
                content.sound = .default
                content.userInfo = ["key": o.key]
                requests.append(request(id: "\(prefix)\(o.key)|\(d)", content: content, at: fire))
            }
            // 交办后迟迟没回音
            if o.status.isHandedOff, let since = store.lastContact(o) {
                let days = store.party(o.record?.partyID)?.followUpDays ?? 14
                let d = since.adding(days: days)
                let fire = d.date(hour: store.settings.notificationHour)
                if fire > now {
                    let content = UNMutableNotificationContent()
                    content.title = "需要催办：\(o.rule.name)"
                    content.body = "\(o.company.name)，交办 \(days) 天未回复。"
                    content.sound = .default
                    content.userInfo = ["key": o.key]
                    requests.append(request(id: "\(prefix)follow|\(o.key)", content: content, at: fire))
                }
            }
        }

        // 文件到期
        for doc in store.documents where doc.supersededBy == nil {
            guard let exp = Freshness.expiry(of: doc, type: store.docType(doc.typeID)) else { continue }
            for before in store.settings.reminderDays {
                let d = exp.adding(days: -before)
                let fire = d.date(hour: store.settings.notificationHour)
                guard fire > now else { continue }
                let content = UNMutableNotificationContent()
                content.title = "\(before) 天后到期：\(store.docType(doc.typeID)?.name ?? "文件")"
                content.body = store.name(of: doc.owner)
                content.sound = .default
                requests.append(request(id: "\(prefix)doc|\(doc.id)|\(before)", content: content, at: fire))
            }
        }

        // 系统对待发通知数量有上限，只排最近的 60 条
        let soonest = requests.sorted { fireDate($0) < fireDate($1) }.prefix(60)
        for r in soonest { try? await center.add(r) }
    }

    private func request(id: String, content: UNNotificationContent, at date: Date) -> UNNotificationRequest {
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
    }

    private func fireDate(_ r: UNNotificationRequest) -> Date {
        (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() ?? .distantFuture
    }
}
