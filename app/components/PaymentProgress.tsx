type Props = {
  paidCount: number
  joinedCount: number
  totalPeople: number
  isFull: boolean
}

export function PaymentProgress({ paidCount, joinedCount, totalPeople, isFull }: Props) {
  const progress = totalPeople > 0 ? Math.round((paidCount / totalPeople) * 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-gray-500">
        <span>المدفوع</span>
        <span>
          {paidCount}/{totalPeople} • {progress}%
        </span>
      </div>

      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-black transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex justify-between text-sm text-gray-500">
        <span>المنضمّين</span>
        <span>
          {joinedCount}/{totalPeople} {isFull ? "• اكتملت ✅" : ""}
        </span>
      </div>
    </div>
  )
}
