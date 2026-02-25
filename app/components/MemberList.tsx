import type { Member } from "../lib/types"

type Props = {
  members: Member[]
  togglingId: string | null
  onToggle: (memberId: string) => void
}

export function MemberList({ members, togglingId, onToggle }: Props) {
  return (
    <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
      {members.map((m, index) => {
        const isEmpty = m.name.trim().length === 0
        const isToggling = togglingId === m.id

        return (
          <button
            key={m.id}
            onClick={() => onToggle(m.id)}
            disabled={isEmpty || isToggling}
            className={`w-full flex items-center justify-between border rounded-xl px-4 py-3 text-right ${
              isEmpty ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
            } ${isToggling ? "opacity-50" : ""}`}
          >
            <span className="font-medium">
              {isEmpty ? `مقعد متاح (${index + 1})` : m.name}
            </span>
            <span className="text-xl">
              {isToggling ? (
                <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : isEmpty ? (
                "+"
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
