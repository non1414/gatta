import { randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { withManageSession, dbErrorResponse } from "@/app/lib/manageRouteHelpers"

/**
 * إصدار رابط إدارة جديد من جلسة فعّالة — مسار الاسترجاع لمن لم يحفظ الرابط
 * الأصلي قبل انتهاء الجلسة. التوكن الجديد يُولَّد هنا ويُعاد مرة واحدة فقط في
 * هذه الاستجابة (القاعدة تخزّن تجزئته فقط)، ولا يُطبع في أي سجل. الرابط القديم
 * وكل الجلسات الأخرى لهذه القطّة تتوقف فورًا؛ الجلسة الحالية تبقى.
 */
export const POST = withManageSession(async (_req: NextRequest, splitId, session) => {
  const manageToken = randomBytes(32).toString("hex")

  const { error } = await getSupabaseAdmin().rpc("admin_rotate_manage_token", {
    p_split_id: splitId,
    p_new_manage_token: manageToken,
    p_keep_session_id: session.sessionId,
  })
  if (error) return dbErrorResponse(error)

  const res = NextResponse.json({ ok: true, manageToken })
  res.headers.set("Cache-Control", "no-store")
  return res
})
