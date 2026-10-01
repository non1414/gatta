import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession } from "@/app/lib/manageRouteHelpers"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await req.json().catch(() => null)
  const name: string = (body?.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 })

  const { data, error } = await getSupabaseAdmin().rpc("admin_add_member", {
    p_split_id: splitId,
    p_name: name,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ memberId: data })
})
