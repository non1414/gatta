import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"
import { MAX_PEOPLE } from "@/app/lib/validation"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await readJsonObject(req)
  const delta = body?.delta
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta < 1) {
    return badRequest("invalid_delta")
  }
  if (delta > MAX_PEOPLE) return badRequest("max_capacity_exceeded")

  const { error } = await getSupabaseAdmin().rpc("admin_increase_capacity", {
    p_split_id: splitId,
    p_delta: delta,
  })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ ok: true })
})
