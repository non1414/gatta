"use client"

import { useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useToast } from "../components/Toast"
import { Footer } from "../components/Footer"
import { PageHeader } from "../components/PageHeader"
import { newClientRequestId, newManageToken } from "../lib/clientSecrets"

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function toISO(datetimeLocalValue: string) {
  return new Date(datetimeLocalValue).toISOString()
}

export default function CreatePage() {
  const [organizerName, setOrganizerName] = useState("")
  const [title, setTitle]     = useState("")
  const [total, setTotal]     = useState("")
  const [people, setPeople]   = useState("")
  const [eventAt, setEventAt] = useState("")
  const [organizerIsParticipant, setOrganizerIsParticipant] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { showToast } = useToast()

  const peopleNum = useMemo(() => {
    const p = Number(people)
    if (!Number.isFinite(p) || p < 2) return 0
    return clampInt(Math.floor(p), 2, 100)
  }, [people])

  const totalNum = useMemo(() => {
    const t = Number(total)
    return Number.isFinite(t) && t > 0 ? t : 0
  }, [total])

  const previewShare = useMemo(() => {
    if (totalNum <= 0 || peopleNum < 2) return null
    return (totalNum / peopleNum).toFixed(2)
  }, [totalNum, peopleNum])

  const createLink = async () => {
    if (!organizerName.trim()) { showToast("اكتبي/اكتب اسمك أولاً", "error"); return }
    if (!title.trim())  { showToast("اكتبي/اكتب اسم المناسبة", "error"); return }
    if (totalNum <= 0)  { showToast("أدخلي/أدخل مبلغاً صحيحاً", "error"); return }
    if (peopleNum < 2)  { showToast("عدد الأشخاص لازم يكون 2 على الأقل", "error"); return }
    if (!eventAt)        { showToast("حدّدي/حدّد تاريخ ووقت اللقاء", "error"); return }

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
        showToast(error?.message ?? "تعذّر إنشاء القطّة", "error")
        setIsSubmitting(false)
        return
      }

      const splitId = data[0].split_id as string
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
              <p className="text-xs mt-1.5" style={{ color: "var(--text-3)" }}>الحد الأقصى: 100</p>
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
