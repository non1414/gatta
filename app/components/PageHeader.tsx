import Link from "next/link"
import { Logo } from "./Logo"

export function PageHeader() {
  return (
    <div style={{ paddingBottom: 24 }}>
      <Link href="/" style={{ display: "inline-flex" }}>
        <Logo className="h-8 w-auto" />
      </Link>
    </div>
  )
}
