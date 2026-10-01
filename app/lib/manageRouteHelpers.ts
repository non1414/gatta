import { NextRequest, NextResponse } from "next/server"
import { validateManageSession, ManageSession } from "./manageSession"

/**
 * غلاف مشترك لكل مسارات /api/manage/*: يتحقق من الجلسة (كوكي httpOnly + CSRF)
 * قبل تمرير splitId إلى المعالج. أي فشل تحقق = 401 موحّد، بلا تفاصيل إضافية.
 */
export function withManageSession(
  handler: (req: NextRequest, splitId: string, session: ManageSession) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const session = await validateManageSession(req)
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return handler(req, session.splitId, session)
  }
}

/** جسم الطلب ككائن JSON، أو null لأي شيء آخر (JSON معطوب، مصفوفة، قيمة مجرّدة). */
export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

export function badRequest(error = "bad_request") {
  return NextResponse.json({ error }, { status: 400 })
}

// أخطاء متوقّعة ترفعها دوال القاعدة عمدًا (مدخلات/حالة غير صالحة) → 4xx برمز
// ثابت تترجمه الواجهة (app/lib/errorMessages.ts). أي خطأ آخر = 500 عام بلا
// تسريب نص Postgres الخام للعميل.
const EXPECTED_DB_ERRORS = new Set([
  "split_full", "duplicate_name", "name_required", "name_too_long",
  "capacity_locked_after_reporting_started", "max_capacity_exceeded", "min_capacity_reached",
  "invalid_delta", "not_an_empty_seat", "invalid_state", "split_not_found",
  "bank_name_too_long", "invalid_iban",
])

export function dbErrorResponse(error: { message?: string }) {
  const code = (error.message ?? "").match(/^[a-z][a-z_]*/)?.[0] ?? ""
  if (code === "rate_limited") return NextResponse.json({ error: code }, { status: 429 })
  if (EXPECTED_DB_ERRORS.has(code)) return NextResponse.json({ error: code }, { status: 400 })
  return NextResponse.json({ error: "server_error" }, { status: 500 })
}
