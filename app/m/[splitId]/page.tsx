"use client"

import { useParams } from "next/navigation"
import { useEffect, useState, useCallback, useRef } from "react"
import { useToast } from "@/app/components/Toast"
import { Footer } from "@/app/components/Footer"
import type { MemberV2, SplitV2 } from "@/app/lib/types"
import { halalasToRiyalText } from "@/app/lib/types"
import { formatEventDate, formatTime } from "@/app/lib/format"
import { buildShareText } from "@/app/lib/share"
import { usePolling } from "@/app/lib/usePolling"
import { errorMessageAr } from "@/app/lib/errorMessages"
import { isOrganizerDevice, markOrganizerDevice } from "@/app/lib/clientSecrets"
import { MAX_PEOPLE, MAX_NAME_LENGTH, MAX_BANK_NAME_LENGTH } from "@/app/lib/validation"

const CSRF_HEADER = "x-csrf-token"
// كل طلب إدارة يسمّي قطّته؛ الخادم يرفض جلسة أي قطّة أخرى (app/lib/manageSession.ts)
const SPLIT_HEADER = "x-gatta-split"

type Phase = "loading" | "ok" | "locked" | "error"
// no_session: لا جلسة ولا رابط · invalid_link: رابط/توكن مرفوض · expired: جلسة كانت فعّالة وانتهت
type LockReason = "no_session" | "invalid_link" | "expired"

