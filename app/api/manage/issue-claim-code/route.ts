import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"

// الرمز يُعاد مرة واحدة فقط هنا؛ لا يُخزَّن خامًا في أي مكان (القاعدة تحفظ
// تجزئته فقط). على المنظّمة نسخه وإرساله يدويًا لصاحب المقعد فورًا.
export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await readJsonObject(req)
  const memberId = body?.memberId
  if (typeof memberId !== "string" || !memberId) return badRequest()

  const { data: member } = await getSupabaseAdmin()
    .from("members")
    .select("split_id")
    .eq("id", memberId)
    .maybeSingle()
  if (!member || member.split_id !== splitId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const { data: code, error } = await getSupabaseAdmin().rpc("admin_issue_claim_code", {
    p_member_id: memberId,
  })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ code })
})
