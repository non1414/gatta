"use client"

import { useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useToast } from "../components/Toast"
import { Footer } from "../components/Footer"
import { PageHeader } from "../components/PageHeader"
import { newClientRequestId, newManageToken, markOrganizerDevice } from "../lib/clientSecrets"
import { errorMessageAr } from "../lib/errorMessages"
import { MIN_PEOPLE, MAX_PEOPLE, MAX_NAME_LENGTH, MAX_TITLE_LENGTH } from "../lib/validation"

function toISO(datetimeLocalValue: string) {
  return new Date(datetimeLocalValue).toISOString()
}

// قيمة min لحقل datetime-local بالتوقيت المحلي (YYYY-MM-DDTHH:mm)
function localNowForInput() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function CreatePage() {
  const [organizerName, setOrganizerName] = useState("")
  const [title, setTitle]     = useState("")
  const [total, setTotal]     = useState("")
  const [people, setPeople]   = useState("")
  const [eventAt, setEventAt] = useState("")
  const [organizerIsParticipant, setOrganizerIsParticipant] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [minEventAt] = useState(localNowForInput)
  const { showToast } = useToast()

  // 0 = غير صالح (فارغ أو خارج 1–100) — لا نقصّ القيمة بصمت إلى الحد الأقصى
  const peopleNum = useMemo(() => {
    const p = Number(people)
    if (!Number.isInteger(p) || p < MIN_PEOPLE || p > MAX_PEOPLE) return 0
    return p
  }, [people])
  const peopleOutOfRange = people !== "" && peopleNum === 0

  const totalNum = useMemo(() => {
    const t = Number(total)
    return Number.isFinite(t) && t > 0 ? t : 0
  }, [total])

  // نفس توزيع القاعدة بالضبط: الباقي بالهللات يُسند لبعض المقاعد (هللة لكلٍّ)
  const previewShare = useMemo(() => {
    if (totalNum <= 0 || peopleNum < MIN_PEOPLE) return null
    const totalHalalas = Math.round(totalNum * 100)
    const base = Math.floor(totalHalalas / peopleNum)
    const low = (base / 100).toFixed(2)
    return totalHalalas % peopleNum === 0 ? low : `${low} – ${((base + 1) / 100).toFixed(2)}`
  }, [totalNum, peopleNum])

  const createLink = async () => {
    if (!organizerName.trim()) { showToast("اكتبي/اكتب اسمك أولاً", "error"); return }
    if (organizerName.trim().length > MAX_NAME_LENGTH) { showToast(errorMessageAr("name_too_long", ""), "error"); return }
    if (!title.trim())  { showToast("اكتبي/اكتب اسم المناسبة", "error"); return }
    if (title.trim().length > MAX_TITLE_LENGTH) { showToast(errorMessageAr("title_too_long", ""), "error"); return }
    if (totalNum <= 0)  { showToast("أدخلي/أدخل مبلغاً صحيحاً", "error"); return }
    if (peopleNum < MIN_PEOPLE) { showToast(errorMessageAr("invalid_people_count", ""), "error"); return }
    if (!eventAt)        { showToast("حدّدي/حدّد تاريخ ووقت اللقاء", "error"); return }
    const eventTime = new Date(eventAt).getTime()
    if (!Number.isFinite(eventTime)) { showToast(errorMessageAr("invalid_event_at", ""), "error"); return }
    if (eventTime < Date.now()) { showToast(errorMessageAr("event_in_past", ""), "error"); return }

    setIsSubmitting(true)

    try {
      const clientRequestId = newClientRequestId()
      const manageToken = newManageToken()
      const totalHalalas = Math.round(totalNum * 100)

      const { data, error } = await supabase.rpc("create_split", {
        p_client_request_id: clientRequestId,
        p_organizer_name: organizerName.trim(),
        p_manage_token: manageToken,
        p_title: title.trim(),
        p_total_halalas: totalHalalas,
        p_people_count: peopleNum,
        p_event_at: toISO(eventAt),
        p_organizer_is_participant: organizerIsParticipant,
      })

      if (error || !data || data.length === 0) {
        showToast(errorMessageAr(error?.message, "تعذّر إنشاء القطّة — تحقّقي/تحقّق من اتصالك وأعيدي/أعد المحاولة"), "error")
        setIsSubmitting(false)
        return
      }

      const splitId = data[0].split_id as string
      markOrganizerDevice(splitId)
      showToast("تم إنشاء القطّة", "success")
      // رابط الإدارة: المعرّف بالمسار (غير سرّي)، والتوكن بالـfragment (سرّي،
      // لا يصل الخادم أبدًا). صفحة /m تتولّى تبادله بجلسة httpOnly ومسح الرابط.
      window.location.href = `/m/${splitId}#${manageToken}`
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-md">

        <PageHeader />

        {/* Heading */}
        <div className="text-center space-y-2 mb-6">
          <h1 className="text-2xl font-bold">إنشاء رابط قَطّة</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            إنشاء رابط قَطّة ومشاركته مع الأصدقاء لتتبع المدفوعات بسهولة.
          </p>
        </div>

        {/* Form card */}
        <div className="card space-y-5">

          <div>
            <label className="label">اسم المنظّم</label>
            <input
              className="field"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="أدخل اسم المنظّم"
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--text-2)" }}>
              يظهر للجميع تحت عنوان القطّة وفي رسالة المشاركة.
            </p>
          </div>

          <div>
            <label className="label">اسم المناسبة</label>
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="مثال: طلعة الأصدقاء"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">المبلغ الإجمالي (ريال)</label>
              <input
                className="field"
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="2400"
              />
            </div>
            <div>
              <label className="label">عدد الأشخاص</label>
              <input
                className="field"
                value={people}
                onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="8"
              />
              <p className="text-xs mt-1.5" style={{ color: peopleOutOfRange ? "var(--toast-error-text)" : "var(--text-3)" }}>
                {peopleOutOfRange ? "العدد يجب أن يكون بين 1 و100" : "من 1 إلى 100"}
              </p>
            </div>
          </div>

          <label
            className="flex items-center gap-3 rounded-2xl p-3 cursor-pointer"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
          >
            <input
              type="checkbox"
              checked={organizerIsParticipant}
              onChange={(e) => setOrganizerIsParticipant(e.target.checked)}
              style={{ width: 18, height: 18, flexShrink: 0 }}
            />
            <span className="text-sm" style={{ color: "var(--text-1)" }}>
              أشارك في دفع القَطّة
            </span>
          </label>
          <p className="text-xs -mt-3" style={{ color: "var(--text-3)" }}>
            {organizerIsParticipant
              ? "عدد الأشخاص أعلاه يشملك — سيُضاف اسمك تلقائيًا في قائمة المشاركين بحصة كاملة."
              : "بدون تفعيل هذا الخيار، لن يشملك عدد الأشخاص، ولن يُضاف اسمك لقائمة المشاركين، ولا حصة عليك."}
          </p>

          <div>
            <label className="label">موعد اللقاء</label>
            <input
              type="datetime-local"
              className="field"
              value={eventAt}
              min={minEventAt}
              onChange={(e) => setEventAt(e.target.value)}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--text-3)" }}>
              سيظهر التاريخ والوقت الفعليان مع عدّ تنازلي في صفحة القَطّة.
            </p>
          </div>

          {/* Live preview */}
          {previewShare && (
            <div
              className="rounded-2xl p-4 flex items-center justify-between"
              style={{ background: "var(--primary-soft-bg)", border: "1px solid var(--primary-soft-border)" }}
            >
              <span className="text-sm" style={{ color: "var(--text-2)" }}>حصة الشخص</span>
              <span className="font-bold text-lg" style={{ color: "var(--primary)" }}>
                {previewShare}{" "}
                <span className="text-sm font-normal" style={{ color: "var(--text-2)" }}>ريال</span>
              </span>
            </div>
          )}

          <button className="btn btn-white" onClick={createLink} disabled={isSubmitting}>
            {isSubmitting ? <span className="spinner" /> : "إنشاء رابط القَطّة"}
          </button>
        </div>
      </div>

      <Footer />
    </main>
  )
}
