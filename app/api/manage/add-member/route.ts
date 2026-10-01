import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, readJsonObject, badRequest, dbErrorResponse } from "@/app/lib/manageRouteHelpers"
import { MAX_NAME_LENGTH } from "@/app/lib/validation"

export const POST = withManageSession(async (req: NextRequest, splitId) => {
  const body = await readJsonObject(req)
  if (typeof body?.name !== "string") return badRequest("name_required")
  const name = body.name.trim()
  if (!name) return badRequest("name_required")
  if (name.length > MAX_NAME_LENGTH) return badRequest("name_too_long")

  const { data, error } = await getSupabaseAdmin().rpc("admin_add_member", {
    p_split_id: splitId,
    p_name: name,
  })
  if (error) return dbErrorResponse(error)
  return NextResponse.json({ memberId: data })
})
