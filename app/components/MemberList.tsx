import type { Member } from "../lib/types"

type Props = {
  members: Member[]
  togglingId: string | null
  onToggle: (memberId: string) => void
}

export function MemberList({ members, togglingId, onToggle }: Props) {
  // Sort: named members first (organizer at top), empty slots last
  const named  = members.filter((m) => m.name.trim().length > 0)
  const empty  = members.filter((m) => m.name.trim().length === 0)
  const sorted = [...named, ...empty]

  // First named member = organizer (crown)
  const organizerId = named[0]?.id ?? null

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
      {sorted.map((m) => {
        const isEmpty    = m.name.trim().length === 0
        const isToggling = togglingId === m.id
        const isOrganizer = !isEmpty && m.id === organizerId
        // Number empty slots sequentially within the empty group
        const emptyNum   = isEmpty ? empty.indexOf(m) + 1 : null

        return (
          <button
            key={m.id}
            onClick={() => onToggle(m.id)}
            disabled={isEmpty || isToggling}
            className={`member-row${!isEmpty && m.paid ? " member-row-paid" : ""}`}
            style={isToggling ? { opacity: 0.5 } : {}}
          >
            {/* Name + organizer badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: isEmpty ? 400 : 500,
                  color: isEmpty ? "var(--text-3)" : "var(--text-1)",
                }}
              >
                {isEmpty ? `بانتظار شخص (${emptyNum})` : m.name}
              </span>
              {isOrganizer && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    background: "rgba(217, 164, 65, 0.15)",
                    border: "1px solid rgba(217, 164, 65, 0.35)",
                    borderRadius: 6,
                    padding: "2px 7px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#7A5B10",
                    whiteSpace: "nowrap",
                    lineHeight: 1.5,
                  }}
                >
                  👑 المنسّق
                </span>
              )}
            </div>

            {/* Status icon */}
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
              {isToggling ? (
                <span className="spinner spinner-light" style={{ width: 18, height: 18 }} />
              ) : isEmpty ? (
                <span style={{ color: "var(--text-3)", fontSize: 14 }}>—</span>
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
