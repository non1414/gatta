export type MemberStatus = "empty" | "joined" | "reported" | "confirmed" | "legacy_paid"

export type MemberV2 = {
  id: string
  name: string
  status: MemberStatus
  amount_halalas: number
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

export function halalasToRiyalText(halalas: number): string {
  return (halalas / 100).toFixed(2)
}
