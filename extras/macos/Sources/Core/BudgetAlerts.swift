import Foundation

/// The parts of GET /api/budget (src/queries.js budget()) the notifications read; the other
/// fields (elapsed, projected, projectedRatio, days, seen) are ignored.
/// test/macos-app-contract.test.js pins them on the lens's side.
public struct BudgetReport: Decodable, Sendable {
    public struct Measure: Decodable, Sendable {
        public let used: Double
        public let limit: Double?
        public let ratio: Double?
        /// "none" | "under" | "over" | "exceeded" (src/queries.js pace())
        public let pace: String
    }
    public struct ModelBudget: Decodable, Sendable {
        /// "provider/model"
        public let model: String
        public let used: Double
        public let limit: Double
        public let ratio: Double?
        public let pace: String
    }
    public struct Period: Decodable, Sendable {
        /// Start and end of the period, ms since the epoch.
        public let from: Double
        public let to: Double
        public let tokens: Measure
        public let cost: Measure
        public let steps: Measure
        /// Only on the day: the LENS_MODEL_LIMITS budgets.
        public let models: [ModelBudget]?
    }
    public struct Periods: Decodable, Sendable {
        public let day: Period
        public let week: Period
        public let month: Period
    }
    public let now: Double
    public let periods: Periods
}

/// One budget at or past its limit, with the key that says it was already notified.
public struct BudgetAlert: Equatable, Sendable {
    public enum Subject: Equatable, Sendable {
        /// period "day" | "week" | "month", metric "tokens" | "cost" | "steps"
        case total(period: String, metric: String)
        /// "provider/model", against its daily budget
        case model(String)
    }
    /// "<period>.<metric>.<from>" or "model.<provider/model>.<from of the day>": the period's
    /// start is always the last segment, also when the model's name has dots.
    public let key: String
    public let subject: Subject
    public let ratio: Double
}

public enum BudgetAlerts {
    /// The most notifications sent at once; more (e.g. at the first start) become one summary.
    public static let maxSingle = 3

    /// Every budget at or past its limit now (pace "exceeded": ratio >= 1).
    public static func exceeded(_ r: BudgetReport) -> [BudgetAlert] {
        var out: [BudgetAlert] = []
        for (name, p) in [("day", r.periods.day), ("week", r.periods.week), ("month", r.periods.month)] {
            for (metric, m) in [("tokens", p.tokens), ("cost", p.cost), ("steps", p.steps)] where m.pace == "exceeded" {
                out.append(BudgetAlert(key: "\(name).\(metric).\(stamp(p.from))", subject: .total(period: name, metric: metric), ratio: m.ratio ?? 1))
            }
        }
        for m in r.periods.day.models ?? [] where m.pace == "exceeded" {
            out.append(BudgetAlert(key: "model.\(m.model).\(stamp(r.periods.day.from))", subject: .model(m.model), ratio: m.ratio ?? 1))
        }
        return out
    }

    /// The alerts to send now (once per key and period) and the keys to remember: those of
    /// periods that have ended drop out of `notified`.
    public static func plan(_ r: BudgetReport, notified: Set<String>) -> (send: [BudgetAlert], remember: Set<String>) {
        let current = Set([r.periods.day.from, r.periods.week.from, r.periods.month.from].map(stamp))
        let kept = notified.filter { key in key.split(separator: ".").last.map { current.contains(String($0)) } ?? false }
        let fresh = exceeded(r).filter { !kept.contains($0.key) }
        return (fresh, kept.union(fresh.map(\.key)))
    }

    /// The keys to remember once the notifications went out: `remember` of plan() without the
    /// alerts whose notification was not delivered (permission denied, an error of the
    /// notification center), so the next check tries them again.
    public static func remembered(_ remember: Set<String>, sent: [BudgetAlert], delivered: Set<String>) -> Set<String> {
        remember.subtracting(sent.map(\.key).filter { !delivered.contains($0) })
    }

    /// «Oggi, token: 120% del budget» or «openai/gpt-5.5: 104% del budget di oggi».
    public static func text(_ a: BudgetAlert, _ lang: Lang) -> String {
        let percent = String(Int((a.ratio * 100).rounded(.down)))
        switch a.subject {
        case .total(let period, let metric):
            let p: Key = period == "week" ? .periodWeek : period == "month" ? .periodMonth : .periodDay
            let m: Key = metric == "cost" ? .metricCost : metric == "steps" ? .metricSteps : .metricTokens
            return Strings.t(.budgetTotal, lang, ["period": Strings.t(p, lang), "metric": Strings.t(m, lang), "percent": percent])
        case .model(let model):
            return Strings.t(.budgetModel, lang, ["model": model, "percent": percent])
        }
    }

    /// One notification for many alerts: the first three and how many more.
    public static func summary(_ a: [BudgetAlert], _ lang: Lang) -> (title: String, body: String) {
        var lines = a.prefix(maxSingle).map { text($0, lang) }
        if a.count > maxSingle { lines.append(Strings.t(.budgetSummaryMore, lang, ["count": String(a.count - maxSingle)])) }
        return (Strings.t(.budgetSummaryTitle, lang, ["count": String(a.count)]), lines.joined(separator: "\n"))
    }

    private static func stamp(_ ms: Double) -> String { String(Int64(ms)) }
}
