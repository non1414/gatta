import type { SplitV2 } from "./types"
import { halalasToRiyalText, shareRange } from "./types"
import { formatEventDate } from "./format"

// رسالة المشاركة — مصدر واحد لصفحة المشاركة ولوحة الإدارة
export function buildShareText(data: SplitV2, shareUrl: string) {
  const { min, max } = shareRange(data)
  const share = min === max
    ? `${halalasToRiyalText(min)} ريال`
    : `من ${halalasToRiyalText(min)} إلى ${halalasToRiyalText(max)} ريال`
  return [
    `هذا رابط القَطّة 👇`, ``,
    `المناسبة: ${data.title}`,
    `المنظّم: ${data.organizer_name}`,
    `المبلغ الإجمالي: ${halalasToRiyalText(data.total_halalas)} ريال`,
    `حصة الشخص: ${share}`,
    `موعد اللقاء: ${formatEventDate(data.event_at)}`,
    ...(data.iban ? [``, `رقم الآيبان: ${data.iban}`] : []),
    ``, `انضمّي/انضمّ من الرابط، وبعد التحويل اضغطي/اضغط "حوّلت حصتي"`, shareUrl,
  ].join("\n")
}
