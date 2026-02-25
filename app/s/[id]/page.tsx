"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

type Member = { id: string; name: string; paid: boolean }
type SplitData = {
  title: string
  total: number
  people: number // هذا هو عدد المقاعد (Slots)
  feePerPerson: number
  eventAtISO: string
  members: Member[] // لازم دائمًا يكون طولها = people
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

const isPlaceholderName = (name: string) => /^شخص\s+\d+$/i.test(name.trim())

function makeEmptySeat(): Member {
  return { id: crypto.randomUUID(), name: "", paid: false }
}

function normalize(parsed: any): SplitData | null {
  if (!parsed) return null

  // people = عدد المقاعد (Slots)
  const rawPeople = Number(parsed.people)
  const people = Number.isFinite(rawPeople) ? Math.max(Math.floor(rawPeople), 0) : 0

  // 1) اجيب members لو موجودة
  let members: Member[] = Array.isArray(parsed.members) ? parsed.members : []

  // إذا ما فيه members (روابط قديمة جدًا) -> أنشئ مقاعد فاضية بعدد people
  if (!Array.isArray(parsed.members)) {
    const count = people
    members = Array.from({ length: count }, () => ({
      id: crypto.randomUUID(),
      name: "",
      paid: false,
    }))
  }

  // 2) تنظيف النسخ القديمة:
  // - "شخص 1/2/3" تعتبر مقعد فاضي إذا ما كان مدفوع
  members = members.map((m: any) => {
    const name = String(m?.name ?? "")
    const paid = Boolean(m?.paid)
    const isOldPlaceholder = /^شخص\s+\d+$/i.test(name.trim())

    // placeholder القديم يتحول لمقعد فاضي (إذا مو مدفوع)
    if (!paid && isOldPlaceholder) {
      return { id: m?.id || crypto.randomUUID(), name: "", paid: false }
    }

    // احتراز: إذا الاسم فاضي، خليه غير مدفوع
    if (name.trim().length === 0) {
      return { id: m?.id || crypto.randomUUID(), name: "", paid: false }
    }

    return {
      id: m?.id || crypto.randomUUID(),
      name,
      paid,
    }
  })

  // 3) تأكيد أن عدد المقاعد ثابت
  // اذا people موجود نثبته، وإذا ما هو موجود نأخذه من members
  // مع حد أدنى 2 وحد أقصى 50 (MVP)
  const finalPeople = Math.max(2, Math.min(50, Math.max(people, members.length)))

  // 4) خلي طول القائمة = finalPeople (أي مقاعد ناقصة نضيفها فاضية)
  const normalizedMembers: Member[] = Array.from({ length: finalPeople }, (_, i) => {
    const m = members[i]
    return m
      ? { id: m.id || crypto.randomUUID(), name: m.name ?? "", paid: Boolean(m.paid) }
      : { id: crypto.randomUUID(), name: "", paid: false }
  })

  // 5) رجع SplitData مضبوط
  const next: SplitData = {
    title: String(parsed.title ?? ""),
    total: Number(parsed.total ?? 0),
    people: finalPeople,
    feePerPerson: Number(parsed.feePerPerson ?? 0),
    eventAtISO: String(parsed.eventAtISO ?? ""),
    members: normalizedMembers,
    createdAt: Number(parsed.createdAt ?? Date.now()),
  }

  return next
}

export default function SplitPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<SplitData | null>(null)
  const [myName, setMyName] = useState("")
  const [newName, setNewName] = useState("")
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const save = (next: SplitData) => {
    setData(next)
    localStorage.setItem(id, JSON.stringify(next))
  }

  const load = () => {
    const saved = localStorage.getItem(id)
    if (!saved) return
    const parsed = normalize(JSON.parse(saved))
    if (!parsed) return
    save(parsed)
  }

  useEffect(() => {
    load()
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

  const confirmPaid = () => {
    if (!data) return
    const name = myName.trim()
    if (!name) return alert("اكتب الاسم أول")

    const lower = name.toLowerCase()

    // إذا الاسم موجود، علّمه مدفوع
    const idx = data.members.findIndex(
      (m) => m.name.trim().toLowerCase() === lower
    )

    const next: SplitData = { ...data, members: [...data.members] }

    if (idx >= 0) {
      next.members[idx] = { ...next.members[idx], paid: true }
      save(next)
      setMyName("")
      return
    }

    // إذا الاسم غير موجود: عبّيه في أول مقعد فاضي (بدون زيادة عدد المقاعد)
    const emptyIndex = next.members.findIndex((m) => m.name.trim().length === 0)
    if (emptyIndex === -1) {
      return alert("القِطّة اكتملت — ما فيه مقاعد فاضية لإضافة اسم جديد.")
    }

    next.members[emptyIndex] = {
      ...next.members[emptyIndex],
      name,
      paid: true,
    }

    save(next)
    setMyName("")
  }

  const togglePaid = (memberId: string) => {
    if (!data) return
    const member = data.members.find((m) => m.id === memberId)
    if (!member) return

    // لا تسمحين بتبديل حالة مقعد فاضي
    if (member.name.trim().length === 0) return

    const next = {
      ...data,
      members: data.members.map((m) =>
        m.id === memberId ? { ...m, paid: !m.paid } : m
      ),
    }
    save(next)
  }

  const addMember = () => {
    if (!data) return
    const name = newName.trim()
    if (!name) return alert("اكتب الاسم للإضافة")

    const exists = data.members.some(
      (m) => m.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (exists) return alert("الاسم موجود بالفعل")

    const next: SplitData = { ...data, members: [...data.members] }

    // عبّي أول مقعد فاضي (بدون زيادة slots)
    const emptyIndex = next.members.findIndex((m) => m.name.trim().length === 0)
    if (emptyIndex === -1) {
      return alert("القِطّة اكتملت — ما فيه مقاعد فاضية.")
    }

    next.members[emptyIndex] = {
      ...next.members[emptyIndex],
      name,
      paid: false,
    }

    save(next)
    setNewName("")
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 text-center">
        الرابط غير متاح — أنشئ رابط جديد من صفحة الإنشاء
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

          {/* مهم: سكرول حتى ما تكتم الصفحة */}
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