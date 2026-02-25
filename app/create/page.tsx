"use client"

import { useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import { useToast } from "../components/Toast"

type Member = { id: string; name: string; paid: boolean }
type SplitData = {
  title: string
  total: number
  people: number // عدد المقاعد (Slots)
  feePerPerson: number
  eventAtISO: string
  members: Member[] // طولها ثابت = people، ومقاعد فاضية name=""
  createdAt: number
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// datetime-local يرجع "YYYY-MM-DDTHH:mm" بدون timezone
// نحوله لـ ISO حقيقي حسب توقيت الجهاز
function toLocalISO(datetimeLocalValue: string) {
  const d = new Date(datetimeLocalValue)
  return d.toISOString()
}

export default function CreatePage() {
  const [title, setTitle] = useState("جلسة الشاليه 🎉")
  const [total, setTotal] = useState("2400")
  const [people, setPeople] = useState("8")
  const [eventAtISO, setEventAtISO] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { showToast } = useToast()

  const feePerPerson = 2

  const peopleNum = useMemo(() => {
    const p = Number(people)
    if (!Number.isFinite(p)) return 0
    return clampInt(Math.floor(p), 2, 50) // حد أعلى للمقاعد في الـ MVP
  }, [people])

  const totalNum = useMemo(() => {
    const t = Number(total)
    if (!Number.isFinite(t)) return 0
    return t
  }, [total])

  const previewShare = useMemo(() => {
    const t = totalNum
    const p = peopleNum
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(p) || p < 2) return "—"
    return String(Math.ceil(t / p) + feePerPerson)
  }, [totalNum, peopleNum])

const createLink = async () => {
    if (!title.trim()) {
      showToast("اكتب اسم المناسبة", "error")
      return
    }

    const t = Number(total)
    const p = Number(people)

    if (!Number.isFinite(t) || t <= 0) {
      showToast("أدخل مبلغ صحيح", "error")
      return
    }
    if (!Number.isFinite(p) || p < 2) {
      showToast("عدد الأشخاص لازم يكون 2 أو أكثر", "error")
      return
    }

    const finalPeople = clampInt(Math.floor(p), 2, 50)

    if (!eventAtISO) {
      showToast("حدد تاريخ ووقت اللقاء", "error")
      return
    }

    setIsSubmitting(true)

    try {
      const id = crypto.randomUUID()

      const members: Member[] = Array.from({ length: finalPeople }, () => ({
        id: crypto.randomUUID(),
        name: "",
        paid: false,
      }))

      const data: SplitData = {
        title: title.trim(),
        total: t,
        people: finalPeople,
        feePerPerson,
        eventAtISO: toLocalISO(eventAtISO),
        members,
        createdAt: Date.now(),
      }

      const { error: splitErr } = await supabase.from("splits").insert({
        id: id,
        title: data.title,
        total: data.total,
        people: data.people,
        fee_per_person: data.feePerPerson,
        event_at: data.eventAtISO,
        created_at: data.createdAt,
      })

      if (splitErr) {
        showToast(splitErr.message, "error")
        setIsSubmitting(false)
        return
      }

      const rows = data.members.map((m) => ({
        id: m.id,
        split_id: id,
        name: m.name,
        paid: m.paid,
        created_at: Date.now(),
      }))

      const { error: memErr } = await supabase.from("members").insert(rows)

      if (memErr) {
        showToast(memErr.message, "error")
        setIsSubmitting(false)
        return
      }

      showToast("تم إنشاء الرابط بنجاح", "success")
      window.location.href = `/s/${id}`
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">إنشاء رابط قِطّة</h1>
          <p className="text-gray-500 mt-2">رابط واحد… متابعة المدفوعات… وعدّ تنازلي للموعد</p>
        </div>

        <div className="border rounded-2xl p-5 sm:p-6 space-y-5">
          <div>
            <label className="block text-sm text-gray-500 mb-2">اسم المناسبة</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-xl p-3"
              placeholder="مثال: شاليه العيد"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-2">المبلغ (ريال)</label>
              <input
                value={total}
                onChange={(e) => {
                  // تنظيف بسيط: نخليها أرقام فقط (مع السماح بالنقطة)
                  const v = e.target.value.replace(/[^\d.]/g, "")
                  setTotal(v)
                }}
                className="w-full border rounded-xl p-3"
                inputMode="numeric"
                placeholder="2400"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-500 mb-2">عدد الأشخاص (المقاعد)</label>
              <input
                value={people}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "")
                  setPeople(v)
                }}
                className="w-full border rounded-xl p-3"
                inputMode="numeric"
                placeholder="8"
              />
              <p className="text-xs text-gray-400 mt-2">
                الحد الأقصى في النسخة التجريبية: 50 مقعد.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-2">موعد اللقاء (اليوم والوقت)</label>
            <input
              type="datetime-local"
              value={eventAtISO}
              onChange={(e) => setEventAtISO(e.target.value)}
              className="w-full border rounded-xl p-3"
            />
            <p className="text-xs text-gray-400 mt-2">
              سيظهر عدّ تنازلي داخل صفحة القِطّة حتى الموعد.
            </p>
          </div>

          <div className="bg-gray-50 border rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">معاينة حصة الشخص</span>
              <span className="font-bold text-lg">{previewShare} ريال</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              تشمل رسوم تنظيم بسيطة: {feePerPerson} ريال لكل شخص.
            </p>
          </div>

          <button
            onClick={createLink}
            disabled={isSubmitting}
            className="w-full bg-black text-white rounded-2xl py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                جاري الإنشاء...
              </>
            ) : (
              "إنشاء الرابط"
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            خدمة لتنظيم المدفوعات بين الأصدقاء فقط.
          </p>
        </div>
      </div>
    </main>
  )
}