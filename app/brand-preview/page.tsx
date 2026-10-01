import { notFound } from "next/navigation"

type Wordmark = {
  slug: string
  title: string
  description: string
}

const WORDMARKS: Wordmark[] = [
  {
    slug: "geometric",
    title: "كتابة هندسية متوازنة",
    description: "حروف «قَطّة» متصلة برسم هندسي متزن، بسماكة موحّدة وحواف مستديرة ناعمة.",
  },
  {
    slug: "flowing",
    title: "كتابة ودودة وانسيابية",
    description: "حروف «قَطّة» متصلة بانسيابية أكثر، بتفاوت واضح بين سماكة البِتلات والوصلات.",
  },
]

type Concept = {
  slug: string
  title: string
  description: string
}

const CONCEPTS: Concept[] = [
  {
    slug: "shares",
    title: "حصص تجتمع",
    description: "دائرة مقسّمة إلى أجزاء متوازنة بحواف ناعمة — تجسّد تقسيم المصروف بالتساوي.",
  },
  {
    slug: "gather",
    title: "لقاء ومشاركة",
    description: "أشكال قليلة تتلاقى حول مساحة مشتركة — تجسّد اجتماع الأصدقاء حول القَطّة.",
  },
  {
    slug: "qaf",
    title: "اتجاه حرفي",
    description: "علامة هندسية مستوحاة من حرف «ق» في «قَطّة»، بخطوط بسيطة وواضحة.",
  },
]

const SIZES = [16, 32, 64]
const FAVICON_SIZES = [32, 16]

function WordmarkHeaderMockup({ slug }: { slug: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 18px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand-concepts/wordmark-${slug}-green.svg`} alt="قَطّة" style={{ height: 32, width: "auto" }} />
    </div>
  )
}

function FaviconChip({ slug, size }: { slug: string; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size + 20,
          height: 32,
          borderRadius: "8px 8px 0 0",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderBottom: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/brand-concepts/favicon-${slug}-green.svg`} alt="" width={size} height={size} />
      </div>
      <span className="text-xs" style={{ color: "var(--text-3)" }}>{size}px</span>
    </div>
  )
}

function HeaderMockup({ slug }: { slug: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "14px 18px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand-concepts/${slug}-icon-green.svg`} alt="" width={28} height={28} />
      <span style={{ fontWeight: 800, fontSize: 20, color: "var(--text-1)", letterSpacing: "-0.3px" }}>
        قَطّة
      </span>
    </div>
  )
}

function ColorSwatch({ slug, variant, bg, label }: { slug: string; variant: "green" | "white" | "mono"; bg: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 96,
          height: 96,
          borderRadius: 16,
          background: bg,
          border: bg === "var(--surface)" ? "1px solid var(--border)" : "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/brand-concepts/${slug}-icon-${variant}.svg`} alt="" width={56} height={56} />
      </div>
      <span className="text-xs" style={{ color: "var(--text-2)" }}>{label}</span>
    </div>
  )
}

function TabChip({ slug, size }: { slug: string; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size + 20,
          height: 32,
          borderRadius: "8px 8px 0 0",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderBottom: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/brand-concepts/${slug}-icon-green.svg`} alt="" width={size} height={size} />
      </div>
      <span className="text-xs" style={{ color: "var(--text-3)" }}>{size}px</span>
    </div>
  )
}

export default function BrandPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound()

  return (
    <main className="min-h-dvh px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-1)" }}>
            مقترحات شعار قَطّة
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            صفحة معاينة داخلية — متاحة فقط في وضع التطوير، ولا رابط لها في تنقّل الموقع.
          </p>
        </div>

        {/* ── New: wordmark concepts (word itself is the identity) ───── */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
            شعار كتابي — الكلمة نفسها هي الهوية
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            رسم مباشر لحروف «قَطّة» بصيغة SVG paths، بحروف متصلة ونسب مضبوطة يدويًا — وليس نصًا بخط جاهز.
          </p>
        </div>

        {WORDMARKS.map((wm) => (
          <section key={wm.slug} className="card space-y-6">
            <div className="space-y-1">
              <h3 className="section-title" style={{ marginBottom: 4 }}>{wm.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                {wm.description}
              </p>
            </div>

            {/* Large display, green */}
            <div
              className="flex justify-center"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 16px" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/brand-concepts/wordmark-${wm.slug}-green.svg`}
                alt={`شعار قَطّة — ${wm.title}`}
                style={{ width: "100%", maxWidth: 460, height: "auto" }}
              />
            </div>

            {/* Mono version */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>أحادي اللون</p>
              <div
                className="flex justify-center"
                style={{ background: "var(--surface2)", borderRadius: 14, padding: "20px 16px" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/brand-concepts/wordmark-${wm.slug}-mono.svg`}
                  alt=""
                  style={{ width: "100%", maxWidth: 320, height: "auto" }}
                />
              </div>
            </div>

            {/* Header mockup */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>ضمن هيدر الموقع</p>
              <WordmarkHeaderMockup slug={wm.slug} />
            </div>

            {/* Derived favicon mark */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>رمز مختصر مشتق من نفس الشعار — لأيقونة المتصفح</p>
              <div className="flex flex-wrap items-end gap-6">
                {FAVICON_SIZES.map((size) => (
                  <FaviconChip key={size} slug={wm.slug} size={size} />
                ))}
              </div>
            </div>
          </section>
        ))}

        {/* ── Divider ──────────────────────────────────────────────── */}
        <div className="text-center space-y-1" style={{ paddingTop: 8 }}>
          <h2 className="text-lg font-bold" style={{ color: "var(--text-1)" }}>
            مقترحات سابقة — رمز + اسم
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            محفوظة هنا للمقارنة فقط، ولم يُعتمد أي منها.
          </p>
        </div>

        {CONCEPTS.map((concept) => (
          <section key={concept.slug} className="card space-y-6">
            <div className="space-y-1">
              <h2 className="section-title" style={{ marginBottom: 4 }}>{concept.title}</h2>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                {concept.description}
              </p>
            </div>

            {/* Header mockup */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>ضمن هيدر الموقع</p>
              <HeaderMockup slug={concept.slug} />
            </div>

            {/* Color variants */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>الألوان</p>
              <div className="flex flex-wrap justify-center gap-6 sm:justify-start">
                <ColorSwatch slug={concept.slug} variant="green" bg="var(--surface)" label="أخضر على فاتح" />
                <ColorSwatch slug={concept.slug} variant="white" bg="#4D6959" label="أبيض على أخضر" />
                <ColorSwatch slug={concept.slug} variant="mono" bg="var(--surface)" label="أحادي اللون" />
              </div>
            </div>

            {/* Favicon-scale sizes */}
            <div className="space-y-2">
              <p className="label" style={{ marginBottom: 6 }}>الوضوح كأيقونة تبويب</p>
              <div className="flex flex-wrap items-end gap-6">
                {SIZES.map((size) => (
                  <TabChip key={size} slug={concept.slug} size={size} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
