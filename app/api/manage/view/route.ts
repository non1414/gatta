import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { validateManageSession, resumeManageSessionFromCookie } from "@/app/lib/manageSession"

/**
 * قراءة لوحة الإدارة. تدعم مسارين:
 * 1) رأس CSRF موجود (تدفّق طبيعي بعد تبادل ناجح) — تحقق كامل قياسي.
 * 2) لا رأس CSRF (تحميل صفحة جديد بعد فقدان الذاكرة، لا يزال هناك كوكي
 *    صالحة) — نُعيد نفس csrf_token المخزَّن ليستأنف العميل الجلسة دون إعادة
 *    فتح رابط الإدارة الأصلي، طالما الكوكي لم تنتهِ صلاحيتها.
 */
export async function GET(req: NextRequest) {
  let csrfToken: string | null = null

  let session = await validateManageSession(req)
  if (!session) {
    session = await resumeManageSessionFromCookie(req)
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    csrfToken = session.csrfToken
  }

  const { data, error } = await getSupabaseAdmin().rpc("get_manage_view", { p_split_id: session.splitId })
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  return NextResponse.json({ data: data[0], csrfToken, expiresAt: session.expiresAt })
}
