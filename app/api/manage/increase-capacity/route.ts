import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession } from "@/app/lib/manageRouteHelpers"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await req.json().catch(() => null)
  const delta = Number(body?.delta)
  if (!Number.isInteger(delta) || delta < 1) {
    return NextResponse.json({ error: "invalid_delta" }, { status: 400 })
  }

  const { error } = await getSupabaseAdmin().rpc("admin_increase_capacity", {
    p_split_id: splitId,
    p_delta: delta,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
})
