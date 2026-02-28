export type Member = {
  id: string
  name: string
  paid: boolean
}

export type SplitData = {
  id: string
  title: string
  total: number
  people: number
  eventAtISO: string
  bankName: string
  iban: string
  members: Member[]
}

export type SplitRow = {
  id: string
  title: string
  total: number
  people: number
  event_at: string
  bank_name: string | null
  iban: string | null
}
