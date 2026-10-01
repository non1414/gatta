// حدود المدخلات — مشتركة بين الواجهة وطبقة الخادم، وتطابق ما تفرضه القاعدة
// في supabase/migrations/00000000000009 (القاعدة هي المرجع النهائي).
export const MIN_PEOPLE = 1
export const MAX_PEOPLE = 100
export const MAX_NAME_LENGTH = 40
export const MAX_TITLE_LENGTH = 80
export const MAX_BANK_NAME_LENGTH = 60

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase()
}

/** شكل الآيبان فقط (لا تحقّق من خانة الفحص): حرفا الدولة + رقمان + 11–30 خانة؛ السعودي 24 خانة بالضبط. */
export function isValidIban(normalized: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) return false
  if (normalized.startsWith("SA")) return /^SA\d{22}$/.test(normalized)
  return true
}
