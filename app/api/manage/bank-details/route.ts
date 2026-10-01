import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"
import { MAX_BANK_NAME_LENGTH, normalizeIban, isValidIban } from "@/app/lib/validation"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await readJsonObject(req)
  if (typeof body?.bankName !== "string" || typeof body?.iban !== "string") return badRequest()

  // الحقلان اختياريان (نص فارغ = مسح القيمة)، لكن ما يُكتب يجب أن يكون صالحًا
  const bankName = body.bankName.trim()
  const iban = normalizeIban(body.iban)
  if (bankName.length > MAX_BANK_NAME_LENGTH) return badRequest("bank_name_too_long")
  if (iban && !isValidIban(iban)) return badRequest("invalid_iban")

  const { error } = await getSupabaseAdmin().rpc("admin_update_bank_details", {
    p_split_id: splitId,
    p_bank_name: bankName,
    p_iban: iban,
  })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ ok: true })
})
