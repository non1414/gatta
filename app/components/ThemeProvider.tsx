"use client"

import { createContext, useContext, useState } from "react"

export type Theme = "eid" | "ocean" | "light"

type ThemeCtx = { theme: Theme; setTheme: (t: Theme) => void }

const ThemeContext = createContext<ThemeCtx>({ theme: "eid", setTheme: () => {} })

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy init: read the attribute set by the anti-flash script so initial render matches
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "eid"
    return (document.documentElement.getAttribute("data-theme") as Theme) || "eid"
  })

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem("gatta_theme", t)
    document.documentElement.setAttribute("data-theme", t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
