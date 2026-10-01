// تنسيق واحد للموعد في كل مكان (صفحة المشاركة، لوحة الإدارة، رسالة المشاركة).
// التقويم والأرقام مثبّتان صراحة: "ar-SA" وحدها تعطي تقويمًا هجريًا على بعض
// المتصفحات (Safari) وميلاديًا على أخرى، فيرى مشاركان الموعد نفسه بتاريخين.
const LOCALE = "ar-SA-u-ca-gregory-nu-arab"

export function formatEventDate(isoString: string) {
  return new Date(isoString).toLocaleDateString(LOCALE, {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export function formatTime(isoString: string) {
  return new Date(isoString).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" })
}
