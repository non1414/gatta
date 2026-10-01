import { NextRequest, NextResponse } from "next/server"
import { validateManageSession } from "./manageSession"

/**
 * غلاف مشترك لكل مسارات /api/manage/*: يتحقق من الجلسة (كوكي httpOnly + CSRF)
 * قبل تمرير splitId إلى المعالج. أي فشل تحقق = 401 موحّد، بلا تفاصيل إضافية.
 */
export function withManageSession(
  handler: (req: NextRequest, splitId: string) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const session = await validateManageSession(req)
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return handler(req, session.splitId)
  }
}
