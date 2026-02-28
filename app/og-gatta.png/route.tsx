import { ImageResponse } from "next/og"

export const runtime = "edge"

/* Load Cairo (Arabic) from Google Fonts — cached at edge for 24 h */
async function loadCairo(): Promise<ArrayBuffer | undefined> {
  try {
    // Step 1: get the CSS which contains the real woff2 URL
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Cairo:wght@700",
      {
        headers: {
          // Chrome UA → Google returns woff2 URLs
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    ).then((r) => r.text())

    // Step 2: extract first woff2 URL
    const match = css.match(/url\((https:\/\/[^)]+\.woff2)\)/)
    if (!match) return undefined

    // Step 3: fetch the actual font binary
    const fontRes = await fetch(match[1])
    return fontRes.ok ? fontRes.arrayBuffer() : undefined
  } catch {
    return undefined
  }
}

export async function GET() {
  const fontData = await loadCairo()

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FFF7EF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          fontFamily: fontData ? "Cairo" : "Arial, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Coral blob — top-right */}
        <div
          style={{
            position: "absolute",
            top: -140,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "#FFD0C0",
            opacity: 0.45,
            display: "flex",
          }}
        />

        {/* Mauve blob — bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: -110,
            left: -100,
            width: 440,
            height: 440,
            borderRadius: "50%",
            background: "#E4D0FF",
            opacity: 0.40,
            display: "flex",
          }}
        />

        {/* Gold blob — top-left */}
        <div
          style={{
            position: "absolute",
            top: 50,
            left: -80,
            width: 300,
            height: 300,
            borderRadius: "50%",
            background: "#FFE8A0",
            opacity: 0.30,
            display: "flex",
          }}
        />

        {/* ✦ stars */}
        <div style={{ position: "absolute", top: 58,  left: 110,  fontSize: 40, color: "#D9A441", opacity: 0.65, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", top: 42,  left: 180,  fontSize: 22, color: "#D9A441", opacity: 0.45, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", top: 55,  right: 170, fontSize: 26, color: "#D9A441", opacity: 0.50, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", top: 35,  right: 250, fontSize: 18, color: "#A77BFA", opacity: 0.40, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", bottom: 70, left: 140,  fontSize: 22, color: "#A77BFA", opacity: 0.40, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", bottom: 55, right: 120, fontSize: 34, color: "#D9A441", opacity: 0.55, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", bottom: 80, right: 210, fontSize: 16, color: "#FF6A3D", opacity: 0.35, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", top: 220, right: 90,   fontSize: 20, color: "#D9A441", opacity: 0.38, display: "flex" }}>✦</div>
        <div style={{ position: "absolute", top: 300, left: 85,    fontSize: 16, color: "#FF6A3D", opacity: 0.30, display: "flex" }}>✦</div>

        {/* Main content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0,
            direction: "rtl",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* Brand wordmark */}
          <div
            style={{
              fontSize: 168,
              fontWeight: 800,
              color: "#FF6A3D",
              lineHeight: 1,
              letterSpacing: "-2px",
              display: "flex",
            }}
          >
            قَطّة
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: 38,
              fontWeight: 600,
              color: "#6B5E55",
              marginTop: 4,
              display: "flex",
            }}
          >
            نظّم قَطّتك بسهولة
          </div>

          {/* URL pill */}
          <div
            style={{
              marginTop: 28,
              background: "rgba(255,106,61,0.09)",
              border: "1.5px solid rgba(255,106,61,0.22)",
              borderRadius: 40,
              padding: "8px 30px",
              fontSize: 24,
              fontWeight: 600,
              color: "#FF6A3D",
              direction: "ltr",
              display: "flex",
            }}
          >
            gatta-chi.vercel.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fontData
        ? [{ name: "Cairo", data: fontData, weight: 700, style: "normal" }]
        : undefined,
    }
  )
}
