import type { Member } from "../lib/types"

type Props = {
  members: Member[]
  togglingId: string | null
  onToggle: (memberId: string) => void
}

export function MemberList({ members, togglingId, onToggle }: Props) {
  return (
    <div className="space-y-2" style={{ maxHeight: "320px", overflowY: "auto" }}>
      {members.map((m, index) => {
        const isEmpty = m.name.trim().length === 0
        const isToggling = togglingId === m.id

        return (
          <button
            key={m.id}
            onClick={() => onToggle(m.id)}
            disabled={isEmpty || isToggling}
            className="member-row"
            style={isToggling ? { opacity: 0.5 } : {}}
          >
            <span
              className="font-medium"
              style={{
                fontSize: "14px",
                color: isEmpty ? "var(--text-3)" : "var(--text-1)",
              }}
            >
              {isEmpty ? `بانتظار شخص (${index + 1})` : m.name}
            </span>
            <span style={{ fontSize: "18px", lineHeight: 1 }}>
              {isToggling ? (
                <span
                  className="spinner spinner-light"
                  style={{ width: 18, height: 18 }}
                />
              ) : isEmpty ? (
                <span style={{ color: "var(--text-3)", fontSize: "14px" }}>—</span>
              ) : m.paid ? (
                "✅"
              ) : (
                "⏳"
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
