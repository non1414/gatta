import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession } from "@/app/lib/manageRouteHelpers"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await req.json().catch(() => null)
  const bankName: string = body?.bankName ?? ""
  const iban: string = body?.iban ?? ""

  const { error } = await getSupabaseAdmin().rpc("admin_update_bank_details", {
    p_split_id: splitId,
    p_bank_name: bankName,
    p_iban: iban,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
})
