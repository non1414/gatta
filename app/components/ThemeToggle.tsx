"use client"

import { useTheme, type Theme } from "./ThemeProvider"

const THEMES: { id: Theme; label: string; emoji: string }[] = [
  { id: "eid",   label: "عيد",  emoji: "🌙" },
  { id: "ocean", label: "بحر",  emoji: "🌊" },
  { id: "light", label: "فاتح", emoji: "☀️" },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="theme-pill">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          title={t.label}
          className={`theme-btn ${theme === t.id ? "theme-btn-active" : "theme-btn-inactive"}`}
        >
          <span>{t.emoji}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
