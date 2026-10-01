"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, useCallback } from "react"
import { supabase } from "@/app/lib/supabase"
import { useToast } from "@/app/components/Toast"
import { PaymentProgress } from "@/app/components/PaymentProgress"
import { MemberList } from "@/app/components/MemberList"
import { Footer } from "@/app/components/Footer"
import { PageHeader } from "@/app/components/PageHeader"
import type { SplitV2 } from "@/app/lib/types"
import { halalasToRiyalText } from "@/app/lib/types"
import {
  getOrCreateParticipantToken, getMemberId, setMemberId, newClientRequestId,
} from "@/app/lib/clientSecrets"
import { usePolling } from "@/app/lib/usePolling"

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

type LoadState = "loading" | "ok" | "not_found" | "network_error"

export default function SplitPage() {
  const params = useParams()
  const id = params.id as string
  const { showToast } = useToast()

  const [data, setData] = useState<SplitV2 | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [now, setNow] = useState(() => Date.now())

  const [joinName, setJoinName] = useState("")
  const [joining, setJoining] = useState(false)
  const [reporting, setReporting] = useState(false)

  const [showClaim, setShowClaim] = useState(false)
  const [claimCode, setClaimCode] = useState("")
  const [claiming, setClaiming] = useState(false)

  const [stale, setStale] = useState(false)

  const myMemberId = getMemberId(id)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase.rpc("get_split", { p_split_id: id })
      if (error) { setLoadState("network_error"); return }
      if (!rows || rows.length === 0) { setLoadState("not_found"); return }
      setData(rows[0] as SplitV2)
      setLoadState("ok")
    } catch {
      setLoadState("network_error")
    }
  }, [id])

  useEffect(() => {
    let mounted = true
    const run = async () => { if (mounted) await load() }
    run()
    return () => { mounted = false }
  }, [load])

  // تحديث بصمت (بلا مؤشر تحميل كامل، بلا مسّ الحقول): فقط بعد نجاح التحميل
  // الأول. عند الفشل نُبقي آخر بيانات ناجحة كما هي ولا نستبدلها بأي شيء.
  const refresh = useCallback(async () => {
    if (loadState !== "ok") return
    const { data: rows, error } = await supabase.rpc("get_split", { p_split_id: id })
    if (error) throw error
    if (rows && rows.length > 0) setData(rows[0] as SplitV2)
  }, [id, loadState])

  usePolling(refresh, {
    intervalMs: 10000,
    onFirstError: () => { setStale(true); showToast("تعذّر تحديث البيانات — نعرض آخر نسخة معروفة", "info") },
    onRecovered: () => setStale(false),
  })

  const myMember = useMemo(
    () => data?.members.find((m) => m.id === myMemberId) ?? null,
    [data, myMemberId]
  )

  const paidCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.status === "confirmed" || m.status === "legacy_paid").length,
    [data]
  )
  const joinedCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.status !== "empty").length,
    [data]
  )
  const isFull = useMemo(() => !!data && data.members.every((m) => m.status !== "empty"), [data])

  const remainingText = useMemo(() => {
    if (!data) return ""
    return formatRemaining(new Date(data.event_at).getTime() - now)
  }, [data, now])

  const joinSplit = async () => {
    if (!data) return
    const name = joinName.trim()
    if (!name) { showToast("اكتبي/اكتب اسمك أولاً", "error"); return }

    setJoining(true)
    const token = getOrCreateParticipantToken(id)
    const { data: rows, error } = await supabase.rpc("join_split", {
      p_split_id: id,
      p_name: name,
      p_client_request_id: newClientRequestId(),
      p_participant_token: token,
    })
    if (error || !rows || rows.length === 0) {
      showToast(error?.message ?? "تعذّر الانضمام — قد تكون القطّة اكتملت", "error")
      setJoining(false)
      return
    }
    setMemberId(id, rows[0].member_id as string)
    showToast("انضممتِ للقطّة ✅", "success")
    await load()
    setJoining(false)
  }

  const reportTransfer = async () => {
    if (!myMember) return
    setReporting(true)
    const token = getOrCreateParticipantToken(id)
    const { error } = await supabase.rpc("report_transfer", { p_member_id: myMember.id, p_participant_token: token })
    if (error) { showToast("تعذّر الإبلاغ — تحقّقي من اتصالك", "error"); setReporting(false); return }
    showToast("تم الإبلاغ عن التحويل، بانتظار تأكيد المنظّم", "success")
    await load()
    setReporting(false)
  }

  const retractTransfer = async () => {
    if (!myMember) return
    setReporting(true)
    const token = getOrCreateParticipantToken(id)
    const { error } = await supabase.rpc("retract_report", { p_member_id: myMember.id, p_participant_token: token })
    if (error) { showToast("تعذّر التراجع", "error"); setReporting(false); return }
    showToast("تم التراجع عن الإبلاغ", "success")
    await load()
    setReporting(false)
  }

  const retrieveParticipation = async () => {
    if (!data) return
    const code = claimCode.trim()
    if (!code) { showToast("اكتبي/اكتب رمز استرجاع المشاركة", "error"); return }

    setClaiming(true)
    const token = getOrCreateParticipantToken(id)
    const { data: rows, error } = await supabase.rpc("claim_seat_by_code", {
      p_split_id: id, p_code: code, p_participant_token: token,
    })
    const result = rows?.[0]
    if (error || !result?.success) {
      showToast(result?.error_code === "too_many_attempts"
        ? "محاولات كثيرة — اطلبي من المنظّم رمزًا جديدًا"
        : "الرمز غير صحيح أو منتهٍ", "error")
      setClaiming(false)
      return
    }
    setMemberId(id, result.member_id as string)
    showToast("تم استرجاع مشاركتك ✅", "success")
    setShowClaim(false)
    setClaimCode("")
    await load()
    setClaiming(false)
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/s/${id}` : `/s/${id}`
  const buildShareText = () => {
    if (!data) return ""
    return [
      `هذا رابط القَطّة 👇`, ``,
      `المناسبة: ${data.title}`,
      `المنظّم: ${data.organizer_name}`,
      `المبلغ الإجمالي: ${halalasToRiyalText(data.total_halalas)} ريال`,
      `حصة الشخص: ${halalasToRiyalText(data.total_halalas / data.people)} ريال`,
      `موعد اللقاء: ${formatArabicDate(data.event_at)}`,
      ...(data.iban ? [``, `رقم الآيبان: ${data.iban}`] : []),
      ``, `انضمّي/انضمّ من الرابط، وبعد التحويل اضغطي/اضغط "حوّلت حصتي"`, shareUrl,
    ].join("\n")
  }
  const handleCopy = () => { navigator.clipboard.writeText(buildShareText()); showToast("تم نسخ رسالة المشاركة", "success") }
  const handleWhatsApp = async () => {
    const text = buildShareText()
    if (navigator.share) { try { await navigator.share({ title: `قَطّة: ${data?.title}`, text }); return } catch { /* fallthrough */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank")
  }

  if (loadState === "loading") {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="spinner" style={{ width: 26, height: 26, borderColor: "var(--border)", borderTopColor: "var(--primary)" }} />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>جاري التحميل…</span>
        </div>
      </main>
    )
  }

  if (loadState === "network_error") {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <p className="font-semibold">تعذّر الاتصال</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>تحقّقي من الإنترنت وأعيدي المحاولة.</p>
          <button className="btn btn-ghost" onClick={() => { setLoadState("loading"); load() }}
            style={{ width: "auto", display: "inline-flex", padding: "0 24px" }}>
            إعادة المحاولة
          </button>
        </div>
      </main>
    )
  }

  if (loadState === "not_found" || !data) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-8 text-center">
        <div className="space-y-3 max-w-xs">
          <div className="text-4xl">🔗</div>
          <p className="font-semibold">الرابط غير متاح</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>تأكّدي/تأكّد من صحة الرابط أو أنشئي/أنشئ رابطاً جديداً</p>
          <a href="/create" className="btn btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "0 24px" }}>
            إنشاء رابط جديد
          </a>
        </div>
      </main>
    )
  }

  const shareHalalas = data.total_halalas / data.people

  return (
    <main className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-md space-y-4">
        <PageHeader />

        {stale && (
          <div className="rounded-2xl p-2.5 text-xs text-center" style={{ background: "var(--toast-info-bg)", border: "1px solid var(--toast-info-border)", color: "var(--toast-info-text)" }}>
            تعذّر آخر تحديث — تُعرض آخر بيانات معروفة، نحاول مجددًا تلقائيًا
          </div>
        )}

        {data.is_legacy && (
          <div className="rounded-2xl p-3 text-sm text-center" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
            هذه قطّة من إصدار سابق — للعرض فقط. لا يمكن الانضمام أو الإبلاغ عن تحويل جديد هنا.
            <div className="pt-2">
              <a href="/create" className="btn btn-ghost" style={{ height: 40, width: "auto", display: "inline-flex", padding: "0 20px", fontSize: 13 }}>
                إنشاء قطّة جديدة
              </a>
            </div>
          </div>
        )}

        <header className="text-center space-y-1 pb-1">
          <h1 className="text-2xl font-bold" style={{ wordBreak: "break-word" }}>{data.title}</h1>
          {data.organizer_name && (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>المنظّم: {data.organizer_name}</p>
          )}
        </header>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--text-2)" }}>المبلغ الإجمالي</span>
            <span className="font-bold">{halalasToRiyalText(data.total_halalas)} ريال</span>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div style={{ minWidth: 0 }}>
              <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>حصة الشخص</p>
              <div className="font-black leading-none" style={{ fontSize: 36 }}>
                <span style={{ color: "var(--primary)" }}>{halalasToRiyalText(shareHalalas)}</span>
                <span className="text-lg font-normal mr-1" style={{ color: "var(--text-2)" }}>ريال</span>
              </div>
            </div>
            <div style={{ textAlign: "left", flexShrink: 0, maxWidth: "55%", minWidth: 0 }}>
              <p className="text-xs mb-1" style={{ color: "var(--text-2)" }}>الموعد</p>
              <p className="font-semibold text-sm leading-snug" style={{ wordBreak: "break-word" }}>{formatArabicDate(data.event_at)}</p>
              {remainingText && <p className="text-xs" style={{ color: "var(--text-3)" }}>{remainingText}</p>}
            </div>
          </div>
          <PaymentProgress paidCount={paidCount} joinedCount={joinedCount} totalPeople={data.people} isFull={isFull} />
        </div>

        {/* بيانات التحويل — عرض فقط، التعديل حصرًا من لوحة إدارة المنظّم */}
        <div className="card space-y-3">
          <h2 className="section-title" style={{ marginBottom: 0 }}>التحويل إلى حساب المنظّم</h2>
          {data.iban ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.bank_name && (
                <div><p className="label">البنك</p><p style={{ fontSize: 15, fontWeight: 500 }}>{data.bank_name}</p></div>
              )}
              <div>
                <p className="label">رقم الآيبان</p>
                <p style={{ fontSize: 14, fontWeight: 600, direction: "ltr", textAlign: "left", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {data.iban}
                </p>
              </div>
              <button className="btn btn-ghost" style={{ height: 48, fontSize: 14 }}
                onClick={() => { navigator.clipboard.writeText(data.iban ?? ""); showToast("تم نسخ رقم الحساب", "success") }}>
                نسخ رقم الحساب
              </button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>
              لم يُضف المنظّم بيانات التحويل بعد. تواصلي معه مباشرة لمعرفة كيفية التحويل.
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
            التحويل يتم مباشرة لحساب المنظّم ولا يمر عبر الموقع — والموقع لا يتحقق فعليًا من وصوله.
          </p>
        </div>

        {!data.is_legacy && (
          <div className="space-y-2">
            <button className="btn btn-white" onClick={handleWhatsApp}>مشاركة عبر واتساب</button>
            <button className="btn btn-ghost" onClick={handleCopy}>نسخ رسالة المشاركة</button>
          </div>
        )}

        {!data.is_legacy && (
          <div className="card space-y-3">
            {myMember ? (
              <>
                <h2 className="section-title" style={{ marginBottom: 0 }}>مقعدك: {myMember.name}</h2>
                {myMember.status === "joined" && (
                  <button className="btn btn-white" onClick={reportTransfer} disabled={reporting}>
                    {reporting ? <span className="spinner" /> : "حوّلت حصتي"}
                  </button>
                )}
                {myMember.status === "reported" && (
                  <>
                    <p className="text-sm" style={{ color: "var(--text-2)" }}>بانتظار تأكيد المنظّم للاستلام.</p>
                    <button className="btn btn-ghost" onClick={retractTransfer} disabled={reporting}>
                      {reporting ? <span className="spinner" style={{ borderColor: "var(--border)", borderTopColor: "var(--text-1)" }} /> : "تراجع عن الإبلاغ"}
                    </button>
                  </>
                )}
                {myMember.status === "confirmed" && (
                  <p className="text-sm" style={{ color: "var(--success)" }}>✅ أكّد المنظّم استلام حصتك.</p>
                )}
              </>
            ) : (
              <>
                <h2 className="section-title" style={{ marginBottom: 0 }}>الانضمام للقطّة</h2>
                <div className="flex gap-2">
                  <input className="field" value={joinName} onChange={(e) => setJoinName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && joinSplit()} placeholder="اسمك هنا" />
                  <button className="btn btn-white" onClick={joinSplit} disabled={!joinName.trim() || joining}
                    style={{ width: "auto", padding: "0 20px", flexShrink: 0 }}>
                    {joining ? <span className="spinner" /> : "انضمام"}
                  </button>
                </div>
                <button
                  onClick={() => setShowClaim((v) => !v)}
                  className="text-xs"
                  style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", textAlign: "start", padding: 0, textDecoration: "underline" }}
                >
                  سبق انضممت؟
                </button>
                {showClaim && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <label className="label">رمز استرجاع المشاركة</label>
                      <input className="field" value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && retrieveParticipation()}
                        placeholder="الرمز الذي أرسله المنظّم" style={{ height: 44, fontSize: 14, direction: "ltr", textAlign: "center" }} />
                    </div>
                    <button className="btn btn-ghost" onClick={retrieveParticipation} disabled={claiming} style={{ height: 44, fontSize: 14 }}>
                      {claiming ? <span className="spinner" style={{ width: 16, height: 16 }} /> : "استرجاع مشاركتي"}
                    </button>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>
                      الاسترجاع لا يؤكد وصول المبلغ ولا يغيّر حالة الدفع أو العدد — فقط يعيد ربط اسمك المسجّل بهذا الجهاز.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="card space-y-3">
          <h2 className="section-title" style={{ marginBottom: 0 }}>المجموعة</h2>
          <MemberList members={data.members} myMemberId={myMemberId} />
        </div>

        <a href="/create" className="block text-center text-sm" style={{ color: "var(--text-3)", textDecoration: "none" }}>
          إنشاء رابط جديد
        </a>
      </div>
      <Footer />
    </main>
  )
}
