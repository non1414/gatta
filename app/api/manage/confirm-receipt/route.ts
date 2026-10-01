import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession } from "@/app/lib/manageRouteHelpers"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await req.json().catch(() => null)
  const memberId: string | undefined = body?.memberId
  const confirm: boolean | undefined = body?.confirm
  if (!memberId || typeof confirm !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  // تحقّق إضافي أن العضو فعلًا ينتمي لقطّة هذه الجلسة (لا الاكتفاء بثقة الجسم)
  const { data: member } = await getSupabaseAdmin()
    .from("members")
    .select("split_id")
    .eq("id", memberId)
    .single()
  if (!member || member.split_id !== splitId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const { error } = await getSupabaseAdmin().rpc("admin_confirm_receipt", {
    p_member_id: memberId,
    p_confirm: confirm,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
})
