export type MemberStatus = "empty" | "joined" | "reported" | "confirmed" | "legacy_paid"

export type MemberV2 = {
  id: string
  name: string
  status: MemberStatus
  // الحصة المُسندة فعليًا لهذا المقعد (فارغة لقطّات الإصدار السابق)
  amount_halalas: number | null
  is_organizer: boolean
}

export type SplitV2 = {
  id: string
  title: string
  total: number
  total_halalas: number
  people: number
  event_at: string
  organizer_name: string
  organizer_is_participant: boolean
  bank_name: string | null
  iban: string | null
  is_legacy?: boolean
  reporting_started_at: string | null
  members: MemberV2[]
}

export function halalasToRiyalText(halalas: number | null): string {
  return ((halalas ?? 0) / 100).toFixed(2)
}

/**
 * أقل وأعلى حصة مُسندة فعليًا. القسمة غير المتساوية (1000÷3) تُسند هللة زائدة
 * لبعض المقاعد، فلا تُعرض "333.33" للجميع ومقعدٌ عليه 333.34. قطّات الإصدار
 * السابق بلا حصص مُسندة: نعود لمتوسط المبلغ على العدد.
 */
export function shareRange(split: Pick<SplitV2, "total_halalas" | "people" | "members">): { min: number; max: number } {
  const amounts = split.members.map((m) => m.amount_halalas)
  if (amounts.length === 0 || amounts.some((a) => typeof a !== "number")) {
    const average = perPersonHalalas(split)
    return { min: average, max: average }
  }
  const assigned = amounts as number[]
  return { min: Math.min(...assigned), max: Math.max(...assigned) }
}

/** حصة الشخص للعرض — صفر (لا Infinity/NaN) إن لم يكن هناك أي مقعد. */
export function perPersonHalalas(split: Pick<SplitV2, "total_halalas" | "people">): number {
  return split.people > 0 ? split.total_halalas / split.people : 0
}
