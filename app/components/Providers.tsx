"use client"

import { ToastProvider } from "./Toast"
import { ErrorBoundary } from "./ErrorBoundary"
import { ThemeProvider } from "./ThemeProvider"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
