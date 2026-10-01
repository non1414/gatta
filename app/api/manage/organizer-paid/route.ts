import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"

// المنظّم المشارك يؤكّد (أو يتراجع عن) دفع حصته هو. لا يُقبل memberId من
// العميل: الدالة تستهدف مقعد المنظّم داخل قطّة الجلسة فقط، فلا يمكن استخدام
// هذا المسار لتأكيد حصة أي مشارك آخر.
export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await readJsonObject(req)
  const paid = body?.paid
  if (typeof paid !== "boolean") return badRequest()

  const { error } = await getSupabaseAdmin().rpc("admin_set_organizer_paid", {
    p_split_id: splitId,
    p_paid: paid,
  })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ ok: true })
})
