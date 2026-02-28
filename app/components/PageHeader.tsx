import Link from "next/link"
import { ThemeToggle } from "./ThemeToggle"

export function PageHeader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 24,
      }}
    >
      {/* In RTL flex: first child = right side (brand) · second child = left side (toggle) */}
      <Link
        href="/"
        style={{
          fontWeight: 800,
          fontSize: 20,
          color: "var(--text-1)",
          textDecoration: "none",
          letterSpacing: "-0.3px",
        }}
      >
        قَطّة
      </Link>
      <ThemeToggle />
    </div>
  )
}
