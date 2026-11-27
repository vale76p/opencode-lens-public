import Foundation
import UserNotifications

/// Native notifications: shown also while the app is in front; a click opens the dashboard
/// on the page the notification carries.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    /// A notification was clicked: the dashboard page (hash) to show.
    var onOpen: ((String) -> Void)?

    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }

    /// Asks for the permission (the system asks only the first time).
    func start() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Whether the person turned the notifications off for the app.
    func denied() async -> Bool {
        await center.notificationSettings().authorizationStatus == .denied
    }

    /// `id` replaces an earlier notification with the same id; nil error when it was accepted.
    @discardableResult
    func post(id: String, title: String, body: String, page: String = "adesso") async -> (any Error)? {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["page": page]
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            return nil
        } catch {
            return error
        }
    }

    func remove(id: String) {
        center.removeDeliveredNotifications(withIdentifiers: [id])
        center.removePendingNotificationRequests(withIdentifiers: [id])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let page = response.notification.request.content.userInfo["page"] as? String ?? "adesso"
        await MainActor.run { self.onOpen?(page) }
    }
}
