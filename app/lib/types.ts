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
  feePerPerson: number
  eventAtISO: string
  members: Member[]
}

export type SplitRow = {
  id: string
  title: string
  total: number
  people: number
  fee_per_person: number
  event_at: string
}
