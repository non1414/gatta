"use client"

import { useParams } from "next/navigation"
import { useEffect, useState, useCallback, useRef } from "react"
import { useToast } from "@/app/components/Toast"
import { Footer } from "@/app/components/Footer"
import type { SplitV2 } from "@/app/lib/types"
import { halalasToRiyalText } from "@/app/lib/types"
import { usePolling } from "@/app/lib/usePolling"

const CSRF_HEADER = "x-csrf-token"

function buildShareText(data: SplitV2, shareUrl: string) {
  return [
    `هذا رابط القَطّة 👇`, ``,
    `المناسبة: ${data.title}`,
    `المنظّم: ${data.organizer_name}`,
    `المبلغ الإجمالي: ${halalasToRiyalText(data.total_halalas)} ريال`,
    `حصة الشخص: ${halalasToRiyalText(data.total_halalas / data.people)} ريال`,
    `موعد اللقاء: ${new Date(data.event_at).toLocaleString("ar-SA")}`,
    ...(data.iban ? [``, `رقم الآيبان: ${data.iban}`] : []),
    ``, `انضمّي/انضمّ من الرابط، وبعد التحويل اضغطي/اضغط "حوّلت حصتي"`, shareUrl,
  ].join("\n")
}

function formatArabicDate(isoString: string) {
  return new Date(isoString).toLocaleDateString("ar-SA", {
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export default function ManagePage() {
  const params = useParams()
  const splitId = params.splitId as string
  const { showToast } = useToast()

  const [data, setData] = useState<SplitV2 | null>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)

  const [bankEdits, setBankEdits] = useState({ name: "", iban: "" })
  const [savingBank, setSavingBank] = useState(false)
  const [newName, setNewName] = useState("")
  const [addingMember, setAddingMember] = useState(false)
  const [increaseDelta, setIncreaseDelta] = useState("1")
  const [increasing, setIncreasing] = useState(false)
  const [issuedCodes, setIssuedCodes] = useState<Record<string, string>>({})
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // لا نستبدل ما تكتبه المنظّمة في حقلي البنك أثناء تحديث بصمت في الخلفية
  const bankEditsDirty = useRef(false)

  const manageFetch = useCallback(
    async (path: string, body: unknown) => {
      if (!csrfToken) throw new Error("no_session")
      const res = await fetch(`/api/manage/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: csrfToken },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "server_error")
      return json
    },
    [csrfToken]
  )

  const loadView = useCallback(async (withCsrf?: string) => {
    const res = await fetch("/api/manage/view", {
      headers: withCsrf ? { [CSRF_HEADER]: withCsrf } : {},
    })
    if (res.status === 401) {
      setUnauthorized(true)
      setLoading(false)
      return
    }
    const json = await res.json()
    setData(json.data)
    if (!bankEditsDirty.current) {
      setBankEdits({ name: json.data.bank_name ?? "", iban: json.data.iban ?? "" })
    }
    if (json.csrfToken) setCsrfToken(json.csrfToken)
    else if (withCsrf) setCsrfToken(withCsrf)
    setLoading(false)
  }, [])

  // تحديث دوري بصمت — فقط بعد نجاح تأسيس الجلسة، بلا مؤشر تحميل كامل وبلا
  // إخراج المنظّمة من اللوحة عند عطل عابر (تُبقي آخر بيانات ناجحة + تنبيه خفيف).
  const refreshView = useCallback(async () => {
    if (loading || unauthorized || !csrfToken) return
    const res = await fetch("/api/manage/view", { headers: { [CSRF_HEADER]: csrfToken } })
    if (!res.ok) throw new Error("refresh_failed")
    const json = await res.json()
    setData(json.data)
    if (!bankEditsDirty.current) {
      setBankEdits({ name: json.data.bank_name ?? "", iban: json.data.iban ?? "" })
    }
  }, [loading, unauthorized, csrfToken])

  usePolling(refreshView, {
    intervalMs: 10000,
    onFirstError: () => { setStale(true); showToast("تعذّر تحديث البيانات — نعرض آخر نسخة معروفة", "info") },
    onRecovered: () => setStale(false),
  })

  useEffect(() => {
    // سكربت مبكر: يُنفَّذ عند التحميل قبل أي مكوّن React — يلتقط توكن الإدارة
    // من fragment الرابط ويمسحه فورًا من شريط العنوان، حتى لا يبقى في تاريخ
    // المتصفح أو يُقرَأ عبر location.href من أي سكربت لاحق (كالتحليلات).
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : ""
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname)
    }

    const run = async () => {
      if (hash) {
        try {
          const res = await fetch("/api/manage/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ splitId, manageToken: hash }),
          })
          if (!res.ok) {
            setUnauthorized(true)
            setLoading(false)
            return
          }
          const json = await res.json()
          await loadView(json.csrfToken)
        } catch {
          setUnauthorized(true)
          setLoading(false)
        }
      } else {
        await loadView()
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitId])

  useEffect(() => {
    if (!openMenuId) return
    const closeMenu = () => setOpenMenuId(null)
    document.addEventListener("click", closeMenu)
    return () => document.removeEventListener("click", closeMenu)
  }, [openMenuId])

  const saveBankDetails = async () => {
    setSavingBank(true)
    try {
      await manageFetch("bank-details", { bankName: bankEdits.name, iban: bankEdits.iban })
      showToast("تم حفظ بيانات التحويل ✅", "success")
      bankEditsDirty.current = false // الآن تطابق الخادم؛ يمكن للتحديث الدوري مزامنتها بأمان
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّر الحفظ", "error")
    }
    setSavingBank(false)
  }

  const confirmReceipt = async (memberId: string, confirm: boolean) => {
    setBusyMemberId(memberId)
    try {
      await manageFetch("confirm-receipt", { memberId, confirm })
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّر التحديث", "error")
    }
    setBusyMemberId(null)
  }

  const addMember = async () => {
    if (!newName.trim()) return
    setAddingMember(true)
    try {
      await manageFetch("add-member", { name: newName.trim() })
      setNewName("")
      showToast("تم تسجيل الاسم", "success")
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّر الإضافة", "error")
    }
    setAddingMember(false)
  }

  const removeMember = async (memberId: string) => {
    setBusyMemberId(memberId)
    try {
      await manageFetch("remove-member", { memberId })
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّرت الإزالة", "error")
    }
    setBusyMemberId(null)
  }

  const increaseCapacity = async () => {
    const delta = parseInt(increaseDelta, 10)
    if (!Number.isInteger(delta) || delta < 1) return
    setIncreasing(true)
    try {
      await manageFetch("increase-capacity", { delta })
      showToast("تم تحديث العدد", "success")
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّرت الزيادة", "error")
    }
    setIncreasing(false)
  }

  const issueClaimCode = async (memberId: string) => {
    setBusyMemberId(memberId)
    setOpenMenuId(null)
    try {
      const json = await manageFetch("issue-claim-code", { memberId })
      setIssuedCodes((prev) => ({ ...prev, [memberId]: json.code }))
    } catch (e) {
      showToast(e instanceof Error ? e.message : "تعذّر إصدار الرمز", "error")
    }
    setBusyMemberId(null)
  }

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <span className="spinner spinner-light" style={{ width: 26, height: 26, borderTopColor: "var(--primary)", borderColor: "var(--border)" }} />
      </main>
    )
  }

  if (unauthorized || !data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <p className="font-semibold">لا يمكن فتح الإدارة</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            افتحي رابط الإدارة الذي حفظتِه عند إنشاء القطّة. إن فقدتِه، لا يوجد حاليًا مسار
            لاسترجاعه ذاتيًا.
          </p>
        </div>
      </main>
    )
  }

  const locked = !!data.reporting_started_at

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-md space-y-4">
        <div
          className="rounded-2xl p-3 text-sm text-center"
          style={{ background: "var(--toast-error-bg)", color: "var(--toast-error-text)", border: "1px solid var(--toast-error-border)" }}
        >
          🔒 هذا رابط إدارة سرّي — من يملكه يستطيع إدارة هذه القطّة بالكامل. يُشارَك فقط رابط
          المشاركة العادي أدناه، لا هذا الرابط.
        </div>

        <div className="card space-y-2">
          <h2 className="section-title" style={{ marginBottom: 0 }}>رابط المشاركة</h2>
          <p className="text-sm break-all" style={{ color: "var(--text-2)" }}>
            {typeof window !== "undefined" ? `${window.location.origin}/s/${splitId}` : `/s/${splitId}`}
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-white"
              onClick={async () => {
                if (!data) return
                const shareUrl = `${window.location.origin}/s/${splitId}`
                const text = buildShareText(data, shareUrl)
                if (navigator.share) {
                  try { await navigator.share({ title: `قَطّة: ${data.title}`, text }); return } catch { /* fallthrough */ }
                }
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank")
              }}
            >
              مشاركة عبر واتساب
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!data) return
                const shareUrl = `${window.location.origin}/s/${splitId}`
                navigator.clipboard.writeText(buildShareText(data, shareUrl))
                showToast("تم نسخ رسالة المشاركة", "success")
              }}
            >
              نسخ رسالة المشاركة
            </button>
          </div>
        </div>

        {stale && (
          <div className="rounded-2xl p-2.5 text-xs text-center" style={{ background: "var(--toast-info-bg)", border: "1px solid var(--toast-info-border)", color: "var(--toast-info-text)" }}>
            تعذّر آخر تحديث — تُعرض آخر بيانات معروفة، نحاول مجددًا تلقائيًا
          </div>
        )}

        <header className="text-center space-y-1">
          <h1 className="text-2xl font-bold" style={{ wordBreak: "break-word" }}>{data.title}</h1>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>لوحة إدارة — المنظّم: {data.organizer_name}</p>
        </header>

        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text-2)" }}>المبلغ الإجمالي</span>
            <span className="font-bold">{halalasToRiyalText(data.total_halalas)} ريال</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text-2)" }}>عدد الأشخاص</span>
            <span className="font-bold">{data.people}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text-2)" }}>الموعد</span>
            <span className="font-semibold text-sm">{formatArabicDate(data.event_at)}</span>
          </div>
          {locked && (
            <p className="text-xs pt-1" style={{ color: "var(--text-3)" }}>
              🔒 المبلغ وعدد الأشخاص مقفلان — بدأ أحد المشاركين الإبلاغ عن تحويله.
            </p>
          )}
        </div>

        {/* بيانات التحويل */}
        <div className="card space-y-3">
          <h2 className="section-title" style={{ marginBottom: 0 }}>بيانات التحويل</h2>
          <div>
            <label className="label">اسم البنك</label>
            <input className="field" value={bankEdits.name}
              onChange={(e) => { bankEditsDirty.current = true; setBankEdits((p) => ({ ...p, name: e.target.value })) }}
              placeholder="مثال: بنك الراجحي" />
          </div>
          <div>
            <label className="label">رقم الآيبان (IBAN)</label>
            <input className="field" value={bankEdits.iban}
              onChange={(e) => { bankEditsDirty.current = true; setBankEdits((p) => ({ ...p, iban: e.target.value })) }}
              placeholder="SA00 0000 0000 0000 0000 0000"
              style={{ direction: "ltr", textAlign: "left" }} />
          </div>
          <button className="btn btn-white" onClick={saveBankDetails} disabled={savingBank}>
            {savingBank ? <span className="spinner" /> : "حفظ"}
          </button>
        </div>

        {/* الأعضاء */}
        <div className="card space-y-3">
          <h2 className="section-title" style={{ marginBottom: 0 }}>الأعضاء</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.members.map((m) => (
              <div key={m.id} className="member-row" style={{ cursor: "default" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {m.name || "مقعد فارغ"} {m.is_organizer && "👑"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-3)" }}>
                    {halalasToRiyalText(m.amount_halalas)} ريال · {statusLabel(m.status)}
                  </span>
                  {issuedCodes[m.id] && (
                    <span className="text-xs" style={{ color: "var(--primary)" }}>
                      الرمز: {issuedCodes[m.id]} — أرسل هذا الرمز للمشارك بالخاص ليستعيد الوصول إلى
                      اسمه المسجّل من متصفح أو جهاز آخر (صالح 24 ساعة، لا يؤكد وصول المبلغ ولا يغيّر
                      حالة الدفع)
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, position: "relative" }}>
                  {m.status === "reported" && (
                    <button className="btn-ghost" style={{ height: 36, width: "auto", padding: "0 10px", fontSize: 12, borderRadius: 10 }}
                      onClick={() => confirmReceipt(m.id, true)} disabled={busyMemberId === m.id}>
                      تأكيد وصول المبلغ
                    </button>
                  )}
                  {m.status === "confirmed" && (
                    <button className="btn-ghost" style={{ height: 36, width: "auto", padding: "0 10px", fontSize: 12, borderRadius: 10 }}
                      onClick={() => confirmReceipt(m.id, false)} disabled={busyMemberId === m.id}>
                      تراجع
                    </button>
                  )}
                  {m.status === "empty" && !locked && (
                    <button className="btn-ghost" style={{ height: 36, width: "auto", padding: "0 10px", fontSize: 12, borderRadius: 10 }}
                      onClick={() => removeMember(m.id)} disabled={busyMemberId === m.id}>
                      إزالة
                    </button>
                  )}
                  {m.status !== "empty" && m.status !== "confirmed" && !m.is_organizer && (
                    <div style={{ position: "relative" }}>
                      <button
                        className="btn-ghost"
                        style={{ height: 36, width: 36, padding: 0, fontSize: 16, borderRadius: 10 }}
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId((prev) => (prev === m.id ? null : m.id)) }}
                        disabled={busyMemberId === m.id}
                        aria-label="خيارات إضافية"
                      >
                        ⋯
                      </button>
                      {openMenuId === m.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: "absolute", top: 40, left: 0, zIndex: 10, minWidth: 220,
                            background: "var(--bg-card)", border: "1px solid var(--border)",
                            borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: 6,
                          }}
                        >
                          <button
                            onClick={() => issueClaimCode(m.id)}
                            disabled={busyMemberId === m.id}
                            style={{
                              display: "block", width: "100%", textAlign: "start", background: "none",
                              border: "none", cursor: "pointer", padding: "8px 10px", fontSize: 13,
                              borderRadius: 8, color: "var(--text-1)",
                            }}
                          >
                            مساعدة المشارك على استرجاع مشاركته
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "4px -22px 0" }} />
          <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
            <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="تسجيل اسم شخص…" style={{ height: 44, fontSize: 14 }} />
            <button className="btn btn-white" onClick={addMember} disabled={addingMember || !newName.trim()}
              style={{ width: "auto", padding: "0 16px", height: 44, fontSize: 14 }}>
              {addingMember ? <span className="spinner" style={{ width: 16, height: 16 }} /> : "+ إضافة"}
            </button>
          </div>

          <div style={{ height: 1, background: "var(--border)", margin: "4px -22px 0" }} />
          <div style={{ paddingTop: 4 }}>
            <p className="label" style={{ marginBottom: 8 }}>زيادة عدد الأشخاص</p>
            {locked ? (
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                مقفلة — بدأ الإبلاغ عن التحويلات. أنشئي/أنشئ قطّة جديدة لتغيير العدد.
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input className="field" type="number" min={1} value={increaseDelta}
                  onChange={(e) => setIncreaseDelta(e.target.value)}
                  style={{ height: 44, width: 72, textAlign: "center" }} />
                <button className="btn btn-ghost" onClick={increaseCapacity} disabled={increasing}
                  style={{ flex: 1, height: 44, fontSize: 14 }}>
                  {increasing ? <span className="spinner" style={{ width: 16, height: 16 }} /> : "تأكيد الزيادة"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  )
}

function statusLabel(status: string) {
  switch (status) {
    case "empty": return "مقعد فارغ"
    case "joined": return "انضمّ — لم يُبلَّغ بعد"
    case "reported": return "أبلغ بالتحويل — بانتظار التأكيد"
    case "confirmed": return "تأكَّد الاستلام ✅"
    case "legacy_paid": return "سُجّل كمدفوع في الإصدار السابق"
    default: return status
  }
}
