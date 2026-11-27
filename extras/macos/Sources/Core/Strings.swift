import Foundation

/// The app's languages: the dashboard's (public/i18n.js LANGS).
public enum Lang: String, CaseIterable, Sendable { case it, en, fr }

/// A forced language (LENS_LANG of the plist) or, with "auto" or nothing, the first supported
/// one of `preferred` (Locale.preferredLanguages), else English: public/i18n.js resolveLang.
public func resolveLang(_ pref: String?, preferred: [String]) -> Lang {
    if let pref, let lang = Lang(rawValue: pref.lowercased()) { return lang }
    for tag in preferred {
        let base = tag.lowercased().split(separator: "-").first.map(String.init) ?? ""
        if let lang = Lang(rawValue: base) { return lang }
    }
    return .en
}

/// One key per text a person reads in the app (window, menus, error page, notifications).
public enum Key: String, CaseIterable, Sendable {
    // app menu
    case about, settings, hide, hideOthers, showAll, quit
    // Edit
    case editMenu, undo, redo, cut, copy, paste, selectAll
    // View
    case viewMenu, reload, back, forward, actualSize, zoomIn, zoomOut, openInBrowser
    // Window
    case windowMenu, minimize, zoom, dashboard, close
    // Help
    case helpMenu, guide
    // JavaScript dialogs
    case ok, cancel
    // error page
    case unreachableTitle, unreachableDetail, unauthorizedTitle, unauthorizedDetail
    case unsupportedHostTitle, unsupportedHostDetail, retry, retryIn, retrying
    // notifications
    case budgetTitle, budgetTotal, budgetModel, budgetSummaryTitle, budgetSummaryMore
    case periodDay, periodWeek, periodMonth, metricTokens, metricCost, metricSteps
    case lensDownTitle, lensDownBody, lensBackTitle, lensBackBody
    case testNotification, testTitle, testBody, testFailed, notificationsOff
    // Dock menu
    case statusUp, statusDown, statusChecking, statusExceeded
    // Open at Login
    case openAtLogin, loginNeedsApproval, loginOnlyInApplications, loginFailed
}

