// رموز الأخطاء القادمة من دوال القاعدة ومسارات /api/manage/* → رسائل عربية
// واضحة. أي رمز غير معروف يعرض الرسالة البديلة التي يمرّرها المستدعي، لا
// النص التقني الخام.
const MESSAGES: Record<string, string> = {
  split_full: "اكتمل العدد — لا توجد مقاعد متاحة",
  duplicate_name: "هذا الاسم مسجّل مسبقًا في القطّة — اختاري/اختر اسمًا مختلفًا",
  unauthorized: "انتهت جلسة الإدارة — يلزم رابط الإدارة لفتحها من جديد",
  session_expired: "انتهت جلسة الإدارة — يلزم رابط الإدارة لفتحها من جديد",
  invalid_token: "رابط الإدارة غير صحيح أو تم استبداله برابط أحدث",
  capacity_locked_after_reporting_started: "العدد مقفل — بدأ الإبلاغ عن التحويلات، ولا يمكن تغييره الآن",
  max_capacity_exceeded: "الحد الأقصى لعدد الأشخاص 100",
  min_capacity_reached: "لا يمكن إزالة آخر مقعد — يجب أن يبقى شخص واحد على الأقل",
  invalid_delta: "أدخلي/أدخل عددًا صحيحًا أكبر من صفر",
  not_an_empty_seat: "هذا المقعد لم يعد فارغًا، لا يمكن إزالته",
  invalid_state: "تغيّرت حالة هذا المشارك — حدّثي/حدّث الصفحة وأعيدي/أعد المحاولة",
  not_authorized_or_invalid_state: "تعذّر تنفيذ الطلب — قد تكون حالة مشاركتك تغيّرت، حدّثي/حدّث الصفحة",
  token_mismatch_on_retry: "تعذّر إكمال الطلب — حدّثي/حدّث الصفحة وأعيدي/أعد المحاولة",
  rate_limited: "محاولات كثيرة — انتظري/انتظر قليلًا ثم أعيدي/أعد المحاولة",
  name_required: "اكتبي/اكتب الاسم أولاً",
  name_too_long: "الاسم طويل — الحد الأقصى 40 حرفًا",
  organizer_name_required: "اكتبي/اكتب اسم المنظّم أولاً",
  title_required: "اكتبي/اكتب اسم المناسبة",
  title_too_long: "اسم المناسبة طويل — الحد الأقصى 80 حرفًا",
  invalid_people_count: "عدد الأشخاص يجب أن يكون بين 1 و100",
  invalid_total: "أدخلي/أدخل مبلغًا صحيحًا أكبر من صفر",
  invalid_event_at: "حدّدي/حدّد موعدًا صحيحًا للقاء",
  event_in_past: "موعد اللقاء يجب أن يكون في المستقبل",
  bank_name_too_long: "اسم البنك طويل — الحد الأقصى 60 حرفًا",
  invalid_iban: "رقم الآيبان غير صحيح — الآيبان السعودي يبدأ بـSA ويتكوّن من 24 خانة",
  split_not_found: "لم نجد هذه القطّة",
  not_found: "لم نجد هذا المشارك في القطّة — حدّثي/حدّث الصفحة",
  bad_request: "الطلب غير مكتمل — حدّثي/حدّث الصفحة وأعيدي/أعد المحاولة",
  server_error: "حدث خطأ غير متوقع — أعيدي/أعد المحاولة بعد قليل",
}

/** يستخرج رمز الخطأ من نص مثل "rate_limited: claim_by_code (max 10 per 00:10:00)". */
export function errorCode(raw: string | null | undefined): string | null {
  const match = (raw ?? "").match(/^[a-z][a-z_]*/)
  return match && match[0] in MESSAGES ? match[0] : null
}

export function errorMessageAr(raw: string | null | undefined, fallback: string): string {
  const code = errorCode(raw)
  return code ? MESSAGES[code] : fallback
}
