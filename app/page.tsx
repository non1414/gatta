export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center gap-6 p-8">

      <h1 className="text-4xl font-bold">
        قسّم القِطّة بدون إحراج
      </h1>

      <p className="text-gray-500">
        Split group payments in seconds
      </p>

      <a
        href="/create"
        className="bg-black text-white px-6 py-3 rounded-lg"
      >
        ابدأ القِطّة
      </a>

      <p className="text-xs text-gray-400 max-w-md">
        منصة لتنظيم المدفوعات بين الأصدقاء فقط.
      </p>

    </main>
  )
}