"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, useCallback } from "react"
import { supabase } from "@/app/lib/supabase"
import { useToast } from "@/app/components/Toast"
import { PaymentProgress } from "@/app/components/PaymentProgress"
import { MemberList } from "@/app/components/MemberList"
import type { Member, SplitData } from "@/app/lib/types"

function formatRemaining(ms: number) {
  if (ms <= 0) return "وصل وقت اللقاء 🎉"
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d} يوم • ${h} ساعة • ${m} دقيقة`
  if (h > 0) return `${h} ساعة • ${m} دقيقة • ${sec} ثانية`
  return `${m} دقيقة • ${sec} ثانية`
}

function formatArabicDate(isoString: string) {
  const date = new Date(isoString)
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }
  return date.toLocaleDateString("ar-SA", options)
}

const isEmptyName = (name: string) => {
  const t = (name ?? "").trim()
  return t.length === 0 || t.toUpperCase() === "EMPTY"
}

function normalizeMembers(people: number, members: Member[]) {
  const finalPeople = Math.max(2, Math.min(50, Math.floor(people || 0)))

  // رتّبي بحيث اللي عنده اسم يجي أول، ثم المقاعد الفاضية
  const cleaned = (members || []).map((m) => ({
    id: m.id,
    name: isEmptyName(m.name) ? "" : String(m.name ?? ""),
    paid: Boolean(m.paid),
  }))

  const padded: Member[] = Array.from({ length: finalPeople }, (_, i) => {
    const m = cleaned[i]
    return m ? m : { id: crypto.randomUUID(), name: "", paid: false }
  })

  return padded
}

export default function SplitPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<SplitData | null>(null)
  const [myName, setMyName] = useState("")
  const [newName, setNewName] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadFromSupabase = useCallback(async () => {
    setLoading(true)

    const { data: split, error: splitErr } = await supabase
      .from("splits")
      .select("id,title,total,people,fee_per_person,event_at")
      .eq("id", id)
      .single()

    if (splitErr || !split) {
      setData(null)
      setLoading(false)
      return
    }

    const { data: membersRows, error: memErr } = await supabase
      .from("members")
      .select("id,name,paid")
      .eq("split_id", id)
      .order("created_at", { ascending: true })

    if (memErr) {
      setData(null)
      setLoading(false)
      return
    }

    const members = normalizeMembers(split.people, (membersRows || []) as Member[])

    setData({
      id: split.id,
      title: split.title,
      total: Number(split.total ?? 0),
      people: Number(split.people ?? 0),
      feePerPerson: Number(split.fee_per_person ?? 0),
      eventAtISO: String(split.event_at ?? ""),
      members,
    })

    setLoading(false)
  }, [id])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (mounted) {
        await loadFromSupabase()
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [loadFromSupabase])

  const share = useMemo(() => {
    if (!data) return 0
    return Math.ceil(data.total / data.people) + (data.feePerPerson ?? 0)
  }, [data])

  const paidCount = useMemo(() => {
    if (!data) return 0
    return (data.members || []).filter((m) => m.paid).length
  }, [data])

  const joinedCount = useMemo(() => {
    if (!data) return 0
    return (data.members || []).filter((m) => m.name.trim().length > 0).length
  }, [data])

  const eventAtISO = data?.eventAtISO
  const remainingText = useMemo(() => {
    if (!eventAtISO) return ""
    const target = new Date(eventAtISO).getTime()
    return formatRemaining(target - now)
  }, [eventAtISO, now])

  const isFull = useMemo(() => {
    if (!data) return false
    return data.members.every((m) => m.name.trim().length > 0)
  }, [data])

  const confirmPaid = async () => {
    if (!data) return
    const name = myName.trim()
    if (!name) {
      showToast("اكتب الاسم أول", "error")
      return
    }

    setConfirmingPayment(true)

    try {
      const lower = name.toLowerCase()

      const existing = data.members.find((m) => m.name.trim().toLowerCase() === lower)
      if (existing) {
        const { error } = await supabase.from("members").update({ paid: true }).eq("id", existing.id)
        if (error) {
          showToast(error.message, "error")
        } else {
          showToast("تم تأكيد الدفع", "success")
        }
        setMyName("")
        await loadFromSupabase()
        setConfirmingPayment(false)
        return
      }

      const empty = data.members.find((m) => m.name.trim().length === 0)
      if (!empty) {
        showToast("القِطّة اكتملت — ما فيه مقاعد فاضية", "error")
        setConfirmingPayment(false)
        return
      }

      const { error } = await supabase
        .from("members")
        .update({ name, paid: true })
        .eq("id", empty.id)

      if (error) {
        showToast(error.message, "error")
      } else {
        showToast("تم تأكيد الدفع وإضافة الاسم", "success")
      }

      setMyName("")
      await loadFromSupabase()
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }

    setConfirmingPayment(false)
  }

  const togglePaid = async (memberId: string) => {
    if (!data) return
    const m = data.members.find((x) => x.id === memberId)
    if (!m) return
    if (m.name.trim().length === 0) return

    setTogglingId(memberId)

    try {
      const { error } = await supabase.from("members").update({ paid: !m.paid }).eq("id", memberId)
      if (error) {
        showToast(error.message, "error")
      }
      await loadFromSupabase()
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }

    setTogglingId(null)
  }

  const addMember = async () => {
    if (!data) return
    const name = newName.trim()
    if (!name) {
      showToast("اكتب الاسم للإضافة", "error")
      return
    }

    const exists = data.members.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())
    if (exists) {
      showToast("الاسم موجود بالفعل", "error")
      return
    }

    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) {
      showToast("القِطّة اكتملت — ما فيه مقاعد فاضية", "error")
      return
    }

    setAddingMember(true)

    try {
      const { error } = await supabase.from("members").update({ name, paid: false }).eq("id", empty.id)
      if (error) {
        showToast(error.message, "error")
      } else {
        showToast("تم إضافة العضو", "success")
      }
      setNewName("")
      await loadFromSupabase()
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }

    setAddingMember(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 text-center">
        جاري تحميل الرابط…
      </main>
    )
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 text-center">
        الرابط غير متاح — تأكدي من صحة الرابط أو أنشئي رابط جديد
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold">{data.title}</h1>
          <p className="text-gray-500 mt-2">شارك الرابط مع المجموعة وتابع المدفوعات</p>
        </header>

        <section className="border rounded-2xl p-5 sm:p-6">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-gray-500">حصة الشخص</p>
              <div className="text-4xl font-bold mt-1">{share} ريال</div>
            </div>
            <div className="text-right">
              <p className="text-gray-500">العدّ التنازلي</p>
              <p className="font-semibold mt-1">{remainingText}</p>
            </div>
          </div>

          <div className="mt-5">
            <PaymentProgress
              paidCount={paidCount}
              joinedCount={joinedCount}
              totalPeople={data.people}
              isFull={isFull}
            />
          </div>
        </section>

        <section className="border rounded-2xl p-5 sm:p-6">
          <h2 className="font-semibold mb-3">تأكيد الدفع ✅</h2>
          <div className="flex gap-2">
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="اكتب الاسم"
              className="flex-1 border rounded-xl p-3"
            />
            <button
              onClick={confirmPaid}
              className="bg-black text-white px-5 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={!myName.trim() || confirmingPayment}
            >
              {confirmingPayment ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "تم"
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            إذا الاسم غير موجود سيتم وضعه في أول مقعد فاضي (بدون زيادة العدد).
          </p>
        </section>

        <section className="border rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">قائمة المجموعة</h2>
            <span className="text-xs text-gray-400">اضغط على الحالة للتبديل</span>
          </div>

          <MemberList
            members={data.members}
            togglingId={togglingId}
            onToggle={togglePaid}
          />
        </section>

        <section className="border rounded-2xl p-5 sm:p-6">
          <h2 className="font-semibold mb-3">إضافة اسم (للمنسّق)</h2>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="اسم الشخص"
              className="flex-1 border rounded-xl p-3"
            />
            <button
              onClick={addMember}
              className="bg-black text-white px-5 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={isFull || addingMember}
            >
              {addingMember ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "إضافة"
              )}
            </button>
          </div>
          {isFull && <p className="text-xs text-gray-400 mt-2">القِطّة اكتملت ✅</p>}
        </section>

        <button
          onClick={() => {
            const url = window.location.href
            const formattedDate = formatArabicDate(data.eventAtISO)
            navigator.clipboard.writeText(
              `هذا رابط القِطّة 👇\nاكتب الاسم واضغط (تأكيد الدفع) بعد التحويل\nموعد اللقاء: ${formattedDate}\n${url}`
            )
            showToast("تم نسخ رسالة المشاركة", "success")
          }}
          className="w-full bg-black text-white rounded-2xl py-3 font-semibold"
        >
          نسخ رسالة المشاركة
        </button>

        <a className="block text-sm text-gray-400 underline text-center" href="/create">
          إنشاء رابط جديد
        </a>

        <p className="text-xs text-gray-400 text-center">
          خدمة لتنظيم المدفوعات بين الأصدقاء فقط.
        </p>
      </div>
    </main>
  )
}