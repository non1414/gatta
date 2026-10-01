import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/Providers";
import { Analytics } from '@vercel/analytics/react';

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-plex-sans-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
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
      <body className={`${ibmPlexSansArabic.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
