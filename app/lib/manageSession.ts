import { NextRequest } from "next/server"
import { getSupabaseAdmin } from "./supabaseAdmin"

export const MANAGE_COOKIE = "gatta_manage_session"
export const CSRF_HEADER = "x-csrf-token"
const SESSION_TTL_SECONDS = 8 * 60 * 60 // 8 ساعات
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ManageSession = { splitId: string; sessionId: string; csrfToken: string; expiresAt: string }

export function manageCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/manage",
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function createManageSession(splitId: string) {
  const csrfToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from("manage_sessions")
    .insert({ split_id: splitId, csrf_token: csrfToken, expires_at: expiresAt })
    .select("id")
    .single()

  if (error || !data) throw new Error("session_create_failed")
  return { sessionId: data.id as string, csrfToken, expiresAt, ttlSeconds: SESSION_TTL_SECONDS }
}

async function loadSessionFromCookie(req: NextRequest): Promise<ManageSession | null> {
  const sessionId = req.cookies.get(MANAGE_COOKIE)?.value
  if (!sessionId || !UUID_RE.test(sessionId)) return null

  const { data, error } = await getSupabaseAdmin()
    .from("manage_sessions")
    .select("split_id, csrf_token, expires_at, revoked_at")
    .eq("id", sessionId)
    .single()

  if (error || !data) return null
  if (data.revoked_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null

  return {
    splitId: data.split_id as string,
    sessionId,
    csrfToken: data.csrf_token as string,
    expiresAt: data.expires_at as string,
  }
}

/**
 * تتحقق من جلسة الإدارة: الكوكي httpOnly + رأس CSRF مطابق.
 * httpOnly تمنع قراءة الكوكي من JS، لكنها وحدها لا تمنع طلبًا مُزوَّرًا من موقع
 * آخر (CSRF) — لذلك تُفرض مطابقة csrf_token المُعاد من الجلسة كرأس مخصّص،
 * وهو ما لا يستطيع موقع خارجي إرفاقه تلقائيًا (بخلاف الكوكي نفسه).
 */
export async function validateManageSession(req: NextRequest): Promise<ManageSession | null> {
  const csrfHeader = req.headers.get(CSRF_HEADER)
  if (!csrfHeader) return null

  const session = await loadSessionFromCookie(req)
  if (!session || session.csrfToken !== csrfHeader) return null
  return session
}

/**
 * إعادة تحميل الصفحة (بلا fragment): الكوكي httpOnly لا تزال صالحة، لكن
 * الذاكرة فقدت رمز CSRF. نتحقق من الكوكي فقط ونعيد نفس csrf_token المخزَّن
 * (لا نولّده من جديد) ليستطيع العميل استئناف الجلسة دون إعادة زيارة الرابط
 * الأصلي، طالما الكوكي لم تنتهِ صلاحيتها بعد.
 */
export async function resumeManageSessionFromCookie(req: NextRequest): Promise<ManageSession | null> {
  return loadSessionFromCookie(req)
}
