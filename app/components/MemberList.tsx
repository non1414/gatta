import type { MemberV2 } from "../lib/types"

type Props = {
  members: MemberV2[]
  myMemberId: string | null
}

function statusIcon(status: MemberV2["status"]) {
  switch (status) {
    case "confirmed":
    case "legacy_paid":
      return "✅"
    case "reported":
      return "🕓"
    case "joined":
      return "⏳"
    default:
      return null
  }
}

function statusText(status: MemberV2["status"]) {
  switch (status) {
    case "empty": return "مقعد فارغ"
    case "joined": return "لم يبلّغ بعد"
    case "reported": return "أبلغ بالتحويل"
    case "confirmed": return "تأكَّد الاستلام"
    case "legacy_paid": return "سُجّل كمدفوع في الإصدار السابق"
    default: return ""
  }
}

export function MemberList({ members, myMemberId }: Props) {
  const named = members.filter((m) => m.status !== "empty")
  const empty = members.filter((m) => m.status === "empty")
  const sorted = [...named, ...empty]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
      {sorted.map((m) => {
        const isEmpty = m.status === "empty"
        const isMine = m.id === myMemberId

        return (
          <div
            key={m.id}
            className={`member-row${m.status === "confirmed" || m.status === "legacy_paid" ? " member-row-paid" : ""}`}
            style={{ cursor: "default", borderColor: isMine ? "var(--primary)" : undefined }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: isEmpty ? 400 : 500,
                  color: isEmpty ? "var(--text-3)" : "var(--text-1)",
                }}
              >
                {isEmpty ? "بانتظار شخص" : m.name}
                {isMine && " (مشاركتك)"}
              </span>
              {m.is_organizer && (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    background: "var(--badge-bg)", border: "1px solid var(--badge-border)",
                    borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700,
                    color: "var(--badge-text)", whiteSpace: "nowrap", lineHeight: 1.5,
                  }}
                >
                  👑 المنظّم
                </span>
              )}
              {!isEmpty && (
                <span className="text-xs" style={{ color: "var(--text-3)" }}>
                  {statusText(m.status)}
                </span>
              )}
            </div>

            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
              {isEmpty ? <span style={{ color: "var(--text-3)", fontSize: 14 }}>—</span> : statusIcon(m.status)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
