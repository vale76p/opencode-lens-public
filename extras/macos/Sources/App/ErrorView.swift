import AppKit

/// The native page shown instead of the dashboard when it cannot be loaded: a title, a
/// selectable detail, «Try again» (Return) and the countdown to the next automatic attempt.
/// Native on purpose: nothing is injected into the web view.
@MainActor
final class ErrorView: NSView {
    private let titleField = NSTextField(labelWithString: "")
    private let detailField = NSTextField(wrappingLabelWithString: "")
    private let countdownField = NSTextField(labelWithString: "")
    private let button: NSButton

    init(retryTitle: String, target: AnyObject, action: Selector) {
        button = NSButton(title: retryTitle, target: target, action: action)
        super.init(frame: .zero)
        titleField.font = .systemFont(ofSize: 22, weight: .semibold)
        titleField.alignment = .center
        detailField.alignment = .center
        detailField.isSelectable = true
        detailField.textColor = .secondaryLabelColor
        detailField.preferredMaxLayoutWidth = 480
        countdownField.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
        countdownField.textColor = .tertiaryLabelColor
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"

        let stack = NSStackView(views: [titleField, detailField, button, countdownField])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.setCustomSpacing(22, after: detailField)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 520),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var isOpaque: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
    }

    func show(title: String, detail: String) {
        titleField.stringValue = title
        detailField.stringValue = detail
    }

    /// The line under the button: the countdown, «Trying again…» or nothing.
    func setCountdown(_ text: String) {
        countdownField.stringValue = text
    }
}
