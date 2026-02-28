"use client"

import { useEffect, useState, createContext, useContext, useCallback } from "react"

type ToastType = "success" | "error" | "info"

type Toast = {
  id: string
  message: string
  type: ToastType
}

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error("useToast must be used within ToastProvider")
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "1rem",
          left: "1rem",
          right: "1rem",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const toastStyles: Record<ToastType, { bg: string; border: string }> = {
  success: { bg: "#14532d", border: "rgba(74,222,128,0.2)" },
  error:   { bg: "#7f1d1d", border: "rgba(248,113,113,0.2)" },
  info:    { bg: "#1c1c1c", border: "rgba(255,255,255,0.08)" },
}

const toastIcon: Record<ToastType, string> = {
  success: "✅",
  error:   "❌",
  info:    "ℹ️",
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500)
    return () => clearTimeout(timer)
  }, [onClose])

  const { bg, border } = toastStyles[toast.type]

  return (
    <div
      className="animate-slide-up"
      role="alert"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "14px",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        color: "#f2f2f2",
        fontSize: "14px",
        direction: "rtl",
      }}
    >
      <span style={{ flexShrink: 0 }}>{toastIcon[toast.type]}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          color: "rgba(242,242,242,0.5)",
          cursor: "pointer",
          padding: "0 4px",
          fontSize: "16px",
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
