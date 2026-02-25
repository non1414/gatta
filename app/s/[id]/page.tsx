"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/app/lib/supabase" // عدّلي المسار إذا ملفك بمكان ثاني

type Member = { id: string; name: string; paid: boolean }
type SplitData = {
  title: string
  total: number
  people: number
  feePerPerson: number
  eventAtISO: string
  members: Member[]
  createdAt: number
}

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

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export default function SplitPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<SplitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [myName, setMyName] = useState("")
  const [newName, setNewName] = useState("")
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadFromDb = async () => {
    try {
      setLoading(true)

      // 1) split
      const { data: split, error: splitErr } = await supabase
        .from("splits")
        .select("id,title,total,people,fee_per_person,event_at,created_at")
        .eq("id", id)
        .single()

      if (splitErr || !split) {
        setData(null)
        return
      }

      const people = clampInt(Number(split.people ?? 0), 2, 50)

      // 2) members
      const { data: membersRows, error: memErr } = await supabase
        .from("members")
        .select("id,name,paid")
        .eq("split_id", id)
        .order("created_at", { ascending: true })

      if (memErr) {
        setData(null)
        return
      }

      let members: Member[] = (membersRows ?? []).map((m: any) => ({
        id: String(m.id),
        name: String(m.name ?? ""),
        paid: Boolean(m.paid),
      }))

      // تأكيد طول القائمة = people (لو ناقص نكمله بمقاعد فاضية داخل DB)
      if (members.length < people) {
        const missing = people - members.length
        const toInsert = Array.from({ length: missing }, () => ({
          split_id: id,
          name: "",
          paid: false,
          created_at: Date.now(),
        }))
        await supabase.from("members").insert(toInsert)

        const { data: membersRows2 } = await supabase
          .from("members")
          .select("id,name,paid")
          .eq("split_id", id)
          .order("created_at", { ascending: true })

        members = (membersRows2 ?? []).slice(0, people).map((m: any) => ({
          id: String(m.id),
          name: String(m.name ?? ""),
          paid: Boolean(m.paid),
        }))
      } else {
        members = members.slice(0, people)
      }

      const next: SplitData = {
        title: String(split.title ?? ""),
        total: Number(split.total ?? 0),
        people,
        feePerPerson: Number(split.fee_per_person ?? 0),
        eventAtISO: String(split.event_at ?? ""),
        members,
        createdAt: Number(split.created_at ?? Date.now()),
      }

      setData(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFromDb()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

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

  const progress = useMemo(() => {
    if (!data || data.people <= 0) return 0
    return Math.round((paidCount / data.people) * 100)
  }, [data, paidCount])

  const remainingText = useMemo(() => {
    if (!data?.eventAtISO) return ""
    const target = new Date(data.eventAtISO).getTime()
    return formatRemaining(target - now)
  }, [data?.eventAtISO, now])

  const isFull = useMemo(() => {
    if (!data) return false
    return data.members.every((m) => m.name.trim().length > 0)
  }, [data])

  const updateMember = async (memberId: string, patch: Partial<Member>) => {
    if (!data) return
    const nextMembers = data.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m))
    setData({ ...data, members: nextMembers })

    await supabase
      .from("members")
      .update({
        name: patch.name,
        paid: patch.paid,
      })
      .eq("id", memberId)
  }

  const confirmPaid = async () => {
    if (!data) return
    const name = myName.trim()
    if (!name) return alert("اكتب الاسم أول")

    const lower = name.toLowerCase()

    // إذا الاسم موجود، علّمه مدفوع
    const existing = data.members.find((m) => m.name.trim().toLowerCase() === lower)
    if (existing) {
      await updateMember(existing.id, { paid: true })
      setMyName("")
      return
    }

    // إذا الاسم غير موجود: عبّيه في أول مقعد فاضي
    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) return alert("القِطّة اكتملت — ما فيه مقاعد فاضية لإضافة اسم جديد.")

    await updateMember(empty.id, { name, paid: true })
    setMyName("")
  }

  const togglePaid = async (memberId: string) => {
    if (!data) return
    const member = data.members.find((m) => m.id === memberId)
    if (!member) return
    if (member.name.trim().length === 0) return

    await updateMember(memberId, { paid: !member.paid })
  }

  const addMember = async () => {
    if (!data) return
    const name = newName.trim()
    if (!name) return alert("اكتب الاسم للإضافة")

    const exists = data.members.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())
    if (exists) return alert("الاسم موجود بالفعل")

    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) return alert("القِطّة اكتملت — ما فيه مقاعد فاضية.")

    await updateMember(empty.id, { name, paid: false })
    setNewName("")
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
        الرابط غير متاح — تأكدي من صحة الرابط أو أن الرابط موجود في قاعدة البيانات
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

          <div className="mt-5 space-y-2">
            <div className="flex justify-between text-sm text-gray-500">
              <span>المدفوع</span>
              <span>
                {paidCount}/{data.people} • {progress}%
              </span>
            </div>

            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-black" style={{ width: `${progress}%` }} />
            </div>

            <div className="flex justify-between text-sm text-gray-500">
              <span>المنضمّين</span>
              <span>
                {joinedCount}/{data.people} {isFull ? "• اكتملت ✅" : ""}
              </span>
            </div>
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
              className="bg-black text-white px-5 rounded-xl font-semibold disabled:opacity-50"
              disabled={!myName.trim()}
            >
              تم
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

          <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
            {data.members.map((m, index) => {
              const isEmpty = m.name.trim().length === 0
              return (
                <button
                  key={m.id}
                  onClick={() => togglePaid(m.id)}
                  disabled={isEmpty}
                  className={`w-full flex items-center justify-between border rounded-xl px-4 py-3 text-right ${
                    isEmpty ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="font-medium">
                    {isEmpty ? `مقعد متاح (${index + 1})` : m.name}
                  </span>
                  <span className="text-xl">{isEmpty ? "+" : m.paid ? "✅" : "⏳"}</span>
                </button>
              )
            })}
          </div>
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
              className="bg-black text-white px-5 rounded-xl font-semibold disabled:opacity-50"
              disabled={isFull}
            >
              إضافة
            </button>
          </div>
          {isFull && <p className="text-xs text-gray-400 mt-2">القِطّة اكتملت ✅</p>}
        </section>

        <button
          onClick={() => {
            const url = window.location.href
            navigator.clipboard.writeText(
              `هذا رابط القِطّة 👇\nاكتب الاسم واضغط (تأكيد الدفع) بعد التحويل\nموعد اللقاء: ${data.eventAtISO}\n${url}`
            )
            alert("تم نسخ رسالة المشاركة ✅")
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