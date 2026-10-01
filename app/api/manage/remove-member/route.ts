import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"

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

  const { error } = await getSupabaseAdmin().rpc("admin_remove_empty_member", { p_member_id: memberId })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ ok: true })
})
