import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "قَطّة — نظّم قَطّتك بسهولة",
  description: "أنشئ رابط قَطّة وشاركه مع أصدقائك لتتبع المدفوعات بسهولة.",
  openGraph: {
    title: "قَطّة — نظّم قَطّتك بسهولة",
    description: "أنشئ رابط قَطّة وشاركه مع أصدقائك لتتبع المدفوعات بسهولة.",
    url: "https://gatta-chi.vercel.app",
    locale: "ar_SA",
    type: "website",
    images: [
      {
        url: "https://gatta-chi.vercel.app/og-gatta.png",
        width: 1200,
        height: 630,
        alt: "قَطّة — نظّم قَطّتك بسهولة",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "قَطّة — نظّم قَطّتك بسهولة",
    description: "أنشئ رابط قَطّة وشاركه مع أصدقائك لتتبع المدفوعات بسهولة.",
    images: ["https://gatta-chi.vercel.app/og-gatta.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Anti-flash: apply stored theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('gatta_theme');if(t&&['eid','minimal'].indexOf(t)!==-1)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
