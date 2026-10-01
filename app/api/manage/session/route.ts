import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/app/lib/supabaseAdmin"
import { createManageSession, manageCookieOptions, MANAGE_COOKIE } from "@/app/lib/manageSession"

/**
 * تبادل توكن الإدارة الخام (يصل مرة واحدة من fragment الرابط على العميل)
 * بجلسة httpOnly. لا نطبع manageToken أبدًا في أي سجل (console/log)، ولا
 * نُعيده في أي استجابة لاحقة — من هذه اللحظة فصاعدًا الكوكي هو بديله.
 */
export async function POST(req: NextRequest) {
  let body: { splitId?: string; manageToken?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { splitId, manageToken } = body
  if (!splitId || !manageToken) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
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

  const { sessionId, csrfToken, ttlSeconds } = await createManageSession(splitId)

  const res = NextResponse.json({ ok: true, csrfToken, splitId, ttlSeconds })
  res.cookies.set(MANAGE_COOKIE, sessionId, manageCookieOptions())
  return res
}