/// Texts in it/en/fr with {name} placeholders, terms as in docs/traduzioni.md (token, budget,
/// step, LaunchAgent, dashboard and plist stay in English; Lens, OpenCode and Monitor are names).
public enum Strings {
    static let table: [Key: [Lang: String]] = [
        .about: [.it: "Informazioni su OpenCode Lens", .en: "About OpenCode Lens", .fr: "À propos d'OpenCode Lens"],
        .settings: [.it: "Impostazioni…", .en: "Settings…", .fr: "Paramètres…"],
        .hide: [.it: "Nascondi OpenCode Lens", .en: "Hide OpenCode Lens", .fr: "Masquer OpenCode Lens"],
        .hideOthers: [.it: "Nascondi altre", .en: "Hide Others", .fr: "Masquer les autres"],
        .showAll: [.it: "Mostra tutte", .en: "Show All", .fr: "Tout afficher"],
        .quit: [.it: "Esci da OpenCode Lens", .en: "Quit OpenCode Lens", .fr: "Quitter OpenCode Lens"],

        .editMenu: [.it: "Modifica", .en: "Edit", .fr: "Édition"],
        .undo: [.it: "Annulla", .en: "Undo", .fr: "Annuler"],
        .redo: [.it: "Ripristina", .en: "Redo", .fr: "Rétablir"],
        .cut: [.it: "Taglia", .en: "Cut", .fr: "Couper"],
        .copy: [.it: "Copia", .en: "Copy", .fr: "Copier"],
        .paste: [.it: "Incolla", .en: "Paste", .fr: "Coller"],
        .selectAll: [.it: "Seleziona tutto", .en: "Select All", .fr: "Tout sélectionner"],

        .viewMenu: [.it: "Vista", .en: "View", .fr: "Présentation"],
        .reload: [.it: "Ricarica", .en: "Reload", .fr: "Recharger"],
        .back: [.it: "Indietro", .en: "Back", .fr: "Précédent"],
        .forward: [.it: "Avanti", .en: "Forward", .fr: "Suivant"],
        .actualSize: [.it: "Dimensioni reali", .en: "Actual Size", .fr: "Taille réelle"],
        .zoomIn: [.it: "Ingrandisci", .en: "Zoom In", .fr: "Agrandir"],
        .zoomOut: [.it: "Riduci", .en: "Zoom Out", .fr: "Réduire"],
        .openInBrowser: [.it: "Apri nel browser", .en: "Open in Browser", .fr: "Ouvrir dans le navigateur"],

        .windowMenu: [.it: "Finestra", .en: "Window", .fr: "Fenêtre"],
        .minimize: [.it: "Contrai", .en: "Minimize", .fr: "Placer dans le Dock"],
        .zoom: [.it: "Zoom", .en: "Zoom", .fr: "Zoom"],
        .dashboard: [.it: "Dashboard", .en: "Dashboard", .fr: "Dashboard"],
        .close: [.it: "Chiudi", .en: "Close", .fr: "Fermer"],

        .helpMenu: [.it: "Aiuto", .en: "Help", .fr: "Aide"],
        .guide: [.it: "Guida di OpenCode Lens", .en: "OpenCode Lens Help", .fr: "Aide d'OpenCode Lens"],

        .ok: [.it: "OK", .en: "OK", .fr: "OK"],
        .cancel: [.it: "Annulla", .en: "Cancel", .fr: "Annuler"],

        .unreachableTitle: [.it: "La lens non risponde", .en: "The lens is not responding", .fr: "La lens ne répond pas"],
        .unreachableDetail: [
            .it: "Nessuna risposta da http://{address}. Controlla che il LaunchAgent della lens sia attivo (npm run check, oppure Monitor).",
            .en: "No answer from http://{address}. Check that the lens's LaunchAgent is running (npm run check, or Monitor).",
            .fr: "Aucune réponse de http://{address}. Vérifiez que le LaunchAgent de la lens est actif (npm run check, ou Monitor).",
        ],
        .unauthorizedTitle: [.it: "Token mancante o errato", .en: "Missing or wrong token", .fr: "Token manquant ou incorrect"],
        .unauthorizedDetail: [
            .it: "La lens su http://{address} chiede un token e quello del plist non è accettato. Controlla LENS_TOKEN nel plist del LaunchAgent.",
            .en: "The lens at http://{address} asks for a token and the plist's one is not accepted. Check LENS_TOKEN in the LaunchAgent's plist.",
            .fr: "La lens sur http://{address} demande un token et celui du plist n'est pas accepté. Vérifiez LENS_TOKEN dans le plist du LaunchAgent.",
        ],
        .unsupportedHostTitle: [.it: "Indirizzo non supportato", .en: "Unsupported address", .fr: "Adresse non prise en charge"],
        .unsupportedHostDetail: [
            .it: "LENS_HOST={host}: l'app si collega solo a 127.0.0.1 o localhost. Apri la dashboard nel browser.",
            .en: "LENS_HOST={host}: the app connects only to 127.0.0.1 or localhost. Open the dashboard in a browser.",
            .fr: "LENS_HOST={host} : l'app se connecte uniquement à 127.0.0.1 ou localhost. Ouvrez le dashboard dans le navigateur.",
        ],
        .retry: [.it: "Riprova", .en: "Try Again", .fr: "Réessayer"],
        .retryIn: [.it: "Nuovo tentativo tra {seconds} s", .en: "Trying again in {seconds} s", .fr: "Nouvel essai dans {seconds} s"],
        .retrying: [.it: "Nuovo tentativo…", .en: "Trying again…", .fr: "Nouvel essai…"],

        .budgetTitle: [.it: "Budget superato", .en: "Budget exceeded", .fr: "Budget dépassé"],
        .budgetTotal: [.it: "{period}, {metric}: {percent}% del budget", .en: "{period}, {metric}: {percent}% of the budget", .fr: "{period}, {metric} : {percent} % du budget"],
        .budgetModel: [.it: "{model}: {percent}% del budget di oggi", .en: "{model}: {percent}% of today's budget", .fr: "{model} : {percent} % du budget du jour"],
        .budgetSummaryTitle: [.it: "Budget superati: {count}", .en: "Budgets exceeded: {count}", .fr: "Budgets dépassés : {count}"],
        .budgetSummaryMore: [.it: "e altri {count}", .en: "and {count} more", .fr: "et {count} autres"],
        .periodDay: [.it: "Oggi", .en: "Today", .fr: "Aujourd'hui"],
        .periodWeek: [.it: "Questa settimana", .en: "This week", .fr: "Cette semaine"],
        .periodMonth: [.it: "Questo mese", .en: "This month", .fr: "Ce mois-ci"],
        .metricTokens: [.it: "token", .en: "tokens", .fr: "tokens"],
        .metricCost: [.it: "costo", .en: "cost", .fr: "coût"],
        .metricSteps: [.it: "step", .en: "steps", .fr: "steps"],
        .lensDownTitle: [.it: "La lens non risponde", .en: "The lens is not responding", .fr: "La lens ne répond pas"],
        .lensDownBody: [
            .it: "Nessuna risposta da {address} negli ultimi controlli.",
            .en: "No answer from {address} in the last checks.",
            .fr: "Aucune réponse de {address} lors des derniers contrôles.",
        ],
        .lensBackTitle: [.it: "La lens risponde di nuovo", .en: "The lens is responding again", .fr: "La lens répond de nouveau"],
        .lensBackBody: [.it: "{address} risponde.", .en: "{address} is answering.", .fr: "{address} répond."],
        .testNotification: [.it: "Invia una notifica di prova", .en: "Send a Test Notification", .fr: "Envoyer une notification de test"],
        .testTitle: [.it: "Notifica di prova", .en: "Test notification", .fr: "Notification de test"],
        .testBody: [.it: "Le notifiche di OpenCode Lens funzionano.", .en: "OpenCode Lens notifications work.", .fr: "Les notifications d'OpenCode Lens fonctionnent."],
        .testFailed: [.it: "Notifica non inviata: {error}", .en: "Notification not sent: {error}", .fr: "Notification non envoyée : {error}"],
        .notificationsOff: [
            .it: "Le notifiche di OpenCode Lens sono disattivate: attivale in Impostazioni di Sistema › Notifiche.",
            .en: "OpenCode Lens notifications are turned off: turn them on in System Settings › Notifications.",
            .fr: "Les notifications d'OpenCode Lens sont désactivées : activez-les dans Réglages Système › Notifications.",
        ],
        .statusUp: [.it: "La lens risponde ({address})", .en: "The lens is responding ({address})", .fr: "La lens répond ({address})"],
        .statusDown: [.it: "La lens non risponde ({address})", .en: "The lens is not responding ({address})", .fr: "La lens ne répond pas ({address})"],
        .statusChecking: [.it: "Controllo della lens in corso…", .en: "Checking the lens…", .fr: "Contrôle de la lens en cours…"],
        .statusExceeded: [.it: "Budget superati: {count}", .en: "Budgets exceeded: {count}", .fr: "Budgets dépassés : {count}"],

        .openAtLogin: [.it: "Apri al login", .en: "Open at Login", .fr: "Ouvrir à la connexion"],
        .loginNeedsApproval: [
            .it: "Apri al login (da approvare in Impostazioni di Sistema)",
            .en: "Open at Login (to approve in System Settings)",
            .fr: "Ouvrir à la connexion (à approuver dans Réglages Système)",
        ],
        .loginOnlyInApplications: [
            .it: "Disponibile con l'app in ~/Applications o /Applications: bash app.sh install.",
            .en: "Available with the app in ~/Applications or /Applications: bash app.sh install.",
            .fr: "Disponible avec l'app dans ~/Applications ou /Applications : bash app.sh install.",
        ],
        .loginFailed: [.it: "Apri al login non modificato: {error}", .en: "Open at Login not changed: {error}", .fr: "Ouvrir à la connexion non modifié : {error}"],
    ]

    /// The text of `key` in `lang` with every {name} replaced by args[name].
    public static func t(_ key: Key, _ lang: Lang, _ args: [String: String] = [:]) -> String {
        var s = table[key]?[lang] ?? table[key]?[.en] ?? key.rawValue
        for (name, value) in args { s = s.replacingOccurrences(of: "{\(name)}", with: value) }
        return s
    }

    /// The {name} placeholders of a text, for the tests that check the three languages agree.
    public static func placeholders(_ text: String) -> Set<String> {
        var out = Set<String>()
        var rest = text[...]
        while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
            out.insert(String(rest[rest.index(after: open)..<close]))
            rest = rest[rest.index(after: close)...]
        }
        return out
    }
}
