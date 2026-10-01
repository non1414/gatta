import { Footer } from "./components/Footer"
import { Logo } from "./components/Logo"

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center px-6">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 py-16">
        <div className="space-y-4" style={{ maxWidth: 320 }}>
          <Logo className="h-14 sm:h-20 w-auto" />
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-1)" }}>
            نظّم القَطّة بدون إحراج
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            خدمة بسيطة لتنظيم القَطّة بين الأصدقاء — رابط واحد، متابعة فورية، وعدّ تنازلي للموعد.
          </p>
        </div>

        <a href="/create" className="btn btn-white" style={{ maxWidth: 280 }}>
          ابدأ القَطّة
        </a>

        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          مجاناً تماماً · بدون تسجيل
        </p>
      </div>

      <Footer />
    </main>
  )
}
