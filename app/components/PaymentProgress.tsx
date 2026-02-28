type Props = {
  paidCount: number
  joinedCount: number
  totalPeople: number
  isFull: boolean
}

export function PaymentProgress({ paidCount, joinedCount, totalPeople, isFull }: Props) {
  const progress = totalPeople > 0 ? Math.round((paidCount / totalPeople) * 100) : 0

  return (
    <div className="space-y-3">
      <div
        className="flex justify-between"
        style={{ fontSize: "13px", color: "var(--text-2)" }}
      >
        <span>المدفوع</span>
        <span>
          {paidCount} من {totalPeople} · {progress}%
        </span>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div
        className="flex justify-between"
        style={{ fontSize: "13px", color: "var(--text-2)" }}
      >
        <span>المنضمّون</span>
        <span>
          {joinedCount} من {totalPeople}
          {isFull ? " · اكتملت ✅" : ""}
        </span>
      </div>
    </div>
  )
}
