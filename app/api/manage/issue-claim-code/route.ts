import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession } from "@/app/lib/manageRouteHelpers"

// الرمز يُعاد مرة واحدة فقط هنا؛ لا يُخزَّن خامًا في أي مكان (القاعدة تحفظ
// تجزئته فقط). على المنظّمة نسخه وإرساله يدويًا لصاحب المقعد فورًا.
export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await req.json().catch(() => null)
  const memberId: string | undefined = body?.memberId
  if (!memberId) return NextResponse.json({ error: "bad_request" }, { status: 400 })

  const { data: member } = await getSupabaseAdmin()
    .from("members")
    .select("split_id")
    .eq("id", memberId)
    .single()
  if (!member || member.split_id !== splitId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const { data: code, error } = await getSupabaseAdmin().rpc("admin_issue_claim_code", {
    p_member_id: memberId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ code })
})
