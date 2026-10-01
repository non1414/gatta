import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { createManageSession, manageCookieOptions, MANAGE_COOKIE } from "@/app/lib/manageSession"
import { readJsonObject, badRequest } from "@/app/lib/manageRouteHelpers"

/**
 * تبادل توكن الإدارة الخام (يصل مرة واحدة من fragment الرابط على العميل)
 * بجلسة httpOnly. لا نطبع manageToken أبدًا في أي سجل (console/log)، ولا
 * نُعيده في أي استجابة لاحقة — من هذه اللحظة فصاعدًا الكوكي هو بديله.
 */
export async function POST(req: NextRequest) {
  const body = await readJsonObject(req)
  const splitId = body?.splitId
  const manageToken = body?.manageToken
  if (
    typeof splitId !== "string" || typeof manageToken !== "string" ||
    !splitId || !manageToken || splitId.length > 100 || manageToken.length > 200
  ) {
    return badRequest()
  }

  const { data: isValid, error } = await getSupabaseAdmin().rpc("admin_verify_manage_token", {
    p_split_id: splitId,
    p_manage_token: manageToken,
  })

  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
  if (!isValid) {
    // تأخير ثابت بسيط لتقليل فائدة قياس التوقيت لتخمين التوكن — دفاع خفيف إضافي
    await new Promise((r) => setTimeout(r, 300))
    return NextResponse.json({ error: "invalid_token" }, { status: 401 })
  }

  let session
  try {
    session = await createManageSession(splitId)
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }
  const { sessionId, csrfToken, expiresAt, ttlSeconds } = session

  const res = NextResponse.json({ ok: true, csrfToken, splitId, expiresAt, ttlSeconds })
  res.cookies.set(MANAGE_COOKIE, sessionId, manageCookieOptions())
  return res
}
