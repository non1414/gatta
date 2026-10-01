"use client"

import { useEffect, useRef, useCallback } from "react"

type Options = {
  /** الفاصل الأساسي بالمللي ثانية بين التحديثات أثناء ظهور الصفحة */
  intervalMs?: number
  /** يُستدعى عند نجاح أول تحديث بعد فشل سابق (لإخفاء أي تنبيه) */
  onRecovered?: () => void
  /** يُستدعى عند أول فشل بعد نجاح (لإظهار تنبيه بسيط مرة واحدة، لا تكرارًا) */
  onFirstError?: (err: unknown) => void
  /** الحد الأقصى لمضاعف التباطؤ بعد فشل متكرر (لا نُغرق الشبكة بمحاولات) */
  maxBackoffMultiplier?: number
}

/**
 * تحديث دوري "بصمت" (بلا مؤشر تحميل كامل، بلا مسح الحقول): كل intervalMs
 * أثناء ظهور الصفحة فقط، فورًا عند العودة للظهور، متوقّف عند الإخفاء أو
 * المغادرة، ولا يسمح بتداخل طلبين (الطلب التالي يُجدوَل فقط بعد اكتمال
 * السابق). عند الفشل: يتباطأ تدريجيًا بدل الإصرار كل 10 ثوانٍ.
 */
export function usePolling(fetchFn: () => Promise<void>, options: Options = {}) {
  const { intervalMs = 10000, onRecovered, onFirstError, maxBackoffMultiplier = 6 } = options

  const inFlight = useRef(false)
  const failureCount = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // نُحدَّث كل هذه عند كل تصيير حتى لا تلتقط الحلقة الدورية (المُجدولة مرة
  // واحدة عند التركيب) نُسخًا قديمة من الدوال أو الإعدادات.
  const fetchRef = useRef(fetchFn)
  fetchRef.current = fetchFn
  const onRecoveredRef = useRef(onRecovered)
  onRecoveredRef.current = onRecovered
  const onFirstErrorRef = useRef(onFirstError)
  onFirstErrorRef.current = onFirstError
  const intervalRef = useRef(intervalMs)
  intervalRef.current = intervalMs
  const maxBackoffRef = useRef(maxBackoffMultiplier)
  maxBackoffRef.current = maxBackoffMultiplier

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const runOnce = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return
    inFlight.current = true
    try {
      await fetchRef.current()
      if (!mountedRef.current) return
      if (failureCount.current > 0) onRecoveredRef.current?.()
      failureCount.current = 0
    } catch (err) {
      if (!mountedRef.current) return
      failureCount.current += 1
      if (failureCount.current === 1) onFirstErrorRef.current?.(err)
    } finally {
      inFlight.current = false
    }
  }, [])

  const scheduleNext = useCallback(() => {
    clearTimer()
    if (document.visibilityState !== "visible") return
    const backoff = Math.min(1 + failureCount.current, maxBackoffRef.current)
    timerRef.current = setTimeout(async () => {
      await runOnce()
      scheduleNext()
    }, intervalRef.current * backoff)
  }, [clearTimer, runOnce])

  useEffect(() => {
    mountedRef.current = true

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        runOnce().then(scheduleNext) // تحديث فوري عند الرجوع، ثم استئناف الدورة
      } else {
        clearTimer()
      }
    }

    if (document.visibilityState === "visible") scheduleNext()
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      mountedRef.current = false
      document.removeEventListener("visibilitychange", onVisibility)
      clearTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
