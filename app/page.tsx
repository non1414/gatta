export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center text-center gap-8 px-6 py-12">
      <div className="space-y-4 max-w-xs">
        <div className="text-6xl font-black tracking-tight">قِطّة</div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-1)" }}>
          نظّم القِطّة بدون إحراج
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
          خدمة بسيطة لتنظيم القِطّة بين الأصدقاء — رابط واحد، متابعة فورية، وعدّ تنازلي للموعد.
        </p>
      </div>

      <a href="/create" className="btn btn-white" style={{ maxWidth: "280px" }}>
        ابدأ القِطّة
      </a>

      <p className="text-xs" style={{ color: "var(--text-3)" }}>
        مجاناً تماماً · بدون تسجيل
      </p>
    </main>
  );
}
