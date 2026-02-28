"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, useCallback } from "react"
import { supabase } from "@/app/lib/supabase"
import { useToast } from "@/app/components/Toast"
import { PaymentProgress } from "@/app/components/PaymentProgress"
import { MemberList } from "@/app/components/MemberList"
import { Footer } from "@/app/components/Footer"
import { PageHeader } from "@/app/components/PageHeader"
import { EidDecorOverlay } from "@/app/components/EidDecorOverlay"
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
  return new Date(isoString).toLocaleDateString("ar-SA", {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "numeric", minute: "2-digit",
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

function patchMember(prev: SplitData | null, id: string, patch: Partial<Member>): SplitData | null {
  if (!prev) return prev
  return { ...prev, members: prev.members.map((m) => m.id === id ? { ...m, ...patch } : m) }
}

export default function SplitPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData]                           = useState<SplitData | null>(null)
  const [myName, setMyName]                       = useState("")
  const [newName, setNewName]                     = useState("")
  const [now, setNow]                             = useState(() => Date.now())
  const [loading, setLoading]                     = useState(true)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [addingMember, setAddingMember]           = useState(false)
  const [togglingId, setTogglingId]               = useState<string | null>(null)
  const { showToast } = useToast()

  // ── Organizer detection (localStorage flag set at creation) ───
  const [isOrganizer, setIsOrganizer] = useState(false)
  useEffect(() => {
    setIsOrganizer(localStorage.getItem(`gatta_org_${id}`) === "1")
  }, [id])

  // ── Bank transfer editing state ────────────────────────────────
  const [bankEdits, setBankEdits]   = useState({ name: "", iban: "" })
  const [editingBank, setEditingBank] = useState(false)
  const [savingBank, setSavingBank]   = useState(false)

  // Countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Initial load
  const loadFromSupabase = useCallback(async () => {
    setLoading(true)
    const { data: split, error: splitErr } = await supabase
      .from("splits")
      .select("*")
      .eq("id", id)
      .single()

    if (splitErr || !split) { setData(null); setLoading(false); return }

    const { data: membersRows, error: memErr } = await supabase
      .from("members")
      .select("id,name,paid")
      .eq("split_id", id)
      .order("created_at", { ascending: true })

    if (memErr) { setData(null); setLoading(false); return }

    const bankName = String(split.bank_name ?? "")
    const iban     = String(split.iban ?? "")

    setData({
      id: split.id,
      title: split.title,
      total: Number(split.total ?? 0),
      people: Number(split.people ?? 0),
      eventAtISO: String(split.event_at ?? ""),
      bankName,
      iban,
      members: normalizeMembers(split.people, (membersRows || []) as Member[]),
    })
    setBankEdits({ name: bankName, iban })
    setLoading(false)
  }, [id])

  useEffect(() => {
    let mounted = true
    const load = async () => { if (mounted) await loadFromSupabase() }
    load()
    return () => { mounted = false }
  }, [loadFromSupabase])

  // Realtime: patch member in-place on UPDATE
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`members-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "members", filter: `split_id=eq.${id}` },
        (payload) => {
          const u = payload.new as { id: string; name: string; paid: boolean }
          setData((prev) => patchMember(prev, u.id, { name: u.name, paid: u.paid }))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  // Derived
  const share = useMemo(() => {
    if (!data || data.people <= 0) return 0
    return data.total / data.people
  }, [data])

  const paidCount   = useMemo(() => (data?.members ?? []).filter((m) => m.paid).length, [data])
  const joinedCount = useMemo(() => (data?.members ?? []).filter((m) => m.name.trim().length > 0).length, [data])
  const isFull      = useMemo(() => !!data && data.members.every((m) => m.name.trim().length > 0), [data])

  const eventAtISO = data?.eventAtISO
  const remainingText = useMemo(() => {
    if (!eventAtISO) return ""
    return formatRemaining(new Date(eventAtISO).getTime() - now)
  }, [eventAtISO, now])

  // ── Confirm payment ───────────────────────────────────────────
  const confirmPaid = async () => {
    if (!data) return
    const name = myName.trim()
    if (!name) { showToast("اكتب الاسم أولاً", "error"); return }

    setConfirmingPayment(true)
    const lower    = name.toLowerCase()
    const existing = data.members.find((m) => m.name.trim().toLowerCase() === lower)

    if (existing) {
      setData((prev) => patchMember(prev, existing.id, { paid: true }))
      setMyName("")
      const { error } = await supabase.from("members").update({ paid: true }).eq("id", existing.id)
      if (error) {
        setData((prev) => patchMember(prev, existing.id, { paid: false }))
        showToast(error.message, "error")
      } else {
        showToast("تم تأكيد الدفع ✅", "success")
      }
      setConfirmingPayment(false)
      return
    }

    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) {
      showToast("القَطّة اكتملت — ما فيه مقاعد فاضية", "error")
      setConfirmingPayment(false)
      return
    }

    setData((prev) => patchMember(prev, empty.id, { name, paid: true }))
    setMyName("")
    try {
      const { error } = await supabase.from("members").update({ name, paid: true }).eq("id", empty.id)
      if (error) {
        setData((prev) => patchMember(prev, empty.id, { name: "", paid: false }))
        showToast(error.message, "error")
      } else {
        showToast("تم تأكيد الدفع وإضافة الاسم ✅", "success")
      }
    } catch {
      setData((prev) => patchMember(prev, empty.id, { name: "", paid: false }))
      showToast("حدث خطأ غير متوقع", "error")
    }
    setConfirmingPayment(false)
  }

  // ── Toggle paid ───────────────────────────────────────────────
  const togglePaid = async (memberId: string) => {
    if (!data) return
    const m = data.members.find((x) => x.id === memberId)
    if (!m || m.name.trim().length === 0) return

    setTogglingId(memberId)
    const newPaid = !m.paid
    setData((prev) => patchMember(prev, memberId, { paid: newPaid }))
    try {
      const { error } = await supabase.from("members").update({ paid: newPaid }).eq("id", memberId)
      if (error) {
        setData((prev) => patchMember(prev, memberId, { paid: m.paid }))
        showToast(error.message, "error")
      }
    } catch {
      setData((prev) => patchMember(prev, memberId, { paid: m.paid }))
      showToast("حدث خطأ غير متوقع", "error")
    }
    setTogglingId(null)
  }

  // ── Add member (organizer only) ───────────────────────────────
  const addMember = async () => {
    if (!data) return
    const name = newName.trim()
    if (!name) { showToast("اكتب الاسم للإضافة", "error"); return }

    if (data.members.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast("الاسم موجود بالفعل", "error"); return
    }
    const empty = data.members.find((m) => m.name.trim().length === 0)
    if (!empty) { showToast("القَطّة اكتملت — ما فيه مقاعد فاضية", "error"); return }

    // Optimistic — member appears immediately
    setData((prev) => patchMember(prev, empty.id, { name, paid: false }))
    setNewName("")
    setAddingMember(true)
    try {
      const { error } = await supabase.from("members").update({ name, paid: false }).eq("id", empty.id)
      if (error) {
        setData((prev) => patchMember(prev, empty.id, { name: "" }))
        showToast(error.message, "error")
      } else {
        showToast("تم إضافة الشخص", "success")
      }
    } catch {
      setData((prev) => patchMember(prev, empty.id, { name: "" }))
      showToast("حدث خطأ غير متوقع", "error")
    }
    setAddingMember(false)
  }

  // ── Save bank details (organizer only) ────────────────────────
  const saveBankDetails = async () => {
    if (!data) return
    setSavingBank(true)
    const { error } = await supabase
      .from("splits")
      .update({
        bank_name: bankEdits.name.trim() || null,
        iban:      bankEdits.iban.trim()  || null,
      })
      .eq("id", id)
    if (error) {
      showToast(error.message, "error")
    } else {
      const updated = { bankName: bankEdits.name.trim(), iban: bankEdits.iban.trim() }
      setData((prev) => prev ? { ...prev, ...updated } : prev)
      setEditingBank(false)
      showToast("تم حفظ بيانات التحويل ✅", "success")
    }
    setSavingBank(false)
  }

  // ── Copy IBAN ─────────────────────────────────────────────────
  const copyIban = () => {
    navigator.clipboard.writeText(data?.iban ?? "")
    showToast("تم نسخ رقم الحساب", "success")
  }

  // ── Share helpers ─────────────────────────────────────────────
  const PROD_ORIGIN = "https://gatta-chi.vercel.app"
  const shareUrl = `${PROD_ORIGIN}/s/${id}`

  const buildShareText = () => {
    if (!data) return ""
    const url = shareUrl
    return [
      `هذا رابط القَطّة 👇`,
      ``,
      `المناسبة: ${data.title}`,
      `المبلغ الإجمالي: ${data.total} ريال`,
      `حصة الشخص: ${share.toFixed(2)} ريال`,
      `موعد اللقاء: ${formatArabicDate(data.eventAtISO)}`,
      ...(data.iban ? [``, `رقم الآيبان: ${data.iban}`] : []),
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
      try { await navigator.share({ title: `قَطّة: ${data?.title}`, text }); return } catch { /* fallthrough */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank")
  }

  /* ─── Loading ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="spinner spinner-light" style={{ width: 26, height: 26 }} />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>جاري التحميل…</span>
        </div>
      </main>
    )
  }

  /* ─── Not found ────────────────────────────────────────────── */
  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <div className="text-4xl">🔗</div>
          <p className="font-semibold">الرابط غير متاح</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            تأكّد من صحة الرابط أو أنشئ رابطاً جديداً
          </p>
          <a href="/create" className="btn btn-ghost"
            style={{ width: "auto", display: "inline-flex", padding: "0 24px" }}>
            إنشاء رابط جديد
          </a>
        </div>
      </main>
    )
  }

  /* ─── Main ─────────────────────────────────────────────────── */
  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12" style={{ position: "relative" }}>
      <EidDecorOverlay />
      <div className="mx-auto max-w-md space-y-4">

        <PageHeader />

        {/* Event title */}
        <header className="text-center space-y-1 pb-1">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            شارك الرابط مع المجموعة وتابع المدفوعات
          </p>
        </header>

        {/* Summary card */}
        <div className="card space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>حصة الشخص</p>
              <div className="font-black leading-none" style={{ fontSize: 40 }}>
                <span style={{ color: "var(--primary)" }}>{share.toFixed(2)}</span>
                <span className="text-xl font-normal mr-1" style={{ color: "var(--text-2)" }}>ريال</span>
              </div>
            </div>
            {remainingText && (
              <div className="text-left shrink-0">
                <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>الموعد</p>
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

        {/* ── Bank transfer card ──────────────────────────────── */}
        {(isOrganizer || !!data.iban) && (
          <div className="card space-y-4">
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                التحويل إلى حساب المنسّق
              </h2>
              {isOrganizer && !editingBank && (
                <button
                  onClick={() => setEditingBank(true)}
                  style={{
                    fontSize: 13, fontWeight: 600,
                    color: "var(--primary)",
                    background: "none", border: "none",
                    cursor: "pointer", padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  تعديل
                </button>
              )}
            </div>

            {editingBank ? (
              /* Edit mode — organizer only */
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label className="label">اسم البنك</label>
                  <input
                    className="field"
                    value={bankEdits.name}
                    onChange={(e) => setBankEdits((p) => ({ ...p, name: e.target.value }))}
                    placeholder="مثال: بنك الراجحي"
                  />
                </div>
                <div>
                  <label className="label">رقم الآيبان (IBAN)</label>
                  <input
                    className="field"
                    value={bankEdits.iban}
                    onChange={(e) => setBankEdits((p) => ({ ...p, iban: e.target.value }))}
                    placeholder="SA00 0000 0000 0000 0000 0000"
                    style={{ direction: "ltr", textAlign: "left", letterSpacing: "0.5px" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-white"
                    onClick={saveBankDetails}
                    disabled={savingBank}
                    style={{ flex: 1 }}
                  >
                    {savingBank ? <span className="spinner" /> : "حفظ"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setEditingBank(false)
                      setBankEdits({ name: data.bankName, iban: data.iban })
                    }}
                    style={{ flex: 1 }}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              /* View mode — everyone */
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {data.bankName && (
                  <div>
                    <p className="label">البنك</p>
                    <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text-1)" }}>
                      {data.bankName}
                    </p>
                  </div>
                )}

                {data.iban ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <p className="label">رقم الآيبان</p>
                      <p style={{
                        fontSize: 15, fontWeight: 600,
                        color: "var(--text-1)",
                        direction: "ltr", textAlign: "left",
                        letterSpacing: "0.8px",
                        fontFamily: "monospace",
                      }}>
                        {data.iban}
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={copyIban}
                      style={{ height: 48, fontSize: 14 }}
                    >
                      نسخ رقم الحساب
                    </button>
                  </div>
                ) : isOrganizer ? (
                  <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                    لم تُضف بيانات التحويل بعد — اضغط &quot;تعديل&quot; لإضافتها.
                  </p>
                ) : null}

                <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
                  التحويل يتم مباشرة إلى حساب المنسّق. الموقع فقط لتنظيم القَطّة.
                </p>
              </div>
            )}
          </div>
        )}

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
              style={{ width: "auto", padding: "0 20px", flexShrink: 0 }}
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
            <h2 className="section-title" style={{ marginBottom: 0 }}>المجموعة</h2>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>اضغط للتبديل</span>
          </div>
          <MemberList members={data.members} togglingId={togglingId} onToggle={togglePaid} />
        </div>

        {/* Add person — organizer only */}
        {isOrganizer && (
          <div className="card space-y-3">
            <h2 className="section-title">إضافة شخص</h2>
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
                style={{ width: "auto", padding: "0 20px", flexShrink: 0 }}
              >
                {addingMember ? <span className="spinner" /> : "+ إضافة"}
              </button>
            </div>
            {isFull && (
              <p className="text-xs" style={{ color: "var(--success)" }}>القَطّة اكتملت ✅</p>
            )}
          </div>
        )}

        {/* Share actions */}
        <div className="space-y-2">
          <button className="btn btn-white" onClick={handleWhatsApp}>
            مشاركة عبر واتساب
          </button>
          <button className="btn btn-ghost" onClick={handleCopy}>
            نسخ رسالة المشاركة
          </button>
          <p className="text-xs text-center pt-1" style={{ color: "var(--text-3)" }}>
            سيُرسل الرابط مع تفاصيل القَطّة والمبلغ
          </p>
        </div>

        <a href="/create" className="block text-center text-sm"
          style={{ color: "var(--text-3)", textDecoration: "none" }}>
          إنشاء رابط جديد
        </a>

      </div>
      <Footer />
    </main>
  )
}
