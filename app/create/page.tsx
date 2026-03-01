"use client"

import { useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useToast } from "../components/Toast"
import { Footer } from "../components/Footer"
import { PageHeader } from "../components/PageHeader"
import { EidDecorOverlay } from "../components/EidDecorOverlay"

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function toLocalISO(datetimeLocalValue: string) {
  return new Date(datetimeLocalValue).toISOString()
}

export default function CreatePage() {
  const [title, setTitle]     = useState("")
  const [total, setTotal]     = useState("")
  const [people, setPeople]   = useState("")
  const [eventAt, setEventAt] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { showToast } = useToast()

  const peopleNum = useMemo(() => {
    const p = Number(people)
    if (!Number.isFinite(p) || p < 2) return 0
    return clampInt(Math.floor(p), 2, 50)
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
    if (!title.trim()) { showToast("اكتب اسم المناسبة", "error"); return }
    if (totalNum <= 0)  { showToast("أدخل مبلغاً صحيحاً", "error"); return }
    if (peopleNum < 2)  { showToast("عدد الأشخاص لازم يكون 2 على الأقل", "error"); return }
    if (!eventAt)       { showToast("حدّد تاريخ ووقت اللقاء", "error"); return }

    setIsSubmitting(true)

    try {
      const id      = crypto.randomUUID()
      const members = Array.from({ length: peopleNum }, () => ({
        id: crypto.randomUUID(), name: "", paid: false,
      }))

      const { error: splitErr } = await supabase.from("splits").insert({
        id, title: title.trim(), total: totalNum, people: peopleNum,
        fee_per_person: 0, event_at: toLocalISO(eventAt), created_at: Date.now(),
      })

      if (splitErr) { showToast(splitErr.message, "error"); setIsSubmitting(false); return }

      const { error: memErr } = await supabase.from("members").insert(
        members.map((m) => ({ id: m.id, split_id: id, name: m.name, paid: m.paid, created_at: Date.now() }))
      )

      if (memErr) { showToast(memErr.message, "error"); setIsSubmitting(false); return }

      showToast("تم إنشاء الرابط", "success")
      try { localStorage.setItem(`gatta_org_${id}`, "1") } catch {}
      window.location.href = `/s/${id}?org=1`
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12" style={{ position: "relative" }}>
      <EidDecorOverlay />
      <div className="mx-auto max-w-md">

        <PageHeader />

        {/* Heading */}
        <div className="text-center space-y-2 mb-6">
          <h1 className="text-2xl font-bold">إنشاء رابط قَطّة</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            أنشئ رابط قَطّة وشاركه مع أصدقائك لتتبع المدفوعات بسهولة.
          </p>
        </div>

        {/* Form card */}
        <div className="card space-y-5">

          <div>
            <label className="label">اسم المناسبة</label>
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: شاليه العيد"
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
              <p className="text-xs mt-1.5" style={{ color: "var(--text-3)" }}>الحد الأقصى: 50</p>
            </div>
          </div>

          <div>
            <label className="label">موعد اللقاء</label>
            <input
              type="datetime-local"
              className="field"
              value={eventAt}
              onChange={(e) => setEventAt(e.target.value)}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--text-3)" }}>
              سيظهر عدّ تنازلي في صفحة القَطّة حتى الموعد.
            </p>
          </div>

          {/* Live preview */}
          {previewShare && (
            <div
              className="rounded-2xl p-4 flex items-center justify-between"
              style={{ background: "rgba(255,107,61,0.07)", border: "1px solid rgba(255,107,61,0.18)" }}
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
