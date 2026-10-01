"use client"

// أسرار العميل: القاعدة تخزّن تجزئتها فقط ولا تُصدرها مطلقًا؛ لذلك يُولّدها
// المتصفح نفسه ويحفظها فور توليدها (قبل انتظار أي استجابة شبكة)، فتبقى
// متاحة محليًا حتى لو ضاعت الاستجابة (انظر تصميم إعادة المحاولة في join_split).

function randomSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function getOrCreateParticipantToken(splitId: string): string {
  const key = `gatta_ptoken_${splitId}`
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const fresh = randomSecret()
    localStorage.setItem(key, fresh)
    return fresh
  } catch {
    // localStorage غير متاح (خصوصية صارمة) — نولّد سرًّا مؤقتًا لهذه الجلسة فقط
    return randomSecret()
  }
}

export function getMemberId(splitId: string): string | null {
  try {
    return localStorage.getItem(`gatta_member_${splitId}`)
  } catch {
    return null
  }
}

export function setMemberId(splitId: string, memberId: string) {
  try {
    localStorage.setItem(`gatta_member_${splitId}`, memberId)
  } catch {
    /* لا شيء — لا يمكن تذكّر العضوية على هذا المتصفح، سيُطلب الانضمام مجددًا */
  }
}

// علامة غير سرّية: "هذا المتصفح فتح لوحة إدارة هذه القطّة". تُستخدم فقط
// لتمييز المنظّم في صفحة المشاركة العامة (إخفاء نموذج الانضمام وإظهار رابط
// اللوحة) — لا تمنح أي صلاحية؛ الصلاحية الفعلية تبقى لجلسة الإدارة وحدها.
export function markOrganizerDevice(splitId: string) {
  try {
    localStorage.setItem(`gatta_org_${splitId}`, "1")
  } catch {
    /* لا شيء — صفحة المشاركة ستعامل هذا المتصفح كزائر عادي */
  }
}

export function isOrganizerDevice(splitId: string): boolean {
  try {
    return localStorage.getItem(`gatta_org_${splitId}`) === "1"
  } catch {
    return false
  }
}

export function newClientRequestId(): string {
  return crypto.randomUUID()
}

export function newManageToken(): string {
  return randomSecret()
}