export default function ManagePage() {
  const params = useParams()
  const splitId = params.splitId as string
  const { showToast } = useToast()

  const [data, setData] = useState<SplitV2 | null>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>("loading")
  const [lockReason, setLockReason] = useState<LockReason>("no_session")
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  // رابط الإدارة الكامل يبقى في ذاكرة الصفحة فقط (لا شريط العنوان، لا
  // localStorage): متاح للنسخ في الزيارة التي وصل فيها التوكن أو بعد إصدار
  // رابط جديد، ويزول بإعادة التحميل.
  const [manageLink, setManageLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showLinkField, setShowLinkField] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [rotating, setRotating] = useState(false)

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
  const started = useRef(false)

  // الجلسة لم تعد صالحة: نُخرج المنظّم من اللوحة إلى شاشة الاسترجاع ونمسح كل
  // ما في الذاكرة — وبذلك يتوقف التحديث الدوري عن إرسال أي طلب.
  const lock = useCallback((reason: LockReason) => {
    setCsrfToken(null)
    setManageLink(null)
    setStale(false)
    setLockReason(reason)
    setPhase("locked")
  }, [])

  const loadView = useCallback(async (withCsrf?: string, onUnauthorized: LockReason = "expired") => {
    const res = await fetch("/api/manage/view", {
      headers: withCsrf ? { [SPLIT_HEADER]: splitId, [CSRF_HEADER]: withCsrf } : { [SPLIT_HEADER]: splitId },
    })
    if (res.status === 401) {
      lock(onUnauthorized)
      return
    }
    if (!res.ok) throw new Error("view_failed")
    const json = await res.json()
    setData(json.data)
    if (!bankEditsDirty.current) {
      setBankEdits({ name: json.data.bank_name ?? "", iban: json.data.iban ?? "" })
    }
    if (json.csrfToken) setCsrfToken(json.csrfToken)
    else if (withCsrf) setCsrfToken(withCsrf)
    setExpiresAt(json.expiresAt ?? null)
    markOrganizerDevice(splitId)
    setPhase("ok")
  }, [lock, splitId])

  const manageFetch = useCallback(
    async (path: string, body: unknown) => {
      if (!csrfToken) throw new Error("unauthorized")
      const res = await fetch(`/api/manage/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SPLIT_HEADER]: splitId, [CSRF_HEADER]: csrfToken },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        lock("expired")
        throw new Error("unauthorized")
      }
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? "server_error")
      return json
    },
    [csrfToken, lock, splitId]
  )

  // فشل إجراء: رسالة عربية واضحة. انتهاء الجلسة لا يحتاج رسالة — الشاشة نفسها تتبدّل.
  const fail = useCallback((e: unknown, fallback: string) => {
    const raw = e instanceof Error ? e.message : ""
    if (raw === "unauthorized") return
    showToast(errorMessageAr(raw, fallback), "error")
  }, [showToast])

  // تبادل توكن الإدارة بجلسة httpOnly ثم تحميل اللوحة
  const establish = useCallback(async (token: string) => {
    setPhase("loading")
    try {
      const res = await fetch("/api/manage/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitId, manageToken: token }),
      })
      if (res.status === 400 || res.status === 401) {
        lock("invalid_link")
        return
      }
      if (!res.ok) throw new Error("session_failed")
      const json = await res.json()
      setManageLink(`${window.location.origin}/m/${splitId}#${token}`)
      setLinkCopied(false)
      setShowLinkField(false)
      await loadView(json.csrfToken)
    } catch {
      setPhase("error")
    }
  }, [splitId, loadView, lock])

  // بلا توكن: استئناف من الكوكي إن وُجدت. إن سبق لهذا المتصفح فتح اللوحة
  // فالجلسة "انتهت"؛ وإلا فهو زائر بلا رابط إدارة أصلًا.
  const resume = useCallback(async () => {
    setPhase("loading")
    try {
      await loadView(undefined, isOrganizerDevice(splitId) ? "expired" : "no_session")
    } catch {
      setPhase("error")
    }
  }, [splitId, loadView])

  // تحديث دوري بصمت — فقط واللوحة مفتوحة فعلًا. عطل عابر: تُبقي آخر بيانات
  // ناجحة + تنبيه خفيف. انتهاء الجلسة (401): شاشة الاسترجاع، بلا إعادة محاولة.
  const refreshView = useCallback(async () => {
    if (phase !== "ok" || !csrfToken) return
    const res = await fetch("/api/manage/view", { headers: { [SPLIT_HEADER]: splitId, [CSRF_HEADER]: csrfToken } })
    if (res.status === 401) {
      lock("expired")
      return
    }
    if (!res.ok) throw new Error("refresh_failed")
    const json = await res.json()
    setData(json.data)
    if (!bankEditsDirty.current) {
      setBankEdits({ name: json.data.bank_name ?? "", iban: json.data.iban ?? "" })
    }
  }, [phase, csrfToken, lock, splitId])

  usePolling(refreshView, {
    intervalMs: 10000,
    onFirstError: () => { setStale(true); showToast("تعذّر تحديث البيانات — نعرض آخر نسخة معروفة", "info") },
    onRecovered: () => setStale(false),
  })

  useEffect(() => {
    // يلتقط توكن الإدارة من fragment الرابط ويمسحه فورًا من شريط العنوان، حتى
    // لا يبقى في تاريخ المتصفح أو يُقرَأ عبر location.href من أي سكربت لاحق
    // (كالتحليلات). يعمل عند التحميل، وأيضًا عند لصق رابط الإدارة في نفس
    // التبويب (تغيّر الـfragment وحده لا يعيد تحميل الصفحة).
    const takeToken = () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : ""
      if (hash) window.history.replaceState(null, "", window.location.pathname)
      return hash
    }
    const onHashChange = () => {
      const token = takeToken()
      if (token) establish(token)
    }

    if (!started.current) {
      started.current = true
      const token = takeToken()
      if (token) establish(token)
      else resume()
    }

    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [establish, resume])

  useEffect(() => {
    if (!openMenuId) return
    const closeMenu = () => setOpenMenuId(null)
    document.addEventListener("click", closeMenu)
    return () => document.removeEventListener("click", closeMenu)
  }, [openMenuId])

  const copyManageLink = async () => {
    if (!manageLink) return
    try {
      await navigator.clipboard.writeText(manageLink)
      setLinkCopied(true)
      showToast("تم نسخ رابط الإدارة", "success")
    } catch {
      // النسخ التلقائي غير متاح على هذا المتصفح: نعرض الرابط للنسخ اليدوي
      setShowLinkField(true)
    }
  }

  const rotateLink = async () => {
    setRotating(true)
    try {
      const json = await manageFetch("rotate-link", {})
      setManageLink(`${window.location.origin}/m/${splitId}#${json.manageToken}`)
      setLinkCopied(false)
      setShowLinkField(false)
      setConfirmRotate(false)
      showToast("صدر رابط إدارة جديد — احفظه الآن", "success")
    } catch (e) {
      fail(e, "تعذّر إصدار رابط جديد — أعيدي/أعد المحاولة")
    }
    setRotating(false)
  }

  const saveBankDetails = async () => {
    setSavingBank(true)
    try {
      await manageFetch("bank-details", { bankName: bankEdits.name, iban: bankEdits.iban })
      showToast("تم حفظ بيانات التحويل ✅", "success")
      bankEditsDirty.current = false // الآن تطابق الخادم؛ يمكن للتحديث الدوري مزامنتها بأمان
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      fail(e, "تعذّر الحفظ — تحقّقي/تحقّق من اتصالك")
    }
    setSavingBank(false)
  }

  const confirmReceipt = async (memberId: string, confirm: boolean) => {
    setBusyMemberId(memberId)
    try {
      await manageFetch("confirm-receipt", { memberId, confirm })
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      fail(e, "تعذّر التحديث — تحقّقي/تحقّق من اتصالك")
    }
    setBusyMemberId(null)
  }

  // حصة المنظّم نفسه: لا تحويل يُنتظر ولا إبلاغ، يسجّلها المنظّم مباشرة
  const setOrganizerPaid = async (memberId: string, paid: boolean) => {
    setBusyMemberId(memberId)
    try {
      await manageFetch("organizer-paid", { paid })
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      fail(e, "تعذّر التحديث — تحقّقي/تحقّق من اتصالك")
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
      fail(e, "تعذّرت الإضافة — تحقّقي/تحقّق من اتصالك")
    }
    setAddingMember(false)
  }

  const removeMember = async (memberId: string) => {
    setBusyMemberId(memberId)
    try {
      await manageFetch("remove-member", { memberId })
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      fail(e, "تعذّرت الإزالة — تحقّقي/تحقّق من اتصالك")
    }
    setBusyMemberId(null)
  }

  const increaseCapacity = async () => {
    const delta = Number(increaseDelta)
    if (!Number.isInteger(delta) || delta < 1) { showToast(errorMessageAr("invalid_delta", ""), "error"); return }
    if (data && data.people + delta > MAX_PEOPLE) { showToast(errorMessageAr("max_capacity_exceeded", ""), "error"); return }
    setIncreasing(true)
    try {
      await manageFetch("increase-capacity", { delta })
      showToast("تم تحديث العدد", "success")
      await loadView(csrfToken ?? undefined)
    } catch (e) {
      fail(e, "تعذّرت الزيادة — تحقّقي/تحقّق من اتصالك")
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
      fail(e, "تعذّر إصدار الرمز — تحقّقي/تحقّق من اتصالك")
    }
    setBusyMemberId(null)
  }

  if (phase === "loading") {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <span className="spinner spinner-light" style={{ width: 26, height: 26, borderTopColor: "var(--primary)", borderColor: "var(--border)" }} />
      </main>
    )
  }

  if (phase === "error") {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <p className="font-semibold">تعذّر الاتصال</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>تحقّقي/تحقّق من الإنترنت وأعيدي/أعد المحاولة.</p>
          <button className="btn btn-ghost" onClick={resume}
            style={{ width: "auto", display: "inline-flex", padding: "0 24px" }}>
            إعادة المحاولة
          </button>
        </div>
      </main>
    )
  }

  if (phase === "locked" || !data) {
    return <ManageLocked reason={lockReason} splitId={splitId} onToken={establish} />
  }

  const locked = !!data.reporting_started_at
  const paidCount = data.members.filter((m) => m.status === "confirmed").length
  const complete = data.members.length > 0 && paidCount === data.members.length
  // 44px: الحد الأدنى المريح لهدف اللمس على الجوال
  const smallBtn = { height: 44, width: "auto", padding: "0 14px", fontSize: 13, borderRadius: 12 } as const

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-md space-y-4">
        {/* رابط الإدارة: حفظه (أول زيارة / بعد الإصدار) أو استرجاعه بإصدار رابط جديد */}
        {manageLink ? (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={linkCopied
              ? { background: "var(--success-soft-bg)", border: "1px solid var(--success-soft-border)" }
              : { background: "var(--toast-error-bg)", border: "1px solid var(--toast-error-border)" }}
          >
            <h2 className="font-semibold" style={{ fontSize: 15, color: linkCopied ? "var(--text-1)" : "var(--toast-error-text)" }}>
              {linkCopied ? "✅ تم نسخ رابط الإدارة" : "🔑 احفظ رابط الإدارة أولًا"}
            </h2>
            <p className="text-sm" style={{ color: linkCopied ? "var(--text-2)" : "var(--toast-error-text)", lineHeight: 1.7 }}>
              {linkCopied
                ? "الصقه الآن في الملاحظات أو أرسله لنفسك. لا تشاركه مع أحد — من يملكه يدير القطّة."
                : "هذا الرابط مفتاحك لفتح اللوحة من جهاز آخر، أو بعد انتهاء الجلسة (8 ساعات). لا تشاركه مع أحد — من يملكه يدير القطّة."}
            </p>
            <button className="btn btn-white" onClick={copyManageLink} style={{ height: 48, fontSize: 14 }}>
              {linkCopied ? "نسخ رابط الإدارة مرة أخرى" : "نسخ رابط الإدارة"}
            </button>
            {showLinkField && (
              <div>
                <label className="label">تعذّر النسخ التلقائي — انسخ الرابط يدويًا:</label>
                <input className="field" readOnly value={manageLink} onFocus={(e) => e.target.select()}
                  style={{ height: 44, fontSize: 12, direction: "ltr", textAlign: "left" }} />
              </div>
            )}
          </div>
        ) : (
          <div className="card space-y-3">
            <h2 className="section-title" style={{ marginBottom: 0 }}>رابط الإدارة</h2>
            <p className="text-sm" style={{ color: "var(--text-2)", lineHeight: 1.7 }}>
              لحمايتك لا يُعرض رابط الإدارة بعد فتحه.
              {expiresAt && ` جلسة هذا المتصفح مستمرة حتى ${formatTime(expiresAt)}، وبعدها يلزم الرابط لفتح اللوحة.`}
            </p>
            {confirmRotate ? (
              <>
                <p className="text-sm" style={{ color: "var(--toast-error-text)", lineHeight: 1.7 }}>
                  سيتوقف الرابط القديم عن العمل فورًا، وتُغلق أي لوحة إدارة مفتوحة على أجهزة أخرى.
                </p>
                <div className="flex gap-2">
                  <button className="btn btn-white" onClick={rotateLink} disabled={rotating} style={{ height: 48, fontSize: 14 }}>
                    {rotating ? <span className="spinner" style={{ width: 16, height: 16 }} /> : "تأكيد إصدار رابط جديد"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}
                    style={{ height: 48, fontSize: 14, width: "auto", flexShrink: 0 }}>
                    إلغاء
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmRotate(true)} style={{ height: 48, fontSize: 14 }}>
                لم أحفظ الرابط — إصدار رابط إدارة جديد
              </button>
            )}
          </div>
        )}

        <div className="card space-y-2">
          <h2 className="section-title" style={{ marginBottom: 0 }}>رابط المشاركة</h2>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            هذا هو الرابط الذي يُرسل للمشاركين — لا ترسل لهم رابط الإدارة.
          </p>
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
            <span className="font-semibold text-sm">{formatEventDate(data.event_at)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text-2)" }}>تم الدفع</span>
            <span className="font-bold" style={{ color: complete ? "var(--success)" : undefined }}>
              {complete ? `اكتمل الدفع ✅ ${paidCount} من ${data.people}` : `${paidCount} من ${data.people}`}
            </span>
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
            <input className="field" value={bankEdits.name} maxLength={MAX_BANK_NAME_LENGTH}
              onChange={(e) => { bankEditsDirty.current = true; setBankEdits((p) => ({ ...p, name: e.target.value })) }}
              placeholder="مثال: بنك الراجحي" />
          </div>
          <div>
            <label className="label">رقم الآيبان (IBAN)</label>
            <input className="field" value={bankEdits.iban} maxLength={42}
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
              <div key={m.id} className="member-row" style={{ cursor: "default", flexWrap: "wrap", padding: "8px 14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 150px", minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {m.name || "مقعد فارغ"} {m.is_organizer && "👑"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-3)" }}>
                    {halalasToRiyalText(m.amount_halalas)} ريال · {statusLabel(m)}
                  </span>
                  {issuedCodes[m.id] && (
                    <span className="text-xs" style={{ color: "var(--primary)" }}>
                      الرمز: {issuedCodes[m.id]} — أرسل هذا الرمز للمشارك بالخاص ليستعيد الوصول إلى
                      اسمه المسجّل من متصفح أو جهاز آخر (صالح 24 ساعة، لا يؤكد وصول المبلغ ولا يغيّر
                      حالة الدفع)
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0, position: "relative", marginInlineStart: "auto" }}>
                  {m.is_organizer && m.status !== "confirmed" && m.status !== "empty" && (
                    <button className="btn-ghost" style={smallBtn}
                      onClick={() => setOrganizerPaid(m.id, true)} disabled={busyMemberId === m.id}>
                      دفعتُ حصتي
                    </button>
                  )}
                  {m.is_organizer && m.status === "confirmed" && (
                    <button className="btn-ghost" style={smallBtn}
                      onClick={() => setOrganizerPaid(m.id, false)} disabled={busyMemberId === m.id}>
                      تراجع
                    </button>
                  )}
                  {!m.is_organizer && m.status === "reported" && (
                    <button className="btn-ghost" style={smallBtn}
                      onClick={() => confirmReceipt(m.id, true)} disabled={busyMemberId === m.id}>
                      تأكيد الاستلام
                    </button>
                  )}
                  {!m.is_organizer && m.status === "confirmed" && (
                    <button className="btn-ghost" style={smallBtn}
                      onClick={() => confirmReceipt(m.id, false)} disabled={busyMemberId === m.id}>
                      تراجع
                    </button>
                  )}
                  {m.status === "empty" && !locked && data.people > 1 && (
                    <button className="btn-ghost" style={smallBtn}
                      onClick={() => removeMember(m.id)} disabled={busyMemberId === m.id}>
                      إزالة
                    </button>
                  )}
                  {m.status !== "empty" && m.status !== "confirmed" && !m.is_organizer && (
                    <div style={{ position: "relative" }}>
                      <button
                        className="btn-ghost"
                        style={{ height: 44, width: 44, padding: 0, fontSize: 18, borderRadius: 12 }}
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
                            position: "absolute", top: 48, left: 0, zIndex: 10, minWidth: 220,
                            background: "var(--bg-card)", border: "1px solid var(--border)",
                            borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", padding: 6,
                          }}
                        >
                          <button
                            onClick={() => issueClaimCode(m.id)}
                            disabled={busyMemberId === m.id}
                            style={{
                              display: "block", width: "100%", textAlign: "start", background: "none",
                              border: "none", cursor: "pointer", padding: "0 10px", minHeight: 44, fontSize: 13,
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
              maxLength={MAX_NAME_LENGTH}
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
            ) : data.people >= MAX_PEOPLE ? (
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                وصلت القطّة للحد الأقصى ({MAX_PEOPLE} شخص).
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input className="field" type="number" min={1} max={MAX_PEOPLE - data.people} value={increaseDelta}
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

const LOCK_TEXT: Record<LockReason, { title: string; body: string }> = {
  expired: {
    title: "انتهت جلسة الإدارة",
    body: "تنتهي الجلسة تلقائيًا بعد 8 ساعات لحمايتك. يلزم رابط الإدارة المحفوظ لفتح اللوحة من جديد.",
  },
  no_session: {
    title: "لوحة الإدارة تحتاج رابط الإدارة",
    body: "هذه الصفحة خاصة بمنظّم القطّة، ويلزم لفتحها رابط الإدارة المحفوظ عند إنشاء القطّة.",
  },
  invalid_link: {
    title: "رابط الإدارة غير صحيح",
    body: "قد يكون الرابط ناقصًا، أو صدر بعده رابط أحدث فتوقّف عن العمل. يلزم أحدث رابط إدارة محفوظ.",
  },
}

// شاشة الاسترجاع: لا لوحة ولا تحديث دوري — فقط حقل للصق رابط الإدارة المحفوظ.
function ManageLocked({ reason, splitId, onToken }: {
  reason: LockReason
  splitId: string
  onToken: (token: string) => void
}) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const text = LOCK_TEXT[reason]

  const submit = () => {
    const raw = value.trim()
    const token = raw.includes("#") ? raw.slice(raw.lastIndexOf("#") + 1) : raw
    const linkedId = raw.match(/\/m\/([^#/?\s]+)/)?.[1]
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setError("هذا ليس رابط إدارة كاملًا — يلزم الرابط كما حُفظ، بما فيه الجزء بعد علامة #")
      return
    }
    setError("")
    // رابط إدارة لقطّة أخرى: نفتح لوحتها هي
    if (linkedId && linkedId !== splitId) {
      window.location.href = `/m/${linkedId}#${token}`
      return
    }
    onToken(token)
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8">
      <div className="card space-y-3 w-full max-w-md">
        <h1 className="font-semibold text-lg">{text.title}</h1>
        <p className="text-sm" style={{ color: "var(--text-2)", lineHeight: 1.7 }}>{text.body}</p>
        <div>
          <label className="label">رابط الإدارة</label>
          <input className="field" value={value} onChange={(e) => { setValue(e.target.value); setError("") }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder="الصق رابط الإدارة هنا" style={{ fontSize: 14 }} />
          {error && <p className="text-xs mt-1.5" style={{ color: "var(--toast-error-text)" }}>{error}</p>}
        </div>
        <button className="btn btn-white" onClick={submit} disabled={!value.trim()}>فتح لوحة الإدارة</button>
        <p className="text-xs" style={{ color: "var(--text-3)", lineHeight: 1.7 }}>
          إن لم يكن الرابط محفوظًا فلا يمكن استرجاعه من هنا. تبقى متابعة القطّة ممكنة من صفحة المشاركة.
        </p>
        <a href={`/s/${splitId}`} className="btn btn-ghost" style={{ height: 48, fontSize: 14 }}>فتح صفحة المشاركة</a>
      </div>
    </main>
  )
}

function statusLabel(m: MemberV2) {
  if (m.is_organizer) {
    if (m.status === "confirmed") return "حصتك مدفوعة ✅"
    if (m.status === "joined") return "حصتك — لم تُسجَّل كمدفوعة بعد"
  }
  switch (m.status) {
    case "empty": return "مقعد فارغ"
    case "joined": return "انضمّ — لم يُبلَّغ بعد"
    case "reported": return "أبلغ بالتحويل — بانتظار تأكيدك"
    case "confirmed": return "تم الاستلام ✅"
    case "legacy_paid": return "سُجّل كمدفوع في الإصدار السابق"
    default: return m.status
  }
}
