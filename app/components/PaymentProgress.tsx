type Props = {
  paidCount: number
  joinedCount: number
  totalPeople: number
  isFull: boolean
}

export function PaymentProgress({ paidCount, joinedCount, totalPeople, isFull }: Props) {
  const progress = totalPeople > 0 ? Math.round((paidCount / totalPeople) * 100) : 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Top row: label + percentage */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
          تم الدفع {paidCount} من {totalPeople}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: progress === 100 ? "var(--success)" : "var(--text-2)",
          }}
        >
          {progress}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Bottom row: joined count */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-2)" }}>
        <span>المنضمّون</span>
        <span>
          {joinedCount} من {totalPeople}
          {isFull ? " · اكتملت ✅" : ""}
        </span>
      </div>
    </div>
  )
}
