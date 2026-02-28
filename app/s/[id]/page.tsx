"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, useCallback } from "react"
import { supabase } from "@/app/lib/supabase"
import { useToast } from "@/app/components/Toast"
import { PaymentProgress } from "@/app/components/PaymentProgress"
import { MemberList } from "@/app/components/MemberList"
import type { Member, SplitData } from "@/app/lib/types"
import { Footer } from "@/app/components/Footer"

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
  return new Date(isoString).toLocaleDateString("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const isEmptyName = (name: string) => {
  const t = (name ?? "").trim()
  return t.length === 0 || t.toUpperCase() === "EMPTY"
}

function normalizeMembers(people: number, members: Member[]) {
  const finalPeople = Math.max(2, Math.min(50, Math.floor(people || 0)))
  const cleaned = (members || []).map((m) => ({
    id: m.id,
    name: isEmptyName(m.name) ? "" : String(m.name ?? ""),
    paid: Boolean(m.paid),
  }))
  return Array.from({ length: finalPeople }, (_, i) =>
    cleaned[i] ?? { id: crypto.randomUUID(), name: "", paid: false }
  )
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
      .select("id,title,total,people,event_at")
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

    setData({
      id: split.id,
      title: split.title,
      total: Number(split.total ?? 0),
      people: Number(split.people ?? 0),
      eventAtISO: String(split.event_at ?? ""),
      members: normalizeMembers(split.people, (membersRows || []) as Member[]),
    })

    setLoading(false)
  }, [id])

  useEffect(() => {
    let mounted = true
    const load = async () => { if (mounted) await loadFromSupabase() }
    load()
    return () => { mounted = false }
  }, [loadFromSupabase])

  // Realtime: patch member rows in-place on UPDATE — no full refetch needed
  useEffect(() => {
    if (!id) return

    const channel = supabase
      .channel(`members-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "members",
          filter: `split_id=eq.${id}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; name: string; paid: boolean }
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  members: prev.members.map((m) =>
                    m.id === updated.id
                      ? { ...m, name: updated.name, paid: updated.paid }
                      : m
                  ),
                }
              : prev
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id])

  const share = useMemo(() => {
    if (!data || data.people <= 0) return 0
    return data.total / data.people
  }, [data])

  const paidCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.paid).length,
    [data]
  )
  const joinedCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.name.trim().length > 0).length,
    [data]
  )
  const isFull = useMemo(
    () => !!data && data.members.every((m) => m.name.trim().length > 0),
    [data]
  )

  const eventAtISO = data?.eventAtISO
  const remainingText = useMemo(() => {
    if (!eventAtISO) return ""
    return formatRemaining(new Date(eventAtISO).getTime() - now)
  }, [eventAtISO, now])

  const confirmPaid = async () => {
    if (!data) return
    const name = myName.trim()
    if (!name) { showToast("اكتب الاسم أولاً", "error"); return }

    setConfirmingPayment(true)
    try {
      const lower = name.toLowerCase()
      const existing = data.members.find((m) => m.name.trim().toLowerCase() === lower)

      if (existing) {
        const { error } = await supabase.from("members").update({ paid: true }).eq("id", existing.id)
        if (error) showToast(error.message, "error")
        else showToast("تم تأكيد الدفع ✅", "success")
        setMyName("")
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

      if (error) showToast(error.message, "error")
      else showToast("تم تأكيد الدفع وإضافة الاسم ✅", "success")

      setMyName("")
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }
    setConfirmingPayment(false)
  }

  const togglePaid = async (memberId: string) => {
    if (!data) return
    const m = data.members.find((x) => x.id === memberId)
    if (!m || m.name.trim().length === 0) return

    setTogglingId(memberId)
    try {
      const { error } = await supabase
        .from("members")
        .update({ paid: !m.paid })
        .eq("id", memberId)
      if (error) showToast(error.message, "error")
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }
    setTogglingId(null)
  }

  const addMember = async () => {
    if (!data) return
    const name = newName.trim()
    if (!name) { showToast("اكتب الاسم للإضافة", "error"); return }

    if (data.members.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast("الاسم موجود بالفعل", "error")
      return
    }

    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) { showToast("القِطّة اكتملت — ما فيه مقاعد فاضية", "error"); return }

    setAddingMember(true)
    try {
      const { error } = await supabase
        .from("members")
        .update({ name, paid: false })
        .eq("id", empty.id)
      if (error) showToast(error.message, "error")
      else showToast("تم إضافة العضو", "success")
      setNewName("")
    } catch {
      showToast("حدث خطأ غير متوقع", "error")
    }
    setAddingMember(false)
  }

  const buildShareText = () => {
    if (!data) return ""
    const url = window.location.href
    const formattedDate = formatArabicDate(data.eventAtISO)
    return [
      `هذا رابط القِطّة 👇`,
      ``,
      `المناسبة: ${data.title}`,
      `المبلغ الإجمالي: ${data.total} ريال`,
      `حصة الشخص: ${share.toFixed(2)} ريال`,
      `موعد اللقاء: ${formattedDate}`,
      ``,
      `اكتب اسمك واضغط "تأكيد الدفع" بعد إتمام التحويل`,
      url,
    ].join("\n")
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(buildShareText())
    showToast("تم نسخ رسالة المشاركة", "success")
  }

  const handleWhatsApp = async () => {
    const text = buildShareText()
    if (navigator.share) {
      try {
        await navigator.share({ title: `قِطّة: ${data?.title}`, text })
        return
      } catch {
        // user cancelled or not supported — fall through to WhatsApp
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank")
  }

  /* ─── Loading ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <span
            className="spinner spinner-light"
            style={{ width: 24, height: 24 }}
          />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>
            جاري التحميل…
          </span>
        </div>
      </main>
    )
  }

  /* ─── Not found ───────────────────────────────────────────── */
  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <div className="text-4xl">🔗</div>
          <p className="font-semibold">الرابط غير متاح</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            تأكّد من صحة الرابط أو أنشئ رابطاً جديداً
          </p>
          <a
            href="/create"
            className="btn btn-ghost"
            style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
          >
            إنشاء رابط جديد
          </a>
        </div>
      </main>
    )
  }

  /* ─── Main ────────────────────────────────────────────────── */
  return (
    <main className="min-h-dvh px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-md space-y-4">

        {/* Header */}
        <header className="text-center space-y-1 pb-2">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            شارك الرابط مع المجموعة وتابع المدفوعات
          </p>
        </header>

        {/* Summary card */}
        <div className="card space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>
                حصة الشخص
              </p>
              <div className="text-4xl font-black leading-none">
                {share.toFixed(2)}
                <span
                  className="text-xl font-normal mr-1"
                  style={{ color: "var(--text-2)" }}
                >
                  ريال
                </span>
              </div>
            </div>
            {remainingText && (
              <div className="text-left shrink-0">
                <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>
                  الموعد
                </p>
                <p className="font-semibold text-sm leading-snug">{remainingText}</p>
              </div>
            )}
          </div>

          <PaymentProgress
            paidCount={paidCount}
            joinedCount={joinedCount}
            totalPeople={data.people}
            isFull={isFull}
          />
        </div>

        {/* Confirm payment */}
        <div className="card space-y-3">
          <h2 className="section-title">تأكيد الدفع ✅</h2>
          <div className="flex gap-2">
            <input
              className="field"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmPaid()}
              placeholder="اكتب اسمك هنا"
            />
            <button
              className="btn btn-white"
              onClick={confirmPaid}
              disabled={!myName.trim() || confirmingPayment}
              style={{ width: "auto", padding: "13px 20px", flexShrink: 0 }}
            >
              {confirmingPayment ? <span className="spinner" /> : "تم"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            إذا كان اسمك غير موجود، سيُضاف تلقائياً في أول مقعد فاضٍ.
          </p>
        </div>

        {/* Member list */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              المجموعة
            </h2>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>
              اضغط للتبديل
            </span>
          </div>
          <MemberList
            members={data.members}
            togglingId={togglingId}
            onToggle={togglePaid}
          />
        </div>

        {/* Add member (organizer) */}
        <div className="card space-y-3">
          <h2 className="section-title">إضافة عضو (للمنسّق)</h2>
          <div className="flex gap-2">
            <input
              className="field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              placeholder="اسم الشخص"
              disabled={isFull}
            />
            <button
              className="btn btn-white"
              onClick={addMember}
              disabled={isFull || addingMember || !newName.trim()}
              style={{ width: "auto", padding: "13px 20px", flexShrink: 0 }}
            >
              {addingMember ? <span className="spinner" /> : "إضافة"}
            </button>
          </div>
          {isFull && (
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              القِطّة اكتملت ✅
            </p>
          )}
        </div>

        {/* Share actions */}
        <div className="space-y-2">
          <button className="btn btn-white" onClick={handleWhatsApp}>
            مشاركة عبر واتساب
          </button>
          <button className="btn btn-ghost" onClick={handleCopy}>
            نسخ رسالة المشاركة
          </button>
        </div>

        <a
          href="/create"
          className="block text-center text-sm"
          style={{ color: "var(--text-3)", textDecoration: "none" }}
        >
          إنشاء رابط جديد
        </a>

      </div>
      <Footer />
    </main>
  )
}
